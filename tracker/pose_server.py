"""Servidor do rastreador corporal: publica a postura em ws://127.0.0.1:8765.

  capture.py     webcam + MediaPipe → controles
  demo.py        pose sintética (--demo)
  kinematics.py  medidas do corpo e suavização
  shared.py      estado compartilhado entre threads

O jogo 3D só recebe JSON — não acessa a câmera.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import threading
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shared import push_command, snapshot  # noqa: E402

HOST = "127.0.0.1"
PORT = 8765

clients: set = set()


async def handler(websocket) -> None:
    clients.add(websocket)
    try:
        async for message in websocket:
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and "cmd" in payload:
                push_command(payload)
    except websockets.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)


async def broadcast_loop() -> None:
    last_preview = None
    while True:
        if clients:
            data = snapshot()
            # A imagem da webcam só vai quando muda (~10 fps), não a 60 fps.
            if data.get("preview") is last_preview:
                data.pop("preview", None)
            else:
                last_preview = data.get("preview")
            payload = json.dumps(data)
            for ws in list(clients):
                try:
                    await ws.send(payload)
                except Exception:
                    clients.discard(ws)
        await asyncio.sleep(1 / 60)


async def main_async(args) -> None:
    if args.demo:
        from demo import demo_loop

        target = demo_loop
    else:
        from capture import camera_loop

        def target():
            camera_loop(args.camera)

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
    try:
        asyncio.run(main_async(parse_args()))
    except KeyboardInterrupt:
        print("\nRastreador encerrado.")
