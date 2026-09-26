// Servidor: entrega a página do jogo e conversa com os jogadores por WebSocket.
// Uso: npm run build:client && npm start   (porta em PORT, padrão 3000)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { TeamId } from "../engine/state";
import {
  addBot,
  createRoom,
  gameView,
  getRoom,
  handleAction,
  joinRoom,
  lobbyView,
  rejoin,
  roomCount,
  sanitizeAction,
  scheduleBots,
  startRoom,
  sweepRooms,
  validComp,
  type Room,
} from "./rooms";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)), "dist", "client");
const PORT = Number(process.env.PORT ?? 3000);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: roomCount() }));
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.includes("..")) {
    res.writeHead(400).end("Bad request");
    return;
  }
  let file = join(ROOT, rel);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
  } catch {
    file = join(ROOT, "index.html"); // qualquer outro caminho volta para a página inicial
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
    res.end(body);
  } catch {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("O cliente ainda não foi compilado. Rode: npm run build:client");
  }
});

const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 32 * 1024 });

interface Conn {
  room: Room | null;
  team: TeamId | null;
}
const conns = new WeakMap<WebSocket, Conn>();

const send = (ws: WebSocket, msg: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function broadcast(room: Room): void {
  for (const t of ["A", "B"] as TeamId[]) {
    const seat = room.seats[t];
    if (!seat || seat.bot || !seat.ws) continue;
    send(seat.ws, { t: "lobby", lobby: lobbyView(room, t) });
    const view = gameView(room, t);
    if (view) send(seat.ws, { t: "state", view });
  }
}

wss.on("connection", (ws) => {
  conns.set(ws, { room: null, team: null });

  ws.on("message", (data) => {
    const conn = conns.get(ws)!;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return send(ws, { t: "error", msg: "Mensagem inválida" });
    }
    const err = (m: string) => send(ws, { t: "error", msg: m });

    switch (msg.t) {
      case "create": {
        const { room, team, token } = createRoom(ws, msg.name);
        conn.room = room;
        conn.team = team;
        send(ws, { t: "joined", code: room.code, team, token });
        return broadcast(room);
      }
      case "join": {
        const room = typeof msg.code === "string" ? getRoom(msg.code) : undefined;
        if (!room) return err("Sala não encontrada");
        const r = joinRoom(room, ws, msg.name);
        if (!r) return err("A sala está cheia ou a partida já começou");
        conn.room = room;
        conn.team = r.team;
        send(ws, { t: "joined", code: room.code, team: r.team, token: r.token });
        return broadcast(room);
      }
      case "rejoin": {
        const room = typeof msg.code === "string" ? getRoom(msg.code) : undefined;
        if (!room) return send(ws, { t: "rejoin_failed" });
        const team = rejoin(room, ws, msg.token);
        if (!team) return send(ws, { t: "rejoin_failed" });
        conn.room = room;
        conn.team = team;
        send(ws, { t: "joined", code: room.code, team, token: msg.token });
        return broadcast(room);
      }
      default:
        break;
    }

    const { room, team } = conn;
    if (!room || !team) return err("Entre numa sala primeiro");
    room.lastActive = Date.now();

    switch (msg.t) {
      case "addBot":
        if (team !== "A") return err("Só quem criou a sala pode chamar o bot");
        if (!addBot(room)) return err("Não dá para adicionar o bot agora");
        return broadcast(room);
      case "setComp": {
        if (room.state) return err("A partida já começou");
        if (!validComp(msg.comp)) return err("Escolha 3 campeões diferentes");
        const seat = room.seats[team];
        if (seat) seat.comp = msg.comp;
        return broadcast(room);
      }
      case "start": {
        if (team !== "A") return err("Só quem criou a sala pode começar");
        const e = startRoom(room);
        if (e) return err(e);
        broadcast(room);
        return scheduleBots(room, broadcast);
      }
      case "action": {
        const action = sanitizeAction(msg.action);
        if (!action) return err("Ação inválida");
        const e = handleAction(room, team, action, broadcast);
        if (e) err(e);
        return;
      }
      case "ping":
        return send(ws, { t: "pong" });
      default:
        return err("Mensagem desconhecida");
    }
  });

  ws.on("close", () => {
    const conn = conns.get(ws);
    if (!conn?.room || !conn.team) return;
    const seat = conn.room.seats[conn.team];
    if (seat && seat.ws === ws) seat.ws = null;
  });
});

setInterval(() => sweepRooms(), 10 * 60 * 1000).unref();

http.listen(PORT, () => console.log(`Krósys no ar: http://localhost:${PORT}`));
