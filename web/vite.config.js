import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { WebSocketServer } from "ws";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Ponte do óculos VR: o jogo (host) transmite o canvas por WebRTC para /mobile (viewer).
 * Este plugin só repassa as mensagens de sinalização pelo WebSocket do próprio Vite.
 */
function vrRelay() {
  return {
    name: "vr-relay",
    configureServer(server) {
      const hosts = new Set();
      const viewers = new Map();
      let live = { live: false };
      const alive = (c) => !c.socket || c.socket.readyState === 1;
      const prune = () => {
        for (const h of hosts) if (!alive(h)) hosts.delete(h);
        for (const [id, v] of viewers) if (!alive(v)) viewers.delete(id);
      };

      server.ws.on("vr:host", (_, client) => {
        prune();
        hosts.add(client);
        for (const id of viewers.keys()) client.send("vr:join", { id });
      });
      server.ws.on("vr:viewer", ({ id }, client) => {
        prune();
        viewers.set(id, client);
        client.send("vr:state", live);
        for (const h of hosts) h.send("vr:join", { id });
      });
      server.ws.on("vr:to-viewer", (msg) => viewers.get(msg.id)?.send("vr:signal", msg));
      server.ws.on("vr:to-host", (msg) => {
        for (const h of hosts) h.send("vr:signal", msg);
      });
      // Giroscópio do celular: para onde a cabeça está olhando.
      server.ws.on("vr:look", (msg) => {
        for (const h of hosts) h.send("vr:look", msg);
      });
      server.ws.on("vr:state", (state) => {
        live = state;
        for (const v of viewers.values()) v.send("vr:state", state);
      });

      // Reserva quando o WebRTC não conecta (rede que bloqueia UDP): quadros JPEG
      // binários em ws://.../vr-frames. O host manda, o servidor repassa a quem assiste.
      const frames = new WebSocketServer({ noServer: true });
      const frameHosts = new Set();
      const frameViewers = new Set();
      const announce = () => {
        for (const h of frameHosts) if (h.readyState === 1) h.send(JSON.stringify({ viewers: frameViewers.size }));
      };
      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url, "http://x");
        if (url.pathname !== "/vr-frames") return;
        frames.handleUpgrade(req, socket, head, (ws) => {
          const role = url.searchParams.get("role");
          const set = role === "host" ? frameHosts : frameViewers;
          set.add(ws);
          ws.on("close", () => { set.delete(ws); announce(); });
          ws.on("error", () => {});
          if (role === "host") {
            ws.on("message", (data, isBinary) => {
              if (!isBinary) return;
              for (const v of frameViewers) if (v.readyState === 1 && v.bufferedAmount < 1_000_000) v.send(data, { binary: true });
            });
          }
          announce();
        });
      });

      // /mobile sem barra também abre a página do óculos.
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/mobile" || req.url?.startsWith("/mobile?")) req.url = req.url.replace("/mobile", "/mobile/");
        next();
      });
    },
  };
}

export default defineConfig({
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  // HTTPS=1 liga o https (alguns celulares só liberam o giroscópio em página segura).
  // Padrão é http, que abre em qualquer celular; o giroscópio funciona com a flag do Chrome (ver /mobile).
  plugins: [...(process.env.HTTPS === "1" ? [basicSsl()] : []), vrRelay()],
  build: {
    rollupOptions: {
      input: { main: resolve(ROOT, "index.html"), mobile: resolve(ROOT, "mobile/index.html") },
    },
  },
});
