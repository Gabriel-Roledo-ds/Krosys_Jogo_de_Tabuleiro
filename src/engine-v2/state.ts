// Estado do motor hexagonal (roster v2). Espelha a forma de src/engine/state.ts,
// mas em coordenadas axiais (Hex) e com mana de equipe + mana pessoal. Ainda não
// é o jogo jogável — ver KANBAN.md ("Construir motor hexagonal").

import type { Hex } from "../design/hexGrid";
import { hexBoard, startAreaCells, type HexBoardConfig } from "../design/hexBoard";
import { placeMonstersWithSeed } from "../design/monsterPlacement";
import { getMonsterType, type Posture } from "../design/monsterReaction";
import { rngOf, type RngHolder } from "../engine/rng";
import { balance, bossDef } from "../engine/data";
import { deckCardIdsV2, getChampionDefV2 } from "./data";

export type TeamId = "A" | "B";
export const TEAM_IDS: TeamId[] = ["A", "B"];
export const otherTeam = (t: TeamId): TeamId => (t === "A" ? "B" : "A");

export interface CardInstanceV2 {
  uid: string;
  cardId: string;
  /** uid do campeão dono (alcance e linha de visão contam a partir dele). */
  owner: string;
  /** Carta de recompensa de monstro (ver monsters.ts): consumível, não volta pro baralho ao ser descartada. */
  monster?: boolean;
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
  /** Raio da explosão — só usado pelo status "death_ward" (Fênix Momentânea da Ignira, ver death.ts). */
  radius?: number;
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
  /** Morreu depois da morte do boss: não volta mais (ver boss.ts/death.ts). */
  permaDead: boolean;
  /** Vida máxima "de base" (sem bônus permanente de monstro) — ver monsters.ts, recomputeChampionBonusesV2. */
  baseMaxHp: number;
  /** Defesa "de base" (sem bônus permanente de monstro) — ver monsters.ts. */
  baseDefense: number;
  /** % de dano permanente (recompensa de monstro, soma de todos os grupos zona+nível+stat já mortos) — lido em damage.ts. */
  permanentDamageBonusPercent: number;
  /** Contagem de abates por grupo "zona:nível:stat:curva" (ver monsters.ts) — base pra recalcular o bônus permanente sem acumular versões antigas. */
  monsterStatGroups: Record<string, number>;
}

/** Monstro do mapa (roster v2, item 7 do KANBAN) — ver src/engine-v2/monsters.ts e src/design/{monsterPlacement,monsterReaction}.ts. */
export interface MonsterStateV2 {
  uid: string;
  typeId: string;
  zone: string;
  level: 1 | 2 | 3;
  pos: Hex;
  hp: number;
  maxHp: number;
  defense: number;
  posture: Posture;
  alive: boolean;
  /** Já foi atacada antes nesta sessão de combate (simplificação: nunca reseta — ver monsters.ts). */
  attackedBeforeThisCombat: boolean;
  /** Já "fugiu" (escolheu a opção de reação utilitária) uma vez, postura evasiva. */
  fledOnceThisCombat: boolean;
  lastAttacker: { team: TeamId; champion: string } | null;
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

/** Aura ativa do boss (no máximo 1 por vez) — ver boss.ts. */
export interface BossAuraV2 {
  cardId: string;
  /** Cartas restantes com o bônus (ex. Fúria: +dano nas próximas 2). undefined = sem contagem (dura até ser substituída). */
  cardsLeft?: number;
}

/**
 * Boss v2 — mesmo baralho/números do boss do MVP (data/boss.json), reaproveitado
 * por enquanto porque não existe design de boss específico pro roster v2 ainda
 * [PADRÃO, ver regras-e-decisoes.md §10/§18]. Ativa no alcance dele (em casas
 * hexagonais) igual ao MVP; ver src/engine-v2/boss.ts.
 */
export interface BossStateV2 {
  hp: number;
  maxHp: number;
  defense: number;
  pos: Hex;
  range: number;
  deck: string[];
  discard: string[];
  alive: boolean;
  aura: BossAuraV2 | null;
  /** Carapaça (Carapaça do boss): reduz dano recebido até a próxima ativação dele. */
  damageReduction: number;
  /** Último campeão que acertou o boss (carta "Devorar"). */
  lastAttacker: string | null;
}

/**
 * Lacaio do boss ("Prole", summon_minion) — versão mínima do MinionState do
 * MVP (src/engine/state.ts): só HP/dano/posição, sólido, alvo "enemy" único
 * (uid "minion-N", ver boss.ts/targeting.ts/cardPlay.ts). Diferente do MVP,
 * ainda NÃO ataca sozinho quem chega adjacente (`onLand`/hazards.ts no MVP) —
 * o motor v2 não tem gancho de "pisar na casa" pra nada ainda (ver KANBAN.md),
 * então essa parte fica pra quando esse gancho existir [PADRÃO, gap documentado].
 */
export interface MinionStateV2 {
  uid: string;
  hp: number;
  maxHp: number;
  damage: number;
  pos: Hex;
  alive: boolean;
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
  /** Ressurgir (Selene) só pode ser usado uma vez por partida, por equipe. */
  resurrectUsed: boolean;
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
  boss: BossStateV2;
  /** Equipe que causa dano x2 no boss (último golpe), até ele cair. */
  bountyTeam: TeamId | null;
  monsters: MonsterStateV2[];
  /** Lacaios invocados pelo boss ("Prole") — ver MinionStateV2. */
  minions: MinionStateV2[];
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
        permaDead: false,
        baseMaxHp: def.hp,
        baseDefense: def.defense,
        permanentDamageBonusPercent: 0,
        monsterStatGroups: {},
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
      resurrectUsed: false,
    };
  }

  // Embaralhado por último (depois dos baralhos de campeão), senão o rngState
  // salvo no retorno abaixo não contaria essa entropia consumida.
  const boss: BossStateV2 = {
    hp: bossDef.hp,
    maxHp: bossDef.hp,
    defense: bossDef.defense,
    pos: { ...board.boss },
    range: bossDef.range,
    deck: rng.shuffle(bossDef.deck.map((c) => c.id)),
    discard: [],
    alive: true,
    aura: null,
    damageReduction: 0,
    lastAttacker: null,
  };

  // Monstros do mapa (item 7): posicionamento sorteado a partir da MESMA seed
  // da partida (src/design/monsterPlacement.ts), mas com seu próprio gerador
  // interno — não compartilha o `holder`/`rng` acima [PADRÃO: mesma seed ainda
  // reproduz a mesma partida, só não encadeia no mesmo fluxo de números].
  const monsterPlacements = placeMonstersWithSeed(seed);
  const monsters: MonsterStateV2[] = monsterPlacements.map((p, i) => {
    const type = getMonsterType(p.typeId);
    return {
      uid: `monster-${i}`,
      typeId: p.typeId,
      zone: type.zone,
      level: type.level,
      pos: { ...p.position },
      hp: type.hp,
      maxHp: type.hp,
      defense: type.defense,
      posture: type.posture,
      alive: true,
      attackedBeforeThisCombat: false,
      fledOnceThisCombat: false,
      lastAttacker: null,
    };
  });

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
    boss,
    bountyTeam: null,
    monsters,
    minions: [],
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
