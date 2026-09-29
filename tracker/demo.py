"""Pose sintética para ver o jogo sem webcam (python run.py --demo)."""

from __future__ import annotations

import math
import time

from kinematics import Damper, smooth_controls
from shared import pop_commands, publish


def demo_loop() -> None:
    damper = Damper()
    calibrated = False
    pitch_sign = 1.0
    previous = time.perf_counter()
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

        flap = math.sin(now * 2.3)
        bank = math.sin(now * 0.33)
        dive = math.sin(now * 0.21)
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
            "headYaw": math.sin(now * 0.37) * 0.6,
            "headPitch": math.sin(now * 0.23) * 0.2,
            "confidence": 1.0,
        }
        publish(
            demo=True,
            tracking=True,
            calibrated=calibrated,
            stable=1.0,
            message="Modo demonstração. Espaço decola.",
            preview=None,
            **smooth_controls(damper, raw, dt),
        )
        time.sleep(1 / 60)
