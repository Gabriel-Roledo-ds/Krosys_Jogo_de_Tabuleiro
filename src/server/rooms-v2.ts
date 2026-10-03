// Salas do motor hexagonal (roster v2) — espelha src/server/rooms.ts (MVP) ponto a
// ponto, trocando o motor quadrado por GameStateV2/applyActionV2/turn.ts e os
// campeões por championsV2 (10 campeões, 3 por equipe). Ver src/server/index-v2.ts
// pra como isso é servido.

import type { WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { championsV2 } from "../engine-v2/data";
import { createGameV2, type GameStateV2, type TeamId } from "../engine-v2/state";
import { applyActionV2, IllegalActionV2, startGameV2, type ActionV2 } from "../engine-v2/turn";
import { greedyBotV2 } from "../bots-v2/greedy";
import { createRng } from "../engine/rng";
import { viewForV2 } from "./view-v2";
import type { Hex } from "../design/hexGrid";

export interface SeatV2 {
  name: string;
  token: string;
  ws: WebSocket | null;
  comp: string[] | null;
  bot: boolean;
}

export interface RoomV2 {
  code: string;
  seats: Record<TeamId, SeatV2 | null>;
  state: GameStateV2 | null;
  botFns: Partial<Record<TeamId, ReturnType<typeof greedyBotV2>>>;
  timer: ReturnType<typeof setTimeout> | null;
  lastActive: number;
}

const rooms = new Map<string, RoomV2>();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_DELAY_MS = 220;

function newCode(): string {
  for (;;) {
    const bytes = randomBytes(4);
    const code = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    if (!rooms.has(code)) return code;
  }
}

export const getRoom = (code: string): RoomV2 | undefined => rooms.get(code.toUpperCase());

const newToken = () => randomBytes(16).toString("hex");
const cleanName = (n: unknown, fallback: string) => (typeof n === "string" && n.trim() ? n.trim().slice(0, 20) : fallback);

export function createRoom(ws: WebSocket, name: unknown): { room: RoomV2; team: TeamId; token: string } {
  const room: RoomV2 = { code: newCode(), seats: { A: null, B: null }, state: null, botFns: {}, timer: null, lastActive: Date.now() };
  const token = newToken();
  room.seats.A = { name: cleanName(name, "Jogador 1"), token, ws, comp: null, bot: false };
  rooms.set(room.code, room);
  return { room, team: "A", token };
}

export function joinRoom(room: RoomV2, ws: WebSocket, name: unknown): { team: TeamId; token: string } | null {
  if (room.state) return null;
  if (room.seats.B && !room.seats.B.bot) return null;
  const token = newToken();
  room.seats.B = { name: cleanName(name, "Jogador 2"), token, ws, comp: room.seats.B?.comp ?? null, bot: false };
  return { team: "B", token };
}

export function rejoin(room: RoomV2, ws: WebSocket, token: unknown): TeamId | null {
  for (const t of ["A", "B"] as TeamId[]) {
    const seat = room.seats[t];
    if (seat && !seat.bot && seat.token === token) {
      seat.ws = ws;
      return t;
    }
  }
  return null;
}

export function addBot(room: RoomV2): boolean {
  if (room.state || room.seats.B) return false;
  room.seats.B = { name: "Bot", token: "", ws: null, comp: null, bot: true };
  return true;
}

export function validComp(comp: unknown): comp is string[] {
  if (!Array.isArray(comp) || comp.length !== 3) return false;
  const ids = new Set(championsV2.map((c) => c.id));
  return comp.every((c) => typeof c === "string" && ids.has(c)) && new Set(comp).size === 3;
}

const DEFAULT_BOT_COMP = ["borak", "dorin", "aurelia"];

export function startRoom(room: RoomV2): string | null {
  if (room.state) return "A partida já começou";
  const a = room.seats.A;
  const b = room.seats.B;
  if (!a || !b) return "Falta um jogador";
  if (b.bot && !b.comp) b.comp = DEFAULT_BOT_COMP;
  if (!a.comp || !b.comp) return "Os dois jogadores precisam escolher os 3 campeões";
  const seed = randomBytes(4).readUInt32LE(0);
  room.state = createGameV2(seed, { comp: { A: a.comp, B: b.comp } });
  startGameV2(room.state);
  for (const t of ["A", "B"] as TeamId[]) {
    if (room.seats[t]?.bot) room.botFns[t] = greedyBotV2({}, createRng(seed + (t === "A" ? 1 : 2)));
  }
  return null;
}

/** Ação vinda da rede: confere o formato antes de chegar ao motor (coordenadas axiais {q,r}). */
export function sanitizeAction(raw: unknown): ActionV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.length < 80;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
  const hex = (v: unknown): v is Hex => !!v && typeof v === "object" && Number.isInteger((v as Hex).q) && Number.isInteger((v as Hex).r);
  const target = (v: unknown) => {
    if (v === undefined) return {};
    if (!v || typeof v !== "object") return null;
    const t = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (t.uid !== undefined) { if (!str(t.uid)) return null; out.uid = t.uid; }
    if (t.pos !== undefined) { if (!hex(t.pos)) return null; out.pos = t.pos; }
    if (t.pos2 !== undefined) { if (!hex(t.pos2)) return null; out.pos2 = t.pos2; }
    if (t.dir !== undefined) { if (!hex(t.dir)) return null; out.dir = t.dir; }
    return out;
  };
  switch (a.type) {
    case "draw":
      return str(a.champion) ? { type: "draw", champion: a.champion } : null;
    case "skipDraw":
      return { type: "skipDraw" };
    case "stay":
      return str(a.champion) ? { type: "stay", champion: a.champion } : null;
    case "move":
      if (!hex(a.to)) return null;
      if (a.champion !== undefined && !str(a.champion)) return null;
      return { type: "move", to: a.to, champion: a.champion as string | undefined };
    case "play": {
      const t = target(a.target);
      if (!num(a.rank)) return null;
      return str(a.card) && t ? { type: "play", card: a.card, rank: a.rank, target: t } : null;
    }
    case "basic": {
      const t = target(a.target);
      if (!t) return null;
      if (a.champion !== undefined && !str(a.champion)) return null;
      return { type: "basic", target: t, champion: a.champion as string | undefined };
    }
    case "discard":
      return str(a.card) ? { type: "discard", card: a.card } : null;
    case "sacrifice":
      if (!str(a.champion)) return null;
      if (a.target !== undefined && !str(a.target)) return null;
      return { type: "sacrifice", champion: a.champion, target: a.target as string | undefined };
    case "toggleFast":
      if (typeof a.enabled !== "boolean") return null;
      return { type: "toggleFast", enabled: a.enabled };
    case "pass":
    case "end":
      return { type: a.type };
    default:
      return null;
  }
}

export type BroadcastV2 = (room: RoomV2) => void;

/** Aplica uma ação humana. Devolve uma mensagem de erro, ou null se deu certo. */
export function handleAction(room: RoomV2, team: TeamId, action: ActionV2, broadcast: BroadcastV2): string | null {
  const s = room.state;
  if (!s) return "A partida ainda não começou";
  room.lastActive = Date.now();
  try {
    applyActionV2(s, team, action);
  } catch (e) {
    if (e instanceof IllegalActionV2) return e.message;
    console.error("Erro no motor v2:", e);
    return "Erro interno ao aplicar a ação";
  }
  broadcast(room);
  scheduleBots(room, broadcast);
  return null;
}

/** Se quem deve agir é um bot, joga depois de uma pequena pausa (para dar para acompanhar). */
export function scheduleBots(room: RoomV2, broadcast: BroadcastV2): void {
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
      applyActionV2(st, t, bot(st, t));
    } catch (e) {
      console.error("Erro do bot v2:", e);
      try {
        applyActionV2(st, t, st.pending ? { type: "pass" } : { type: "end" });
      } catch {
        return;
      }
    }
    broadcast(room);
    scheduleBots(room, broadcast);
  }, BOT_DELAY_MS);
}

export function lobbyView(room: RoomV2, me: TeamId) {
  const seat = (t: TeamId) => {
    const x = room.seats[t];
    return x && { name: x.name, bot: x.bot, comp: x.comp, connected: x.bot || !!x.ws };
  };
  return { code: room.code, me, seats: { A: seat("A"), B: seat("B") }, started: !!room.state };
}

export function gameView(room: RoomV2, team: TeamId) {
  return room.state ? viewForV2(room.state, team) : null;
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
