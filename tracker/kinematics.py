"""Medição do corpo e suavização para o adepassaro.

Asas usam o ângulo real do braço (cinemática direta). O tronco entra como
inclinação relativa à postura calibrada: para frente mergulha, para o lado curva.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24

KEY_JOINTS = (
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_ELBOW,
    RIGHT_ELBOW,
    LEFT_WRIST,
    RIGHT_WRIST,
    LEFT_HIP,
    RIGHT_HIP,
)

# Metros de avanço do ombro em relação ao quadril que viram ~1 rad de mergulho.
PITCH_METERS = 0.22


@dataclass
class Measure:
    left_upper: float
    left_fore: float
    left_sweep: float
    right_upper: float
    right_fore: float
    right_sweep: float
    span: float
    pitch: float
    roll: float
    confidence: float


def _vis(lm) -> float:
    value = getattr(lm, "visibility", None)
    if value is None:
        return 1.0
    return float(value)


def _elevation(a, b) -> float:
    """Radianos a partir da horizontal. Positivo = segmento aponta para cima na imagem."""
    dx = float(b.x) - float(a.x)
    dy = float(b.y) - float(a.y)
    return math.atan2(-dy, abs(dx) + 1e-6)


def _dist(a, b) -> float:
    return math.hypot(float(b.x) - float(a.x), float(b.y) - float(a.y))


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def measure(image, world=None) -> Measure | None:
    """Lê landmarks normalizados (imagem) e, se houver, landmarks em metros (mundo)."""
    if image is None or len(image) < 25:
        return None

    confidence = min(_vis(image[i]) for i in KEY_JOINTS)
    if confidence < 0.35:
        return None

    ls, rs = image[LEFT_SHOULDER], image[RIGHT_SHOULDER]
    le, re = image[LEFT_ELBOW], image[RIGHT_ELBOW]
    lw, rw = image[LEFT_WRIST], image[RIGHT_WRIST]
    lh, rh = image[LEFT_HIP], image[RIGHT_HIP]

    shoulder = _dist(ls, rs)
    wrist = _dist(lw, rw)
    ratio = wrist / (shoulder + 1e-6)
    span = _clamp((ratio - 1.15) / 1.7, 0.0, 1.0)

    roll = math.atan2(float(ls.y) - float(rs.y), shoulder + 1e-6)

    pitch = 0.0
    left_sweep = 0.0
    right_sweep = 0.0
    if world is not None and len(world) > RIGHT_HIP:
        wls, wrs = world[LEFT_SHOULDER], world[RIGHT_SHOULDER]
        wlh, wrh = world[LEFT_HIP], world[RIGHT_HIP]
        shoulder_z = (float(wls.z) + float(wrs.z)) * 0.5
        hip_z = (float(wlh.z) + float(wrh.z)) * 0.5
        # z menor = mais perto da câmera. Ombros à frente do quadril = mergulho.
        pitch = hip_z - shoulder_z
        left_sweep = float(wls.z) - float(world[LEFT_WRIST].z)
        right_sweep = float(wrs.z) - float(world[RIGHT_WRIST].z)

    return Measure(
        left_upper=_clamp(_elevation(ls, le), -1.45, 1.45),
        left_fore=_clamp(_elevation(le, lw), -1.45, 1.45),
        left_sweep=_clamp(left_sweep * 1.4, -0.8, 0.8),
        right_upper=_clamp(_elevation(rs, re), -1.45, 1.45),
        right_fore=_clamp(_elevation(re, rw), -1.45, 1.45),
        right_sweep=_clamp(right_sweep * 1.4, -0.8, 0.8),
        span=span,
        pitch=pitch,
        roll=_clamp(roll, -1.2, 1.2),
        confidence=confidence,
    )


def is_neutral(m: Measure) -> bool:
    return (
        m.confidence > 0.55
        and abs(m.left_upper) < 0.42
        and abs(m.right_upper) < 0.42
        and abs(m.pitch) < 0.08
        and abs(m.roll) < 0.2
        and m.span > 0.58
    )


class Damper:
    def __init__(self):
        self.values: dict[str, float] = {}

    def pull(self, key: str, target: float, speed: float, dt: float) -> float:
        current = self.values.get(key, target)
        alpha = 1.0 - math.exp(-speed * max(dt, 0.0))
        current = current + (target - current) * alpha
        self.values[key] = current
        return current


def to_controls(m: Measure, baseline_pitch: float, baseline_roll: float, pitch_sign: float, swap: bool) -> dict:
    """Converte a medida em alvos do pássaro. Asas são absolutas; tronco é relativo."""
    left_upper, left_fore, left_sweep = m.left_upper, m.left_fore, m.left_sweep
    right_upper, right_fore, right_sweep = m.right_upper, m.right_fore, m.right_sweep
    if swap:
        left_upper, right_upper = right_upper, left_upper
        left_fore, right_fore = right_fore, left_fore
        left_sweep, right_sweep = right_sweep, left_sweep

    pitch = -(m.pitch - baseline_pitch) / PITCH_METERS * pitch_sign
    roll = (m.roll - baseline_roll) * 1.25
    return {
        "leftUpper": left_upper,
        "leftFore": left_fore,
        "leftSweep": left_sweep,
        "rightUpper": right_upper,
        "rightFore": right_fore,
        "rightSweep": right_sweep,
        "span": m.span,
        "pitch": _clamp(pitch, -1.15, 1.05),
        "roll": _clamp(roll, -1.15, 1.15),
        "confidence": m.confidence,
    }


def smooth_controls(damper: Damper, controls: dict, dt: float) -> dict:
    speeds = {
        "leftUpper": 16.0,
        "leftFore": 16.0,
        "leftSweep": 8.0,
        "rightUpper": 16.0,
        "rightFore": 16.0,
        "rightSweep": 8.0,
        "span": 10.0,
        "pitch": 8.0,
        "roll": 8.0,
        "confidence": 6.0,
    }
    return {key: damper.pull(key, controls[key], speeds[key], dt) for key in speeds}


def _landmark(x, y, z=0.0, visibility=1.0):
    return type("Lm", (), {"x": x, "y": y, "z": z, "visibility": visibility})()


def _blank():
    return [_landmark(0.5, 0.5, 0.0) for _ in range(33)]


def _self_check() -> None:
    image = _blank()
    world = _blank()
    image[LEFT_SHOULDER] = _landmark(0.35, 0.40)
    image[RIGHT_SHOULDER] = _landmark(0.65, 0.40)
    image[LEFT_ELBOW] = _landmark(0.22, 0.40)
    image[RIGHT_ELBOW] = _landmark(0.78, 0.40)
    image[LEFT_WRIST] = _landmark(0.10, 0.40)
    image[RIGHT_WRIST] = _landmark(0.90, 0.40)
    image[LEFT_HIP] = _landmark(0.42, 0.72)
    image[RIGHT_HIP] = _landmark(0.58, 0.72)
    pose = measure(image, world)
    assert pose is not None
    assert abs(pose.left_upper) < 0.08, pose.left_upper
    assert abs(pose.right_upper) < 0.08, pose.right_upper
    assert pose.span > 0.75, pose.span
    assert is_neutral(pose), pose

    image[LEFT_WRIST] = _landmark(0.35, 0.12)
    image[LEFT_ELBOW] = _landmark(0.35, 0.24)
    raised = measure(image, world)
    assert raised is not None
    assert raised.left_upper > 1.0, raised.left_upper

    world[LEFT_SHOULDER] = _landmark(0, 0, -0.2)
    world[RIGHT_SHOULDER] = _landmark(0, 0, -0.2)
    leaning = measure(image, world)
    assert leaning is not None and leaning.pitch > 0.15, leaning.pitch

    controls = to_controls(leaning, 0.0, 0.0, 1.0, False)
    assert controls["pitch"] < -0.4, controls["pitch"]

    damper = Damper()
    a = smooth_controls(damper, controls, 0.016)
    b = smooth_controls(damper, controls, 0.016)
    assert abs(b["pitch"]) > abs(a["pitch"])
    print("cinematica ok")


if __name__ == "__main__":
    _self_check()
