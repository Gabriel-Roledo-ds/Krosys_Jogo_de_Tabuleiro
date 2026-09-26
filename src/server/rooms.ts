// Salas: dois lugares (equipes A e B), cada um humano ou bot. O servidor guarda o estado
// e valida tudo com o motor; os jogadores só enviam intenções.

import type { WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { championDefs } from "../engine/data";
import { createGame, type GameState, type TeamId } from "../engine/state";
import { applyAction, IllegalAction, startGame, type Action } from "../engine/turn";
import { greedyBot } from "../bots/greedy";
import { createRng } from "../engine/rng";
import { viewFor } from "./view";
import type { Pos } from "../engine/board";

export interface Seat {
  name: string;
  token: string;
  ws: WebSocket | null;
  comp: string[] | null;
  bot: boolean;
}

export interface Room {
  code: string;
  seats: Record<TeamId, Seat | null>;
  state: GameState | null;
  botFns: Partial<Record<TeamId, ReturnType<typeof greedyBot>>>;
  timer: ReturnType<typeof setTimeout> | null;
  lastActive: number;
}

const rooms = new Map<string, Room>();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_DELAY_MS = 220;

function newCode(): string {
  for (;;) {
    const bytes = randomBytes(4);
    const code = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    if (!rooms.has(code)) return code;
  }
}

export const getRoom = (code: string): Room | undefined => rooms.get(code.toUpperCase());

const newToken = () => randomBytes(16).toString("hex");
const cleanName = (n: unknown, fallback: string) => (typeof n === "string" && n.trim() ? n.trim().slice(0, 20) : fallback);

export function createRoom(ws: WebSocket, name: unknown): { room: Room; team: TeamId; token: string } {
  const room: Room = { code: newCode(), seats: { A: null, B: null }, state: null, botFns: {}, timer: null, lastActive: Date.now() };
  const token = newToken();
  room.seats.A = { name: cleanName(name, "Jogador 1"), token, ws, comp: null, bot: false };
  rooms.set(room.code, room);
  return { room, team: "A", token };
}

export function joinRoom(room: Room, ws: WebSocket, name: unknown): { team: TeamId; token: string } | null {
  if (room.state) return null;
  if (room.seats.B && !room.seats.B.bot) return null;
  const token = newToken();
  room.seats.B = { name: cleanName(name, "Jogador 2"), token, ws, comp: room.seats.B?.comp ?? null, bot: false };
  return { team: "B", token };
}

export function rejoin(room: Room, ws: WebSocket, token: unknown): TeamId | null {
  for (const t of ["A", "B"] as TeamId[]) {
    const seat = room.seats[t];
    if (seat && !seat.bot && seat.token === token) {
      seat.ws = ws;
      return t;
    }
  }
  return null;
}

export function addBot(room: Room): boolean {
  if (room.state || room.seats.B) return false;
  room.seats.B = { name: "Bot", token: "", ws: null, comp: null, bot: true };
  return true;
}

export function validComp(comp: unknown): comp is string[] {
  if (!Array.isArray(comp) || comp.length !== 3) return false;
  const ids = new Set(championDefs.map((c) => c.id));
  return comp.every((c) => typeof c === "string" && ids.has(c)) && new Set(comp).size === 3;
}

export function startRoom(room: Room): string | null {
  if (room.state) return "A partida já começou";
  const a = room.seats.A;
  const b = room.seats.B;
  if (!a || !b) return "Falta um jogador";
  if (b.bot && !b.comp) b.comp = ["arquiteto", "andarilho", "curandeiro"];
  if (!a.comp || !b.comp) return "Os dois jogadores precisam escolher os 3 campeões";
  const seed = randomBytes(4).readUInt32LE(0);
  room.state = createGame({ A: a.comp, B: b.comp }, seed);
  startGame(room.state);
  for (const t of ["A", "B"] as TeamId[]) {
    if (room.seats[t]?.bot) room.botFns[t] = greedyBot({}, createRng(seed + (t === "A" ? 1 : 2)));
  }
  return null;
}

/** Ação vinda da rede: confere o formato antes de chegar ao motor. */
export function sanitizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.length < 80;
  const pos = (v: unknown): v is Pos => !!v && typeof v === "object" && Number.isInteger((v as Pos).x) && Number.isInteger((v as Pos).y);
  const target = (v: unknown) => {
    if (v === undefined) return {};
    if (!v || typeof v !== "object") return null;
    const t = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (t.uid !== undefined) { if (!str(t.uid)) return null; out.uid = t.uid; }
    if (t.uid2 !== undefined) { if (!str(t.uid2)) return null; out.uid2 = t.uid2; }
    if (t.pos !== undefined) { if (!pos(t.pos)) return null; out.pos = t.pos; }
    if (t.pos2 !== undefined) { if (!pos(t.pos2)) return null; out.pos2 = t.pos2; }
    if (t.dir !== undefined) { if (!pos(t.dir)) return null; out.dir = t.dir; }
    return out;
  };
  switch (a.type) {
    case "draw":
      return str(a.champion) ? { type: "draw", champion: a.champion } : null;
    case "stay":
      return str(a.champion) ? { type: "stay", champion: a.champion } : null;
    case "move":
      if (!pos(a.to)) return null;
      if (a.champion !== undefined && !str(a.champion)) return null;
      return { type: "move", to: a.to, champion: a.champion as string | undefined };
    case "play": {
      const t = target(a.target);
      return str(a.card) && t ? { type: "play", card: a.card, target: t } : null;
    }
    case "basic": {
      const t = target(a.target);
      if (!t) return null;
      if (a.champion !== undefined && !str(a.champion)) return null;
      return { type: "basic", target: t, champion: a.champion as string | undefined };
    }
    case "discard":
      return str(a.card) ? { type: "discard", card: a.card } : null;
    case "pass":
    case "end":
    case "skipDraw":
      return { type: a.type };
    default:
      return null;
  }
}

export type Broadcast = (room: Room) => void;

/** Aplica uma ação humana. Devolve uma mensagem de erro, ou null se deu certo. */
export function handleAction(room: Room, team: TeamId, action: Action, broadcast: Broadcast): string | null {
  const s = room.state;
  if (!s) return "A partida ainda não começou";
  room.lastActive = Date.now();
  try {
    applyAction(s, team, action);
  } catch (e) {
    if (e instanceof IllegalAction) return e.message;
    console.error("Erro no motor:", e);
    return "Erro interno ao aplicar a ação";
  }
  broadcast(room);
  scheduleBots(room, broadcast);
  return null;
}

/** Se quem deve agir é um bot, joga depois de uma pequena pausa (para dar para acompanhar). */
export function scheduleBots(room: Room, broadcast: Broadcast): void {
  const s = room.state;
  if (!s || s.winner || room.timer) return;
  const team: TeamId = s.pending ? s.pending.priority : s.turn.team;
  const fn = room.botFns[team];
  if (!fn) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    const st = room.state;
    if (!st || st.winner) return;
    const t: TeamId = st.pending ? st.pending.priority : st.turn.team;
    const bot = room.botFns[t];
    if (!bot) return;
    try {
      applyAction(st, t, bot(st, t));
    } catch (e) {
      console.error("Erro do bot:", e);
      try {
        applyAction(st, t, st.pending ? { type: "pass" } : { type: "end" });
      } catch {
        return;
      }
    }
    broadcast(room);
    scheduleBots(room, broadcast);
  }, BOT_DELAY_MS);
}

export function lobbyView(room: Room, me: TeamId) {
  const seat = (t: TeamId) => {
    const x = room.seats[t];
    return x && { name: x.name, bot: x.bot, comp: x.comp, connected: x.bot || !!x.ws };
  };
  return { code: room.code, me, seats: { A: seat("A"), B: seat("B") }, started: !!room.state };
}

export function gameView(room: Room, team: TeamId) {
  return room.state ? viewFor(room.state, team) : null;
}

/** Limpa salas paradas há mais de 3 horas. */
export function sweepRooms(now = Date.now()): void {
  for (const [code, room] of rooms) {
    if (now - room.lastActive > 3 * 3600 * 1000) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}

export const roomCount = () => rooms.size;
