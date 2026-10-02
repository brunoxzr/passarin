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
    import ssl
    import urllib.request

    insecure = ssl._create_unverified_context()  # certificado local autoassinado
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1, context=insecure)
            return
        except Exception:
            time.sleep(0.3)
    raise SystemExit(f"O jogo não abriu em {url}")


def lan_ip() -> str:
    """IP do PC na rede local (o que o celular/óculos usa para abrir /mobile)."""
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # não envia nada, só escolhe a interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    py = ensure_venv()
    ensure_node()
    extra = [a for a in sys.argv[1:] if a.startswith("--")]
    tracker = subprocess.Popen([str(py), str(ROOT / "tracker" / "pose_server.py"), *extra], cwd=ROOT)
    vite = WEB / "node_modules" / "vite" / "bin" / "vite.js"
    node = shutil.which("node") or "node"
    web = subprocess.Popen([node, str(vite), "--host", "0.0.0.0", "--port", "5173", "--strictPort"], cwd=WEB)
    try:
        wait_http("http://127.0.0.1:5173")
        webbrowser.open("http://127.0.0.1:5173")
        print("adepassaro no ar. Ctrl+C encerra.")
        print(f"Óculos VR: abra http://{lan_ip()}:5173/mobile no celular (mesma rede Wi-Fi).")
        while tracker.poll() is None and web.poll() is None:
            time.sleep(0.4)
    except KeyboardInterrupt:
        pass
    finally:
        # Mata a árvore inteira: senão o Vite segura a porta 5173 e o rastreador a webcam.
        for proc in (tracker, web):
            if proc.poll() is None:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)


if __name__ == "__main__":
    main()
