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
  /** uid do parceiro — só usado pelo status "link" (Elo). */
  partner?: string;
  /** Aplicado durante o turno do próprio campeão: só vale a partir do próximo (ver tick.ts). */
  fresh?: boolean;
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
  /** Reflexo proporcional (Vingança do Escudo do Varek) — se definido, tem prioridade sobre `reflect` (fixo). */
  reflectPercent?: number;
  /** Mana pessoal — só serve pras próprias cartas (poções, sacrifícios, buffs). */
  personalMana: number;
  /** Sacrifício da passiva usado neste turno (a maioria é 1x por turno). */
  sacrificeUsedThisTurn: boolean;
  lastHitBy: { team: TeamId; champion: string } | null;
  /** Mortes acumuladas na partida — aumenta outTurns a cada vez (ver death.ts). */
  deaths: number;
  /** Turnos da própria equipe que faltam até poder voltar (0 = volta no início do próximo). */
  outTurns: number;
  /** Mão guardada enquanto está fora de campo — devolvida ao baralho ao voltar. */
  limbo: CardInstanceV2[];
  /** Não pode ser alvo nem atingido por áreas: campeão recém-voltado da morte, até o fim do próprio turno. */
  untargetable: boolean;
}

/**
 * Efeito persistente no chão (fogo, veneno) — não pertence a nenhum campeão,
 * fica na casa até expirar. Ver tick.ts (dano/veneno por rodada) e
 * effects.ts (ground_fire/venom_zone criam essas entradas).
 */
export interface GroundEffectV2 {
  id: number;
  kind: "fire" | "venom";
  pos: Hex;
  radius: number;
  team: TeamId;
  remaining: number;
  /** "fire": dano por rodada a quem estiver na área. */
  damagePerRound?: number;
  /** "venom": pilhas de veneno por rodada a quem estiver na área. */
  stacksPerRound?: number;
}

/**
 * Parede do motor hexagonal (roster v2) — igual a Wall do MVP, mas sem a
 * distinção de "kind" (nenhuma carta v2 encontrada até agora cria parede
 * baixa; todas são sólidas, bloqueiam movimento e alcance igual). Tem hp,
 * mas por enquanto nada reduz esse hp além de `destroy_wall` removê-la
 * direto — dano contra parede ainda não está ligado (ver KANBAN.md).
 */
export interface WallV2 {
  id: number;
  pos: Hex;
  hp: number;
  team: TeamId;
  /** Rodadas restantes; null = permanente (Reforçar ★★★ do Dorin). */
  remaining: number | null;
  /** Pilar ★★★ do Dorin: também bloqueia ataques à distância através da casa. */
  blocksRangedAttacks?: boolean;
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
  /** Bônus da próxima carta jogada pela equipe (Passo das Sombras da Vextra), consumido em cardPlay.ts. */
  nextCardBuff: { bonusDamage: number } | null;
  turnsTaken: number;
}

export type PhaseV2 = "draw" | "act" | "discard";

/** Item na pilha de respostas rápidas (ver turn.ts) — carta ou habilidade básica já validada e paga, aguardando resolução (ou resposta do adversário). */
export interface StackItemV2 {
  kind: "card" | "basic";
  team: TeamId;
  owner: string;
  cardId: string;
  rank: number;
  target: import("./targeting").TargetV2;
  buff?: { bonusDamage: number };
}

export interface PendingV2 {
  stack: StackItemV2[];
  /** Equipe que pode responder agora com uma carta rápida (ou passar). */
  priority: TeamId;
  /** Respostas encadeadas até agora (limite em balance.fast_cards.max_chained_responses). */
  chain: number;
}

export interface TurnStateV2 {
  team: TeamId;
  phase: PhaseV2;
  die: number;
  /** Campeão que está usando o movimento do turno agora. */
  main: string | null;
  /** Campeões que já gastaram o movimento deste turno (inclui `main`). */
  activated: string[];
  movementLeft: number;
  /** Campeões que já usaram a habilidade básica neste turno (uma vez cada). */
  basicUsed: string[];
}

export interface GameStateV2 {
  board: HexBoardConfig;
  teams: Record<TeamId, TeamStateV2>;
  round: number;
  winner: TeamId | null;
  nextId: number;
  rngState: number;
  log: string[];
  ground: GroundEffectV2[];
  walls: WallV2[];
  turn: TurnStateV2;
  pending: PendingV2 | null;
}

export function newTurnV2(team: TeamId, phase: PhaseV2): TurnStateV2 {
  return { team, phase, die: 0, main: null, activated: [], movementLeft: 0, basicUsed: [] };
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
        deaths: 0,
        outTurns: 0,
        limbo: [],
        untargetable: false,
      };
    });
    teams[teamId] = {
      id: teamId,
      mana: balance.mana_v2.start,
      champions,
      hand: [],
      decks,
      nextCardBuff: null,
      turnsTaken: 0,
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
    ground: [],
    walls: [],
    turn: newTurnV2("A", "draw"),
    pending: null,
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
