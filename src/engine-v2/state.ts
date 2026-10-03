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
import { buildTemplesV2 } from "./temples-data";

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
  /** Status "mark" que salta pro inimigo mais próximo se o marcado morrer (Marca do Predador ★★★ da Niara, ver death.ts). */
  jumpOnDeath?: boolean;
  /** Status "fire_trail_active" (Rastro de Fogo da Ignira): duração em rodadas do fogo deixado no próximo movimento — `amount` já guarda o dano por rodada (ver turn.ts). */
  trailDurationRounds?: number;
  /** Status "fire_trail_active": dano extra de uma vez a quem entra na casa, além do dano por rodada (rank 3). */
  trailInstantBonus?: number;
  /** Nunca perde `remaining`/expira em tick.ts, mesmo com `unit: "rounds"` — só usado pela bênção de templo (ver temples.ts). */
  permanent?: boolean;
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
  /**
   * Último Bastião do Varek (sacrifício de passiva, ver sacrifice.ts): se
   * definido, todo dano que ESTE campeão sofreria é redirecionado pra quem
   * está aqui (defesa/escudo do protetor, não os próprios — ver damage.ts
   * dealDamageV2). Limpo a cada tickRoundV2 (mesma granularidade "dura 1
   * rodada" dos outros sacrifícios — ver regras-e-decisoes.md §22).
   */
  protectedBy?: ChampionStateV2 | null;
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
 * Efeito persistente no chão (fogo, veneno, armadilha, mola, muro de chamas,
 * terreno venenoso, marca de área) — não pertence a nenhum campeão, fica na
 * casa até expirar ou (armadilha/mola) até disparar uma vez. Dois jeitos de
 * agir: "fire"/"venom" causam dano/veneno por RODADA a quem estiver dentro
 * (ver tick.ts); os outros disparam ao alguém TERMINAR o movimento na área
 * (ver hazards.ts/onLandV2) — mesma convenção do MVP original
 * (src/engine/hazards.ts).
 */
export interface GroundEffectV2 {
  id: number;
  kind: "fire" | "venom" | "trap" | "spring" | "fire_wall" | "venom_terrain" | "mark" | "slow";
  pos: Hex;
  /** Pra "trap"/"spring"/"slow": sempre 0 (só a própria casa). Demais: raio de verdade. */
  radius: number;
  team: TeamId;
  remaining: number;
  /** "fire": dano por rodada a quem estiver na área. */
  damagePerRound?: number;
  /** "venom": pilhas de veneno por rodada a quem estiver na área. */
  stacksPerRound?: number;
  /** "trap"/"fire_wall": dano de uma vez a quem termina o movimento na casa. */
  damageOnEnter?: number;
  /** "trap" (Armadilha ★★★ do Dorin): penalidade de movimento aplicada ao disparar (status "move_penalty"). */
  slowAmount?: number;
  /** "spring": distância do lançamento (a direção é "continua pra frente" — ver hazards.ts/onLandV2). */
  distance?: number;
  /** "venom_terrain": pilhas de veneno aplicadas ao entrar (não por rodada). */
  stacksOnEnter?: number;
  /** "mark" (mark_ground_area, Chuva de Aço da Niara): fração do dano original retriggada a quem entra. */
  retriggerFraction?: number;
  /** "mark": o dano original da carta que criou a marca (base pro retrigger acima). */
  storedDamage?: number;
  /** "fire" (Rastro de Fogo ★★★ da Ignira): dano extra de uma vez a quem ENTRA na casa, além do dano por rodada normal. */
  instantBonusOnEnter?: number;
}

/**
 * Torre de Vigia (Dorin) — igual a Structure do MVP (src/engine/state.ts),
 * mas no tabuleiro hexagonal. Dano por rodada a inimigos dentro de `range`,
 * resolvido em tick.ts (mesma convenção de `ground`/`walls`). Sem hp extra
 * por campeão (structureBonusHp do MVP) ainda — não há carta v2 que dependa
 * disso até agora.
 */
export interface StructureV2 {
  id: number;
  pos: Hex;
  hp: number;
  team: TeamId;
  damagePerRound: number;
  range: number;
  /** Rodadas restantes; null = sem duração natural (expira só por hp/destroy_wall). */
  remaining: number | null;
}

/** Par de portais (Portal do Dorin) — entrar numa ponta teleporta pra outra. */
export interface PortalPairV2 {
  id: number;
  a: Hex;
  b: Hex;
  team: TeamId;
  remaining: number | null;
}

/** Dano com atraso (Explosão Retardada da Ignira) — resolvido em tick.ts quando `roundsLeft` chega a 0. */
export interface DelayedDamageV2 {
  id: number;
  pos: Hex;
  radius: number;
  amount: number;
  team: TeamId;
  roundsLeft: number;
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
 * (uid "minion-N", ver boss.ts/targeting.ts/cardPlay.ts). Ataca sozinho quem
 * terminar um movimento voluntário adjacente a ele (mesma regra do MVP,
 * hazards.ts, mas sem o gancho genérico de "pisar na casa" — ligado direto no
 * case "move" de turn.ts, já que é o único efeito de adjacência que o motor
 * v2 precisa por enquanto). `roundsLeft` é opcional: só é definido quando o
 * efeito summon_minion que o criou tiver `duration` (unit "rounds") — a Prole
 * do boss (data/boss.json) não define duration, então o lacaio dela continua
 * sem expirar por tempo, só morrendo por dano (boss.ts/attackMinionV2).
 */
export interface MinionStateV2 {
  uid: string;
  hp: number;
  maxHp: number;
  damage: number;
  pos: Hex;
  alive: boolean;
  roundsLeft?: number;
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
  /** Ids dos deuses de templo já reivindicados por esta equipe (ver temples.ts) — só metadado pra view/log, o efeito de verdade mora no status permanente de cada campeã. */
  blessings: string[];
  /**
   * Botão de ligar/desligar a própria janela de resposta rápida
   * (regras-e-decisoes.md §6/§16, "Botão de ligar/desligar efeito rápido").
   * `false` faz `canRespondV2` ignorar essa equipe ao decidir prioridade em
   * `settlePriorityV2` (turn.ts) — a ação do adversário resolve direto, sem
   * abrir janela pra ESTA equipe. Não desliga `fastPlaysV2` em si (usado por
   * `legalActionsV2`/bots quando a equipe já tem prioridade por outro
   * motivo), só a concessão de prioridade. Padrão: true (ligado).
   */
  fastWindowEnabled: boolean;
}

/**
 * Templo de bênção no canto obtuso do mapa (regras-e-decisoes.md §21, item 43
 * do KANBAN). Guardado por uma criatura única e forte desde o início da
 * partida; quem a derrotar reivindica o templo pra sua equipe e ganha, pra
 * sempre, o deus FIXO daquele canto (sem escolha em tempo real — ver §21 pro
 * porquê). `uid` segue o padrão "temple-<nome do canto>" (mesma convenção de
 * monstro/boss/lacaio — ver targeting.ts/cardPlay.ts).
 */
export interface TempleStateV2 {
  uid: string;
  name: string;
  pos: Hex;
  hp: number;
  maxHp: number;
  defense: number;
  /** Contra-ataque do guardião a cada golpe recebido que não o mate (ignora defesa) — ver temples.ts. */
  counterDamage: number;
  alive: boolean;
  claimedBy: TeamId | null;
  godId: string;
  godName: string;
}

/** "boss": janela de resposta à ativação do boss, entre o fim de returnDeadChampionsV2 e a fase de compra (ver turn.ts beginTurn/activateBossV2). */
export type PhaseV2 = "boss" | "draw" | "act" | "discard";

/** Item na pilha de respostas rápidas (ver turn.ts) — carta, habilidade básica ou ativação do boss já decidida, aguardando resolução (ou resposta do adversário). */
export interface StackItemV2 {
  kind: "card" | "basic" | "boss";
  team: TeamId;
  /** uid do campeão que age — não existe pro boss (ver kind "boss"). */
  owner?: string;
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
  /** Torres de Vigia (Dorin, create_structure) — ver StructureV2/tick.ts. */
  structures: StructureV2[];
  /** Pares de portais (Dorin, create_portal_pair) — ver PortalPairV2/hazards.ts. */
  portals: PortalPairV2[];
  /** Danos com atraso pendentes (Ignira, delayed_damage) — ver DelayedDamageV2/tick.ts. */
  delayedDamages: DelayedDamageV2[];
  turn: TurnStateV2;
  pending: PendingV2 | null;
  boss: BossStateV2;
  /** Equipe que causa dano x2 no boss (último golpe), até ele cair. */
  bountyTeam: TeamId | null;
  monsters: MonsterStateV2[];
  /** Lacaios invocados pelo boss ("Prole") — ver MinionStateV2. */
  minions: MinionStateV2[];
  /** Neblina de guerra: toda casa que algum campeão vivo da equipe já viu em qualquer momento da partida (chave "q,r") — ver vision.ts. Nunca esquece. */
  exploredByTeam: Record<TeamId, string[]>;
  /** Templos de bênção nos 2 cantos obtusos (ver TempleStateV2/temples.ts) — tratados como marco fixo do mapa, nunca escondidos pela neblina (mesma convenção do boss). */
  temples: TempleStateV2[];
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
      blessings: [],
      fastWindowEnabled: true,
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
    structures: [],
    portals: [],
    delayedDamages: [],
    turn: newTurnV2("A", "draw"),
    pending: null,
    boss,
    bountyTeam: null,
    monsters,
    minions: [],
    exploredByTeam: { A: [], B: [] },
    temples: buildTemplesV2(),
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
