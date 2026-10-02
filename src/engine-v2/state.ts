// Estado do motor hexagonal (roster v2). Espelha a forma de src/engine/state.ts,
// mas em coordenadas axiais (Hex) e com mana de equipe + mana pessoal. Ainda não
// é o jogo jogável — ver KANBAN.md ("Construir motor hexagonal").

import type { Hex } from "../design/hexGrid";
import { hexBoard, startAreaCells, type HexBoardConfig } from "../design/hexBoard";
import { rngOf, type RngHolder } from "../engine/rng";
import { balance } from "../engine/data";
import { deckCardIdsV2, getChampionDefV2 } from "./data";

export type TeamId = "A" | "B";
export const TEAM_IDS: TeamId[] = ["A", "B"];
export const otherTeam = (t: TeamId): TeamId => (t === "A" ? "B" : "A");

export interface CardInstanceV2 {
  uid: string;
  cardId: string;
  /** uid do campeão dono (alcance e linha de visão contam a partir dele). */
  owner: string;
}

export interface StatusV2 {
  id: number;
  status: string;
  unit: "rounds" | "champion_turns";
  remaining: number;
  amount?: number;
  negative: boolean;
}

export interface ChampionStateV2 {
  kind: "champion";
  uid: string;
  defId: string;
  team: TeamId;
  hp: number;
  maxHp: number;
  defense: number;
  pos: Hex;
  alive: boolean;
  statuses: StatusV2[];
  shield: number;
  reflect: number;
  /** Mana pessoal — só serve pras próprias cartas (poções, sacrifícios, buffs). */
  personalMana: number;
  /** Sacrifício da passiva usado neste turno (a maioria é 1x por turno). */
  sacrificeUsedThisTurn: boolean;
  lastHitBy: { team: TeamId; champion: string } | null;
}

export interface DeckStateV2 {
  draw: CardInstanceV2[];
  discard: CardInstanceV2[];
}

export interface TeamStateV2 {
  id: TeamId;
  mana: number;
  champions: ChampionStateV2[];
  hand: CardInstanceV2[];
  decks: Record<string, DeckStateV2>;
}

export interface GameStateV2 {
  board: HexBoardConfig;
  teams: Record<TeamId, TeamStateV2>;
  round: number;
  winner: TeamId | null;
  nextId: number;
  rngState: number;
  log: string[];
}

const DEFAULT_TEAM_COMPOSITION: Record<TeamId, string[]> = {
  A: ["niara", "varek", "selene"],
  B: ["borak", "dorin", "aurelia"],
};

const DEFAULT_POTIONS: ("life" | "mana")[] = ["life", "life", "mana"];

export interface CreateGameV2Options {
  comp?: Record<TeamId, string[]>;
  potions?: Record<TeamId, ("life" | "mana")[][]>;
  board?: HexBoardConfig;
}

export function createGameV2(seed: number, options: CreateGameV2Options = {}): GameStateV2 {
  const board = options.board ?? hexBoard;
  const comp = options.comp ?? DEFAULT_TEAM_COMPOSITION;
  const holder: RngHolder = { rngState: seed >>> 0 };
  const rng = rngOf(holder);

  const teams = {} as Record<TeamId, TeamStateV2>;
  for (const teamId of TEAM_IDS) {
    const championIds = comp[teamId];
    if (championIds.length !== balance.teams.champions_per_team) {
      throw new Error(`A equipe ${teamId} precisa de ${balance.teams.champions_per_team} campeões`);
    }
    const startCells = startAreaCells(teamId === "A" ? "equipe_a" : "equipe_b", board);
    const decks: Record<string, DeckStateV2> = {};
    const champions: ChampionStateV2[] = championIds.map((defId, i): ChampionStateV2 => {
      const def = getChampionDefV2(defId);
      const uid = `${teamId}-${defId}`;
      const potionChoice = options.potions?.[teamId]?.[i] ?? DEFAULT_POTIONS;
      const cardIds = deckCardIdsV2(defId, potionChoice);
      const cards: CardInstanceV2[] = cardIds.map((cardId, j) => ({
        uid: `${uid}#${cardId}#${j}`,
        cardId,
        owner: uid,
      }));
      decks[uid] = { draw: rng.shuffle(cards), discard: [] };
      return {
        kind: "champion",
        uid,
        defId,
        team: teamId,
        hp: def.hp,
        maxHp: def.hp,
        defense: def.defense,
        pos: { ...startCells[i % startCells.length] },
        alive: true,
        statuses: [],
        shield: 0,
        reflect: 0,
        personalMana: 0,
        sacrificeUsedThisTurn: false,
        lastHitBy: null,
      };
    });
    teams[teamId] = {
      id: teamId,
      mana: balance.mana.start,
      champions,
      hand: [],
      decks,
    };
  }

  return {
    board,
    teams,
    round: 1,
    winner: null,
    nextId: 1,
    rngState: holder.rngState,
    log: [],
  };
}

export const allChampionsV2 = (s: GameStateV2): ChampionStateV2[] => [...s.teams.A.champions, ...s.teams.B.champions];

export const getChampionV2 = (s: GameStateV2, uid: string): ChampionStateV2 => {
  const c = allChampionsV2(s).find((x) => x.uid === uid);
  if (!c) throw new Error(`Campeão inexistente: ${uid}`);
  return c;
};

export function nextIdV2(s: GameStateV2): number {
  return s.nextId++;
}

export function logV2(s: GameStateV2, msg: string): void {
  s.log.push(msg);
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}
