"""Sobe o rastreador (Python) e o jogo (navegador)."""

import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
WEB = ROOT / "web"


def ensure_venv() -> Path:
    if not VENV_PY.exists():
        subprocess.check_call([sys.executable, "-m", "venv", str(ROOT / ".venv")])
    check = subprocess.run([str(VENV_PY), "-c", "import websockets"], capture_output=True)
    needs = ["-r", str(ROOT / "requirements.txt")]
    demo = "--demo" in sys.argv
    if check.returncode != 0:
        subprocess.check_call([str(VENV_PY), "-m", "pip", "install", *needs])
    elif not demo:
        probe = subprocess.run([str(VENV_PY), "-c", "import mediapipe, cv2"], capture_output=True)
        if probe.returncode != 0:
            subprocess.check_call([str(VENV_PY), "-m", "pip", "install", *needs])
    return VENV_PY


def ensure_node() -> None:
    if not (WEB / "node_modules" / "three").exists():
        subprocess.check_call("npm install", cwd=WEB, shell=True)


def wait_http(url: str, timeout: float = 40) -> None:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except Exception:
            time.sleep(0.3)
    raise SystemExit(f"O jogo não abriu em {url}")


def main() -> None:
    py = ensure_venv()
    ensure_node()
    extra = [a for a in sys.argv[1:] if a.startswith("--")]
    tracker = subprocess.Popen([str(py), str(ROOT / "tracker" / "pose_server.py"), *extra], cwd=ROOT)
    vite = WEB / "node_modules" / "vite" / "bin" / "vite.js"
    node = shutil.which("node") or "node"
    web = subprocess.Popen([node, str(vite), "--host", "127.0.0.1", "--port", "5173", "--strictPort"], cwd=WEB)
    try:
        wait_http("http://127.0.0.1:5173")
        webbrowser.open("http://127.0.0.1:5173")
        print("adepassaro no ar. Ctrl+C encerra.")
        while tracker.poll() is None and web.poll() is None:
            time.sleep(0.4)
    except KeyboardInterrupt:
        pass
    finally:
        tracker.terminate()
        web.terminate()


if __name__ == "__main__":
    main()
