// Servidor v2 (motor hexagonal, roster de 10 campeões): entrega a página do
// cliente v2 e conversa com os jogadores por WebSocket. Espelha
// src/server/index.ts (MVP) ponto a ponto.
//
// Decisão de empacotamento: porta separada (PORT_V2, padrão 3001), não uma
// rota dentro do servidor do MVP. Os dois motores (MVP e v2) são JOGOS
// DIFERENTES que coexistem no mesmo repo enquanto o v2 é construído — cada um
// com seu próprio cliente buildado (dist/client vs dist/client-v2) e seu
// próprio protocolo de WebSocket em "/ws". Separar por porta evita qualquer
// risco de um roteador único misturar os dois no futuro (ex. um path "/v2"
// esquecido num `fetch` relativo do cliente) e deixa o MVP (produção atual)
// intocado: nada neste arquivo é importado por src/server/index.ts nem
// vice-versa. Uso: npm run build:client-v2 && npm run start:v2 (porta em
// PORT_V2, padrão 3001).
//
// createServerV2() (03/10/2026) extrai a montagem do servidor (http + wss +
// o protocolo de mensagens) pra uma função reutilizável, em vez de só código
// de topo de arquivo que já escuta a porta ao ser importado — isso permitia
// construir o servidor mas não testá-lo com um cliente WebSocket real (toda
// importação já tentaria ocupar a porta fixa PORT_V2, travando testes em
// paralelo e nunca fechando). A execução direta (`npm run start:v2`, via tsx)
// continua idêntica: o guard no fim do arquivo (comparando import.meta.url
// com o caminho do processo) chama createServerV2() com a porta de sempre só
// quando este arquivo é o ponto de entrada, nunca quando é importado por um
// teste. Ver tests/rejoin-v2.test.ts, que importa createServerV2 e abre dois
// clientes `ws` de verdade numa porta efêmera (porta 0).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { TeamId } from "../engine-v2/state";
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
  type RoomV2,
} from "./rooms-v2";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)), "dist", "client-v2");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Monta o servidor v2 (HTTP estático + WebSocket em "/ws") e só escuta se
 * `listen` não vier `false` (testes sobem o `http.Server` por fora, com
 * `listen(0)`, pra pegar uma porta livre do próprio sistema operacional).
 * Retorna o par `{ http, wss }`; quem chamou é responsável por fechar os dois
 * ao terminar (`wss.close()` antes de `http.close()`, senão `wss` mantém o
 * processo vivo).
 */
export function createServerV2(opts: { listen?: boolean; port?: number } = {}): { http: ReturnType<typeof createServer>; wss: WebSocketServer } {
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
    res.end("O cliente v2 ainda não foi compilado. Rode: npm run build:client-v2");
  }
});

const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 32 * 1024 });

interface Conn {
  room: RoomV2 | null;
  team: TeamId | null;
}
const conns = new WeakMap<WebSocket, Conn>();

const send = (ws: WebSocket, msg: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function broadcast(room: RoomV2): void {
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

const sweepTimer = setInterval(() => sweepRooms(), 10 * 60 * 1000);
sweepTimer.unref();

const port = opts.port ?? Number(process.env.PORT_V2 ?? 3001);
if (opts.listen !== false) http.listen(port, () => console.log(`Krósys v2 no ar: http://localhost:${port}`));

return { http, wss };
}

// Executado direto (`npm run start:v2`, via tsx) — nunca quando importado por um teste.
if (import.meta.url === `file://${process.argv[1]}`) createServerV2();
