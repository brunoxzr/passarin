"""Estado compartilhado entre a thread da câmera e o servidor WebSocket."""

from __future__ import annotations

import math
import threading

_lock = threading.Lock()
_commands: list[dict] = []
_state: dict = {
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
    "headYaw": 0.0,
    "headPitch": 0.0,
}


def publish(**kwargs) -> None:
    # JSON não aceita NaN: um valor inválido quebraria a mensagem no navegador.
    clean = {k: (0.0 if isinstance(v, float) and not math.isfinite(v) else v) for k, v in kwargs.items()}
    with _lock:
        _state.update(clean)


def snapshot() -> dict:
    with _lock:
        return dict(_state)


def push_command(cmd: dict) -> None:
    with _lock:
        _commands.append(cmd)


def pop_commands() -> list[dict]:
    with _lock:
        items = list(_commands)
        _commands.clear()
        return items
