// Estado único do jogo. Tudo é dado simples (serializável em JSON), para o servidor
// poder guardar, enviar e restaurar a partida.

import { balance, bossDef, deckCardIds, getChampionDef, monsterPlacements, monsterTypes } from "./data";
import type { Pos } from "./board";
import { rngOf } from "./rng";

export type TeamId = "A" | "B";
export const TEAM_IDS: TeamId[] = ["A", "B"];
export const otherTeam = (t: TeamId): TeamId => (t === "A" ? "B" : "A");

export interface CardInstance {
  uid: string;
  cardId: string;
  /** uid do campeão dono (alcance e linha de visão contam a partir dele) */
  owner: string;
  /** carta de recompensa de monstro: não conta para o limite da mão */
  monster: boolean;
}

export interface Status {
  id: number;
  kind: "mark" | "move_penalty" | "immobilized" | "stunned" | "silenced" | "hot" | "link" | "control_immune";
  unit: "rounds" | "champion_turns";
  remaining: number;
  amount?: number;
  /** uid do parceiro (Elo) */
  partner?: string;
  /** Aplicado durante o turno do próprio campeão: só vale a partir do próximo. */
  fresh?: boolean;
  negative: boolean;
}

export interface ChampionState {
  kind: "champion";
  /** Único na partida, por exemplo "A-atirador". */
  uid: string;
  defId: string;
  team: TeamId;
  hp: number;
  maxHp: number;
  defense: number;
  pos: Pos;
  alive: boolean;
  /** Imune depois de voltar da morte, até o fim do primeiro turno em que for o principal. */
  untargetable: boolean;
  statuses: Status[];
  shield: number;
  reflect: number;
  /** Rodada em que sofreu o último efeito de controle (limite de 1 por rodada). */
  lastControlRound: number;
  /** Cartas da mão que voltam ao baralho quando ele retorna da morte. */
  limbo: CardInstance[];
  /** Último a causar dano nele (para o último hit). */
  lastHitBy: { team: TeamId; champion: string } | null;
}

export interface MonsterState {
  kind: "monster";
  uid: string;
  type: string;
  hp: number;
  maxHp: number;
  defense: number;
  pos: Pos;
  alive: boolean;
  rewardCard: string;
  statuses: Status[];
  lastHitBy: { team: TeamId; champion: string } | null;
}

export interface MinionState {
  kind: "minion";
  uid: string;
  hp: number;
  maxHp: number;
  defense: number;
  damage: number;
  pos: Pos;
  alive: boolean;
  statuses: Status[];
  lastHitBy: { team: TeamId; champion: string } | null;
}

export interface BossState {
  kind: "boss";
  uid: "boss";
  hp: number;
  maxHp: number;
  defense: number;
  /** Alcance de ativação. */
  range: number;
  pos: Pos;
  alive: boolean;
  deck: string[];
  discard: string[];
  /** Aura ativa (no máximo 1). */
  aura: { cardId: string; cardsLeft?: number } | null;
  /** Redução de dano da Carapaça, até a próxima ativação. */
  damageReduction: number;
  lastAttacker: string | null;
  statuses: Status[];
  lastHitBy: { team: TeamId; champion: string } | null;
}

export type Unit = ChampionState | MonsterState | MinionState | BossState;

export interface DeckState {
  draw: CardInstance[];
  discard: CardInstance[];
}

export interface TeamState {
  id: TeamId;
  mana: number;
  champions: ChampionState[];
  hand: CardInstance[];
  decks: Record<string, DeckState>;
  turnsTaken: number;
  resurrectUsed: boolean;
  /** Mira Total: bônus da próxima carta. */
  nextCardBuff: { range: number; damage: number } | null;
}

export interface Wall {
  id: number;
  pos: Pos;
  hp: number;
  kind: "weak" | "low" | "normal";
  team: TeamId;
  /** Rodadas restantes; null = permanente. */
  remaining: number | null;
}

export interface GroundEffect {
  id: number;
  kind: "fire" | "fire_wall" | "slow";
  pos: Pos;
  damage: number;
  remaining: number;
  team: TeamId;
}

export interface Trap {
  id: number;
  pos: Pos;
  damage: number;
  team: TeamId;
}

export interface Spring {
  id: number;
  pos: Pos;
  dir: Pos;
  distance: number;
  team: TeamId;
  remaining: number;
}

export interface Structure {
  id: number;
  pos: Pos;
  hp: number;
  kind: "watchtower";
  damage: number;
  range: number;
  team: TeamId;
}

export interface PortalPair {
  id: number;
  a: Pos;
  b: Pos;
  team: TeamId;
  remaining: number;
}

export interface Watch {
  id: number;
  owner: string;
  team: TeamId;
  range: number;
  damage: number;
}

export type Target = {
  uid?: string;
  uid2?: string;
  pos?: Pos;
  pos2?: Pos;
  dir?: Pos;
  moves?: Record<string, Pos>;
};

export interface StackItem {
  kind: "card" | "basic" | "boss";
  team: TeamId;
  /** uid do campeão que age (não existe para o boss) */
  owner?: string;
  cardId: string;
  target: Target;
  /** bônus da Mira Total consumido por esta carta */
  buff?: { range: number; damage: number };
}

export interface PendingState {
  stack: StackItem[];
  /** Quem pode responder agora. */
  priority: TeamId;
  /** Respostas encadeadas até agora. */
  chain: number;
}

export type Phase = "boss" | "draw" | "choose" | "act" | "discard" | "over";

export interface TurnState {
  team: TeamId;
  phase: Phase;
  main: string | null;
  die: number;
  movementLeft: number;
  moved: number;
  startPositions: Record<string, Pos>;
  trail: Pos[];
  basicUsed: boolean;
  phasing: boolean;
  manaBonusGiven: boolean;
  /** Efeitos de controle do campeão principal, lidos ao escolhê-lo. */
  stunned: boolean;
  silenced: boolean;
  /** Passo Ágil usado neste turno: mana extra se andar longe. */
  stepBonus: { distance: number; amount: number } | null;
}

export interface GameState {
  width: number;
  height: number;
  teams: Record<TeamId, TeamState>;
  monsters: MonsterState[];
  minions: MinionState[];
  boss: BossState;
  walls: Wall[];
  ground: GroundEffect[];
  traps: Trap[];
  springs: Spring[];
  structures: Structure[];
  portals: PortalPair[];
  watches: Watch[];
  pending: PendingState | null;
  turn: TurnState;
  round: number;
  winner: TeamId | null;
  nextId: number;
  rngState: number;
  log: string[];
}

export function createGame(comp: Record<TeamId, string[]>, seed: number): GameState {
  const holder = { rngState: seed >>> 0 };
  const rng = rngOf(holder);

  const teams = {} as Record<TeamId, TeamState>;
  for (const id of TEAM_IDS) {
    const ids = comp[id];
    if (ids.length !== balance.teams.champions_per_team) {
      throw new Error(`A equipe ${id} precisa de ${balance.teams.champions_per_team} campeões`);
    }
    const startCells = balance.teams.start_areas[id];
    const decks: Record<string, DeckState> = {};
    const champions = ids.map((defId, i): ChampionState => {
      const def = getChampionDef(defId);
      const uid = `${id}-${defId}`;
      const cards: CardInstance[] = deckCardIds(defId).map((cardId) => ({
        uid: `${uid}#${cardId}`,
        cardId,
        owner: uid,
        monster: false,
      }));
      decks[uid] = { draw: rng.shuffle(cards), discard: [] };
      return {
        kind: "champion",
        uid,
        defId,
        team: id,
        hp: def.hp,
        maxHp: def.hp,
        defense: def.defense,
        pos: { ...startCells[i] },
        alive: true,
        untargetable: false,
        statuses: [],
        shield: 0,
        reflect: 0,
        lastControlRound: 0,
        limbo: [],
        lastHitBy: null,
      };
    });
    teams[id] = {
      id,
      mana: balance.mana.start,
      champions,
      hand: [],
      decks,
      turnsTaken: 0,
      resurrectUsed: false,
      nextCardBuff: null,
    };
  }

  const monsters: MonsterState[] = monsterPlacements.map((m) => ({
    kind: "monster",
    uid: m.id,
    type: m.type,
    hp: monsterTypes[m.type].hp,
    maxHp: monsterTypes[m.type].hp,
    defense: monsterTypes[m.type].defense,
    pos: { ...m.position },
    alive: true,
    rewardCard: monsterTypes[m.type].reward_card,
    statuses: [],
    lastHitBy: null,
  }));

  const boss: BossState = {
    kind: "boss",
    uid: "boss",
    hp: bossDef.hp,
    maxHp: bossDef.hp,
    defense: bossDef.defense,
    range: bossDef.range,
    pos: { ...balance.board.boss_position },
    alive: true,
    deck: rng.shuffle(bossDef.deck.map((c) => c.id)),
    discard: [],
    aura: null,
    damageReduction: 0,
    lastAttacker: null,
    statuses: [],
    lastHitBy: null,
  };

  return {
    width: balance.board.width,
    height: balance.board.height,
    teams,
    monsters,
    minions: [],
    boss,
    walls: [],
    ground: [],
    traps: [],
    springs: [],
    structures: [],
    portals: [],
    watches: [],
    pending: null,
    turn: newTurn("A", "boss"),
    round: 1,
    winner: null,
    nextId: 1,
    rngState: holder.rngState,
    log: [],
  };
}

export function newTurn(team: TeamId, phase: Phase): TurnState {
  return {
    team,
    phase,
    main: null,
    die: 0,
    movementLeft: 0,
    moved: 0,
    startPositions: {},
    trail: [],
    basicUsed: false,
    phasing: false,
    manaBonusGiven: false,
    stunned: false,
    silenced: false,
    stepBonus: null,
  };
}

export const allChampions = (s: GameState): ChampionState[] => [...s.teams.A.champions, ...s.teams.B.champions];

export const getChampion = (s: GameState, uid: string): ChampionState => {
  const c = allChampions(s).find((x) => x.uid === uid);
  if (!c) throw new Error(`Campeão inexistente: ${uid}`);
  return c;
};

export const teamOf = (s: GameState, uid: string): TeamState => s.teams[getChampion(s, uid).team];

export function nextId(s: GameState): number {
  return s.nextId++;
}

export function log(s: GameState, msg: string): void {
  s.log.push(msg);
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}
