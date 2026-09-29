"""Loop da webcam: OpenCV lê a imagem, MediaPipe estima o corpo, kinematics
transforma em controles do pássaro e shared.publish entrega ao servidor."""

from __future__ import annotations

import base64
import traceback
import time
import urllib.request
from pathlib import Path

from kinematics import Damper, is_neutral, measure, smooth_controls, to_controls
from shared import pop_commands, publish

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "pose_landmarker_lite.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)

_BONES = (
    (11, 12), (11, 13), (13, 15), (15, 19), (15, 21),
    (12, 14), (14, 16), (16, 20), (16, 22),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (24, 26), (26, 28),
    (0, 11), (0, 12),
)


def ensure_model() -> Path:
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 100_000:
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Baixando modelo de pose para {MODEL_PATH} …")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def _draw_body(frame, landmarks) -> None:
    import cv2

    h, w = frame.shape[:2]
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
    for a, b in _BONES:
        if a < len(pts) and b < len(pts):
            cv2.line(frame, pts[a], pts[b], (120, 200, 255), 2, cv2.LINE_AA)
    for i in (0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24):
        if i < len(pts):
            cv2.circle(frame, pts[i], 4, (60, 140, 255), -1, cv2.LINE_AA)


def _jpeg(frame) -> str:
    import cv2

    small = cv2.resize(frame, (240, 180))
    ok, buf = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 55])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _open_camera(index: int):
    import cv2

    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)
    return cap


def camera_loop(camera_index: int) -> None:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    try:
        model = ensure_model()
    except Exception as exc:
        publish(tracking=False, message=f"Não consegui baixar o modelo de pose ({exc}).")
        return

    landmarker = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )
    cap = _open_camera(camera_index)
    if not cap.isOpened():
        publish(tracking=False, message=f"Não encontrei a webcam (índice {camera_index}). Tente: python run.py --camera 1")
        return

    damper = Damper()
    baseline_pitch = 0.0
    baseline_roll = 0.0
    pitch_sign = 1.0
    swap = False
    calibrated = False
    stable = 0.0
    # Cabeça: a referência "olhando para a tela" se ajusta nos primeiros quadros
    # e é refeita a cada calibração.
    head_base: tuple[float, float] | None = None
    head_frames = 0
    head = (0.0, 0.0)
    last_ts = 0
    t0 = time.perf_counter()
    previous = t0
    frame_i = 0
    preview = None

    publish(message="Fique visível da cintura para cima, braços abertos.")

    while True:
        try:
            ok, frame = cap.read()
            now = time.perf_counter()
            dt = min(0.05, max(0.001, now - previous))
            previous = now
            if not ok:
                publish(tracking=False, message="A câmera parou de enviar imagem.")
                time.sleep(0.05)
                continue

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            timestamp = max(last_ts + 1, int((now - t0) * 1000))
            last_ts = timestamp
            try:
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp)
            except Exception as exc:
                publish(tracking=False, message=f"Falha ao ler a pose ({exc}).")
                time.sleep(0.05)
                continue

            image_lm = result.pose_landmarks[0] if result.pose_landmarks else None
            world_lm = result.pose_world_landmarks[0] if result.pose_world_landmarks else None
            aspect = frame.shape[1] / frame.shape[0]
            raw = measure(image_lm, world_lm, aspect) if image_lm is not None else None

            for cmd in pop_commands():
                name = cmd.get("cmd")
                if name == "calibrate" and raw is not None:
                    baseline_pitch, baseline_roll = raw.pitch, raw.roll
                    if raw.head is not None:
                        head_base = raw.head
                    calibrated = True
                    stable = 1.0
                elif name == "recalibrate":
                    calibrated = False
                    stable = 0.0
                elif name == "invert_pitch":
                    pitch_sign *= -1.0
                elif name == "swap_arms":
                    swap = not swap

            if image_lm is not None:
                _draw_body(frame, image_lm)
            frame_i += 1
            if frame_i % 3 == 0:
                preview = _jpeg(frame)

            if raw is None:
                stable = max(0.0, stable - dt * 0.45)
                publish(
                    tracking=False,
                    calibrated=calibrated,
                    stable=stable,
                    confidence=0.0,
                    message="Não vejo o corpo. Afaste-se até ombros, cotovelos e quadril entrarem no quadro.",
                    preview=preview,
                    demo=False,
                )
                continue

            if raw.head is not None:
                if head_base is None:
                    head_base = raw.head
                elif head_frames < 45:
                    head_base = (head_base[0] * 0.9 + raw.head[0] * 0.1, head_base[1] * 0.9 + raw.head[1] * 0.1)
                head_frames += 1
                head = (raw.head[0] - head_base[0], raw.head[1] - head_base[1])

            if not calibrated:
                stable = min(1.0, stable + dt / 1.35) if is_neutral(raw) else max(0.0, stable - dt * 0.55)
                if stable >= 1.0:
                    baseline_pitch, baseline_roll = raw.pitch, raw.roll
                    if raw.head is not None:
                        head_base = raw.head
                        head = (0.0, 0.0)
                    calibrated = True

            controls = to_controls(
                raw,
                baseline_pitch if calibrated else raw.pitch,
                baseline_roll if calibrated else raw.roll,
                pitch_sign,
                swap,
                head,
                raw.arms,
            )
            # Antes de calibrar o tronco fica zerado (o pássaro não mergulha
            # sozinho), mas asas e cabeça já copiam o corpo em tempo real.
            if not calibrated:
                controls["pitch"] = 0.0
                controls["roll"] = 0.0
            smoothed = smooth_controls(damper, controls, dt)

            if calibrated:
                message = "Postura alinhada. Pode voar."
            elif stable > 0.35:
                message = "Quase lá — tronco reto, braços na altura dos ombros."
            else:
                message = "Abra os braços e olhe para a tela. Segure um instante."

            publish(tracking=True, calibrated=calibrated, stable=stable, demo=False, message=message, preview=preview, **smoothed)
        except Exception:
            # Um erro num quadro não pode matar a câmera: mostra e continua.
            traceback.print_exc()
            publish(tracking=False, message="Erro no rastreador — veja o terminal.")
            time.sleep(0.05)
