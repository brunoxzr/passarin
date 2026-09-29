"""Captura a webcam e publica a postura do adepassaro em ws://127.0.0.1:8765.

OpenCV lê a câmera. MediaPipe estima o corpo. kinematics.py transforma isso
em asas, abertura e inclinação do tronco, com lerp temporal. O jogo 3D só
recebe JSON — não acessa a câmera.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import math
import sys
import threading
import time
import urllib.request
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kinematics import Damper, is_neutral, measure, smooth_controls, to_controls

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "pose_landmarker_lite.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)
HOST = "127.0.0.1"
PORT = 8765

clients: set = set()
commands: list[dict] = []
lock = threading.Lock()
state: dict = {
    "type": "pose",
    "tracking": False,
    "calibrated": False,
    "stable": 0.0,
    "confidence": 0.0,
    "demo": False,
    "message": "Aguardando o rastreador…",
    "preview": None,
    "leftUpper": 0.0,
    "leftFore": 0.0,
    "leftSweep": 0.0,
    "rightUpper": 0.05,
    "rightFore": 0.0,
    "rightSweep": 0.0,
    "span": 0.7,
    "pitch": 0.0,
    "roll": 0.0,
}


def publish(**kwargs) -> None:
    with lock:
        state.update(kwargs)


def snapshot() -> dict:
    with lock:
        return dict(state)


def pop_commands() -> list[dict]:
    with lock:
        items = list(commands)
        commands.clear()
        return items


def ensure_model() -> Path:
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 100_000:
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Baixando modelo de pose para {MODEL_PATH} …")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


_BONES = (
    (11, 12), (11, 13), (13, 15), (15, 19), (15, 21),
    (12, 14), (14, 16), (16, 20), (16, 22),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (24, 26), (26, 28),
    (0, 11), (0, 12),
)


def _draw_body(frame, landmarks) -> None:
    import cv2

    h, w = frame.shape[:2]
    pts = []
    for lm in landmarks:
        pts.append((int(lm.x * w), int(lm.y * h)))
    for a, b in _BONES:
        if a >= len(pts) or b >= len(pts):
            continue
        cv2.line(frame, pts[a], pts[b], (80, 220, 255), 2, cv2.LINE_AA)
    for i in (0, 11, 12, 13, 14, 15, 16, 23, 24):
        if i < len(pts):
            cv2.circle(frame, pts[i], 4, (40, 180, 255), -1, cv2.LINE_AA)


def _jpeg(frame) -> str:
    import cv2

    small = cv2.resize(frame, (240, 180))
    ok, buf = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 52])
    if not ok:
        return ""
    encoded = base64.b64encode(buf.tobytes()).decode("ascii")
    return "data:image/jpeg;base64," + encoded


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

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        publish(
            tracking=False,
            message=f"Não encontrei a webcam (índice {camera_index}). Tente: python run.py --camera 1",
        )
        return

    damper = Damper()
    baseline_pitch = 0.0
    baseline_roll = 0.0
    pitch_sign = 1.0
    swap = False
    calibrated = False
    stable = 0.0
    last_ts = 0
    t0 = time.perf_counter()
    previous = time.perf_counter()
    frame_i = 0
    preview = None
    held: dict | None = None

    publish(message="Fique visível da cintura para cima, braços abertos.")

    while True:
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
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp = int((now - t0) * 1000)
        if timestamp <= last_ts:
            timestamp = last_ts + 1
        last_ts = timestamp

        try:
            result = landmarker.detect_for_video(mp_image, timestamp)
        except Exception as exc:
            publish(tracking=False, message=f"Falha ao ler a pose ({exc}).")
            time.sleep(0.05)
            continue

        image_lm = result.pose_landmarks[0] if result.pose_landmarks else None
        world_lm = result.pose_world_landmarks[0] if result.pose_world_landmarks else None
        raw = measure(image_lm, world_lm) if image_lm is not None else None

        for cmd in pop_commands():
            name = cmd.get("cmd")
            if name == "calibrate" and raw is not None:
                baseline_pitch = raw.pitch
                baseline_roll = raw.roll
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
            publish(
                tracking=False,
                calibrated=calibrated,
                stable=max(0.0, stable - dt * 0.45),
                confidence=0.0,
                message="Não vejo o corpo. Afaste-se até ombros, cotovelos e quadril entrarem no quadro.",
                preview=preview,
                demo=False,
            )
            stable = max(0.0, stable - dt * 0.45)
            continue

        if not calibrated:
            if is_neutral(raw):
                stable = min(1.0, stable + dt / 1.35)
            else:
                stable = max(0.0, stable - dt * 0.55)
            if stable >= 1.0:
                baseline_pitch = raw.pitch
                baseline_roll = raw.roll
                calibrated = True

        controls = to_controls(raw, baseline_pitch if calibrated else raw.pitch, baseline_roll if calibrated else raw.roll, pitch_sign, swap)
        # Antes de calibrar, o tronco zera (o pássaro não mergulha sozinho),
        # mas as asas continuam copiando o braço em tempo real.
        if not calibrated:
            controls["pitch"] = 0.0
            controls["roll"] = 0.0
        smoothed = smooth_controls(damper, controls, dt)
        held = smoothed

        if calibrated:
            message = "Postura alinhada. Pode voar."
        elif stable > 0.35:
            message = "Quase lá — tronco ereto, braços na altura dos ombros."
        else:
            message = "Abra os braços e olhe para a câmera. Segure um instante."

        publish(
            tracking=True,
            calibrated=calibrated,
            stable=stable,
            demo=False,
            message=message,
            preview=preview,
            **smoothed,
        )

    cap.release()
    landmarker.close()


def demo_loop() -> None:
    """Pose sintética para ver o mundo sem webcam."""
    damper = Damper()
    calibrated = False
    pitch_sign = 1.0
    previous = time.perf_counter()
    publish(
        demo=True,
        tracking=True,
        calibrated=False,
        stable=1.0,
        confidence=1.0,
        message="Modo demonstração, sem webcam. Clique em voar para soltar o pássaro.",
    )
    while True:
        now = time.perf_counter()
        dt = min(0.05, now - previous)
        previous = now
        for cmd in pop_commands():
            name = cmd.get("cmd")
            if name == "calibrate":
                calibrated = True
            elif name == "recalibrate":
                calibrated = False
            elif name == "invert_pitch":
                pitch_sign *= -1.0

        t = now
        flap = math.sin(t * 2.3)
        bank = math.sin(t * 0.33)
        dive = math.sin(t * 0.21)
        raw = {
            "leftUpper": 0.12 + flap * 0.62 + max(0.0, bank) * 0.25,
            "leftFore": 0.02 + flap * 0.85,
            "leftSweep": 0.08,
            "rightUpper": 0.12 + flap * 0.62 + max(0.0, -bank) * 0.25,
            "rightFore": 0.02 + flap * 0.85,
            "rightSweep": 0.08,
            "span": 0.72 + (1.0 - abs(flap)) * 0.22,
            "pitch": dive * 0.42 * pitch_sign if calibrated else 0.0,
            "roll": bank * 0.55 if calibrated else bank * 0.2,
            "confidence": 1.0,
        }
        smoothed = smooth_controls(damper, raw, dt)
        publish(
            demo=True,
            tracking=True,
            calibrated=calibrated,
            stable=1.0,
            message="Modo demonstração. Clique em voar — ou conecte a webcam sem --demo.",
            preview=None,
            **smoothed,
        )
        time.sleep(1 / 60)


async def handler(websocket) -> None:
    clients.add(websocket)
    try:
        async for message in websocket:
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and "cmd" in payload:
                with lock:
                    commands.append(payload)
    except websockets.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)


async def broadcast_loop() -> None:
    while True:
        if clients:
            payload = json.dumps(snapshot())
            dead = []
            for ws in list(clients):
                try:
                    await ws.send(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                clients.discard(ws)
        await asyncio.sleep(1 / 60)


async def main_async(args) -> None:
    target = demo_loop if args.demo else lambda: camera_loop(args.camera)
    threading.Thread(target=target, daemon=True).start()
    print(f"adepassaro pose em ws://{HOST}:{PORT}", flush=True)
    async with websockets.serve(handler, HOST, PORT, max_size=2**20):
        await broadcast_loop()


def parse_args():
    parser = argparse.ArgumentParser(description="Rastreador corporal do adepassaro")
    parser.add_argument("--demo", action="store_true", help="Voo sintético, sem webcam")
    parser.add_argument("--camera", type=int, default=0, help="Índice da webcam")
    return parser.parse_args()


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    args = parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nRastreador encerrado.")
