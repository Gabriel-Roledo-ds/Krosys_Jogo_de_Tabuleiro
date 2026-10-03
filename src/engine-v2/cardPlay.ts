// Camada de "jogar uma carta" do motor hexagonal (roster v2) — item 4 da ordem
// de execução em KANBAN.md. Junta o que já existia solto: target+alcance da
// carta (targeting.ts) escolhe quem é afetado, o rank escolhido pelo jogador
// decide custo/alcance/efeitos, a mana é da equipe (mana.ts) e cada bloco de
// `effects` do rank roda em sequência sobre o MESMO EffectContextV2 (pra
// ricochete/encadeamento funcionar, ver effects.ts). Pilha de respostas
// rápidas, fase de turno (compra/movimento/básica) e boss ficam em turn.ts,
// que ainda não existe — playCardV2 só executa UMA carta já escolhida,
// testável isoladamente (como os testes de effects.ts já fazem à mão).
//
// playBasicV2 cobre a habilidade básica (custo 0, alvo inferido por
// basicTargetV2 em data.ts — ver regras-e-decisoes.md §6, "Alvo da
// habilidade básica no roster v2").
//
// Fora de escopo aqui (ver KANBAN.md pra cada um):
// - silêncio/atordoamento bloqueando cartas e básicas: o motor v2 ainda não
//   tem esses status de controle ligados aqui (fica pra quando a fase de
//   turno/pilha de respostas existir de verdade, junto com silenced/stunned).
//
// Boss (item 6 do KANBAN, ver boss.ts): quando o alvo escolhido é o boss (uid
// BOSS_UID_V2, só em cartas/básicas de alvo único "enemy"), os blocos de
// efeito `damage` da carta acertam o boss via `attackBossV2` (dedicado, fora
// do pipeline genérico de effects.ts, que só conhece ChampionStateV2) — outros
// tipos de efeito (apply_status, heal, etc.) contra o boss são ignorados por
// enquanto [PADRÃO, gap documentado em boss.ts].
//
// Monstros do mapa (item 7 do KANBAN, ver monsters.ts): mesmo esquema do
// boss — alvo "enemy" com uid "monster-N" acerta via `attackMonsterV2`
// (que também dispara a reação da criatura antes do dano), só pro bloco
// `damage`; outros tipos de efeito contra um monstro são ignorados.

import { rngOf } from "../engine/rng";
import type { Effect } from "../engine/data";
import { hexDirectionTo, hexDistance } from "../design/hexGrid";
import { applyEffectV2, type EffectContextV2 } from "./effects";
import { dealDamageV2 } from "./damage";
import { attackBossV2, attackMinionV2, BOSS_UID_V2, isMinionUidV2 } from "./boss";
import { attackMonsterV2, findMonsterV2, isMonsterUidV2 } from "./monsters";
import { attackTempleV2, findTempleV2, isTempleUidV2 } from "./temples";
import { discardCardV2 } from "./deck";
import { canPayCardV2, spendCardManaV2 } from "./mana";
import { basicTargetV2, getCardDefV2, getCardRankV2, getChampionDefV2, type BasicDefV2, type CardDefV2, type CardRank } from "./data";
import { getChampionV2, logV2, nextIdV2, type ChampionStateV2, type GameStateV2, type MonsterStateV2, type TeamId } from "./state";
import { enemiesInRange, validateTargetV2, type TargetV2 } from "./targeting";

export class IllegalActionV2 extends Error {}

function fail(msg: string): never {
  throw new IllegalActionV2(msg);
}

/** Ressurgir (resurrect) só pode ser usado 1x por partida, por equipe, e para de funcionar depois que o boss cai (regras-e-decisoes.md §18). */
export const resurrectBlockedV2 = (game: GameStateV2, team: TeamId, effects: Effect[]): boolean =>
  effects.some((e) => e.type === "resurrect") && (game.teams[team].resurrectUsed || !game.boss.alive);

/** `rank.range` vem como number | "self" | null (direction/line sem alcance numérico) — null é tratado como 0 pra validação, já que esses targets não checam alcance por casa (ex. "direction"). */
export function rankRangeV2(rank: CardRank): number | "self" {
  if (typeof rank.range === "number") return rank.range;
  if (rank.range === "self") return "self";
  return 0;
}

export interface TargetResolutionV2 {
  /** Alvos-campeão escolhidos pelo jogador, já validados — a entrada "padrão" de applyEffectV2 pra quem não tem resolução própria (around_self/random_targets/etc., tratados em effects.ts ou aqui mesmo). */
  targets: ChampionStateV2[];
  ctxExtra: Partial<EffectContextV2>;
  /** true se o alvo escolhido foi o boss (uid BOSS_UID_V2) — ver resolveCardEffectsV2/resolveBasicEffectsV2. */
  bossTarget?: boolean;
  /** uid do monstro, se o alvo escolhido foi um monstro do mapa (ver monsters.ts). */
  monsterTarget?: string;
  /** uid do lacaio, se o alvo escolhido foi um lacaio do boss (ver boss.ts, summon_minion). */
  minionTarget?: string;
  /** uid do templo, se o alvo escolhido foi um guardião de templo (ver temples.ts). */
  templeTarget?: string;
}

/**
 * Resolve, a partir do `target` da carta e do que o jogador escolheu (`t`),
 * quem são os alvos-campeão e quais campos de EffectContextV2 preencher
 * (targetCell/moveDest/moveDir) — a peça que faltava pros `ctx.*` que
 * effects.ts hoje só documentava como "preenchido à mão até essa camada
 * existir".
 */
export function resolveCardTargetsV2(owner: ChampionStateV2, cardTarget: string, t: TargetV2, game: GameStateV2): TargetResolutionV2 {
  const ctxExtra: Partial<EffectContextV2> = {};
  let targets: ChampionStateV2[] = [];
  switch (cardTarget) {
    case "self":
      targets = [owner];
      break;
    case "cell":
      // Efeitos de alvo "cell" no catálogo atual agem sobre quem usou a carta
      // (move_self/teleport_self/create_wall/ground_fire/venom_zone) — nenhum
      // ainda escolhe outro campeão por uid numa casa.
      targets = [owner];
      if (t.pos) {
        ctxExtra.targetCell = t.pos;
        ctxExtra.moveDest = t.pos;
      }
      break;
    case "enemy":
      if (t.uid === BOSS_UID_V2) return { targets: [], ctxExtra, bossTarget: true };
      if (t.uid && isMonsterUidV2(t.uid)) return { targets: [], ctxExtra, monsterTarget: t.uid };
      if (t.uid && isMinionUidV2(t.uid)) return { targets: [], ctxExtra, minionTarget: t.uid };
      if (t.uid && isTempleUidV2(t.uid)) return { targets: [], ctxExtra, templeTarget: t.uid };
      if (t.uid) targets = [getChampionV2(game, t.uid)];
      break;
    case "ally":
    case "champion":
    case "champion_in_line":
    case "dead_ally":
      if (t.uid) targets = [getChampionV2(game, t.uid)];
      break;
    case "two_enemies":
      // Elo Natural da Sylvane (ver targeting.ts/effects.ts applyLink) — os
      // dois campeões escolhidos pelo jogador, NÃO quem usou a carta; o
      // vínculo liga eles entre si.
      if (t.uid && t.uid2) targets = [getChampionV2(game, t.uid), getChampionV2(game, t.uid2)];
      break;
    case "random_enemies":
      // Sem alvo escolhido pelo jogador — cada bloco com `random_targets: N`
      // sorteia os próprios alvos (ver resolveEffectTargetsV2).
      targets = [];
      break;
    case "direction":
      // move_self/damage_all_adjacent_during_move (Dança das Lâminas da
      // Vextra) usam a lista de alvos pra saber quem se move — os demais
      // efeitos de "direction" (move_in_line, damage_first_in_path, fire_wall)
      // ignoram `targets` e leem `ctx.attacker`/`ctx.moveDir` direto.
      targets = [owner];
      if (t.dir) ctxExtra.moveDir = t.dir;
      break;
    case "line":
      if (t.pos) {
        ctxExtra.targetCell = t.pos;
        ctxExtra.moveDir = hexDirectionTo(owner.pos, t.pos);
      }
      break;
    case "wall":
      if (t.pos) ctxExtra.targetCell = t.pos;
      break;
    case "two_cells":
      // `create_portal_pair` (Portal do Dorin, ver effects.ts applyCreatePortalPair).
      if (t.pos) ctxExtra.targetCell = t.pos;
      if (t.pos2) ctxExtra.targetCell2 = t.pos2;
      break;
    default:
      break;
  }
  return { targets, ctxExtra };
}

/** Alvos reais de UM bloco de efeito: a maioria usa os alvos da carta; `random_targets` sorteia os seus próprios dentro do alcance do rank. */
function resolveEffectTargetsV2(game: GameStateV2, owner: ChampionStateV2, effect: Effect, baseTargets: ChampionStateV2[], rank: CardRank): ChampionStateV2[] {
  if (typeof effect.random_targets === "number") {
    const pool = enemiesInRange(game, owner, { range: rankRangeV2(rank), target: "enemy" });
    return rngOf(game).shuffle(pool).slice(0, effect.random_targets);
  }
  return baseTargets;
}

/**
 * Candidato ao sorteio de `random_targets` (Chuva de Faíscas/Balas): campeão
 * inimigo, o boss ou um monstro/lacaio do mapa, todos ao alcance do rank.
 * Achado de escopo (02/10/2026, KANBAN "dano em área/aleatório contra boss e
 * monstro"): antes disso o sorteio só considerava campeões — boss e monstros
 * nunca entravam na roleta mesmo estando ao alcance.
 */
type RandomDamageCandidateV2 =
  | { kind: "champion"; champion: ChampionStateV2 }
  | { kind: "boss" }
  | { kind: "monster"; monster: MonsterStateV2 }
  | { kind: "minion"; uid: string }
  | { kind: "temple"; uid: string };

function randomDamageCandidatesV2(game: GameStateV2, owner: ChampionStateV2, rank: CardRank): RandomDamageCandidateV2[] {
  const range = rankRangeV2(rank);
  const numRange = typeof range === "number" ? range : 0;
  const out: RandomDamageCandidateV2[] = enemiesInRange(game, owner, { range, target: "enemy" }).map((c) => ({ kind: "champion", champion: c }));
  if (game.boss.alive && hexDistance(owner.pos, game.boss.pos) <= numRange) out.push({ kind: "boss" });
  for (const m of game.monsters) if (m.alive && hexDistance(owner.pos, m.pos) <= numRange) out.push({ kind: "monster", monster: m });
  for (const m of game.minions) if (m.alive && hexDistance(owner.pos, m.pos) <= numRange) out.push({ kind: "minion", uid: m.uid });
  for (const te of game.temples) if (te.alive && hexDistance(owner.pos, te.pos) <= numRange) out.push({ kind: "temple", uid: te.uid });
  return out;
}

/** Aplica um bloco `damage` com `random_targets` sobre o sorteio combinado acima (champion/boss/monster/minion/temple). */
function applyRandomDamageV2(game: GameStateV2, owner: ChampionStateV2, effect: Effect, rank: CardRank, bonusDamage?: number): void {
  const candidates = randomDamageCandidatesV2(game, owner, rank);
  const picked = rngOf(game).shuffle(candidates).slice(0, effect.random_targets as number);
  const amount = (effect.amount ?? 0) + (bonusDamage ?? 0);
  const opts = { ignoreDefense: effect.ignore_defense };
  for (const c of picked) {
    if (c.kind === "champion") dealDamageV2(owner, c.champion, amount, opts);
    else if (c.kind === "boss") attackBossV2(game, owner, amount, opts);
    else if (c.kind === "monster") attackMonsterV2(game, owner, c.monster, amount, opts);
    else if (c.kind === "minion") attackMinionV2(game, owner, c.uid, amount);
    else attackTempleV2(game, owner, findTempleV2(game, c.uid), amount, opts);
  }
}

export interface PlayCardResultV2 {
  owner: ChampionStateV2;
  card: CardDefV2;
  rank: CardRank;
}

/**
 * Roda cada bloco de `rank.effects` em sequência sobre o MESMO contexto
 * (pra ricochete/encadeamento funcionar) — a parte de "jogar a carta" que
 * turn.ts reaproveita pra resolver um item já pago/validado que estava
 * esperando na pilha de respostas rápidas (ver pushItemV2/resolveStackV2).
 * Não valida nem cobra nada: quem chama já fez isso antes (em `playCardV2`,
 * no ato de jogar; em turn.ts, no ato de EMPILHAR, não no de resolver).
 */
export function resolveCardEffectsV2(game: GameStateV2, owner: ChampionStateV2, def: CardDefV2, rank: CardRank, t: TargetV2, bonusDamage?: number): void {
  const { targets, ctxExtra, bossTarget, monsterTarget, minionTarget, templeTarget } = resolveCardTargetsV2(owner, def.target, t, game);
  if (bossTarget) {
    applyCardEffectsToBossV2(game, owner, rank.effects, bonusDamage);
    logV2(game, `${owner.defId} (${owner.team}) usa ${def.name} (rank ${rank.rank}) no Boss`);
    return;
  }
  if (monsterTarget) {
    applyCardEffectsToMonsterV2(game, owner, findMonsterV2(game, monsterTarget), rank.effects, bonusDamage);
    logV2(game, `${owner.defId} (${owner.team}) usa ${def.name} (rank ${rank.rank}) num monstro`);
    return;
  }
  if (minionTarget) {
    applyCardEffectsToMinionV2(game, owner, minionTarget, rank.effects, bonusDamage);
    logV2(game, `${owner.defId} (${owner.team}) usa ${def.name} (rank ${rank.rank}) num lacaio`);
    return;
  }
  if (templeTarget) {
    applyCardEffectsToTempleV2(game, owner, templeTarget, rank.effects, bonusDamage);
    logV2(game, `${owner.defId} (${owner.team}) usa ${def.name} (rank ${rank.rank}) num guardião de templo`);
    return;
  }
  const ctx: EffectContextV2 = {
    game,
    attacker: owner,
    nextId: () => nextIdV2(game),
    bonusDamage,
    ...ctxExtra,
  };
  for (const effect of rank.effects) {
    if (def.target === "random_enemies" && effect.type === "damage" && typeof effect.random_targets === "number") {
      // Sorteio combinado (champion/boss/monster/lacaio) em vez do pipeline genérico de
      // effects.ts, que só conhece ChampionStateV2 — ver randomDamageCandidatesV2 acima.
      applyRandomDamageV2(game, owner, effect, rank, bonusDamage);
      continue;
    }
    const effectTargets = resolveEffectTargetsV2(game, owner, effect, targets, rank);
    applyEffectV2(ctx, effect, effectTargets);
  }
  logV2(game, `${owner.defId} (${owner.team}) usa ${def.name} (rank ${rank.rank})`);
}

/**
 * Blocos `damage` de uma carta/básica contra o boss (ver cabeçalho do
 * arquivo/boss.ts). Outros tipos de efeito (apply_status, heal, shield etc.)
 * não têm consequência nenhuma no boss por enquanto — gap documentado, fora
 * do escopo desta etapa.
 */
function applyCardEffectsToBossV2(game: GameStateV2, owner: ChampionStateV2, effects: Effect[], bonusDamage?: number): void {
  for (const effect of effects) {
    if (effect.type !== "damage") continue;
    attackBossV2(game, owner, (effect.amount ?? 0) + (bonusDamage ?? 0), { ignoreDefense: effect.ignore_defense });
  }
}

/** Mesma ideia de applyCardEffectsToBossV2, mas contra um monstro do mapa (ver monsters.ts). */
function applyCardEffectsToMonsterV2(game: GameStateV2, owner: ChampionStateV2, monster: MonsterStateV2, effects: Effect[], bonusDamage?: number): void {
  for (const effect of effects) {
    if (effect.type !== "damage") continue;
    attackMonsterV2(game, owner, monster, (effect.amount ?? 0) + (bonusDamage ?? 0), { ignoreDefense: effect.ignore_defense });
  }
}

/** Mesma ideia, mas contra um lacaio do boss (ver boss.ts, summon_minion). */
function applyCardEffectsToMinionV2(game: GameStateV2, owner: ChampionStateV2, minionUid: string, effects: Effect[], bonusDamage?: number): void {
  for (const effect of effects) {
    if (effect.type !== "damage") continue;
    attackMinionV2(game, owner, minionUid, (effect.amount ?? 0) + (bonusDamage ?? 0));
  }
}

/** Mesma ideia, mas contra o guardião de um templo de bênção (ver temples.ts). */
function applyCardEffectsToTempleV2(game: GameStateV2, owner: ChampionStateV2, templeUid: string, effects: Effect[], bonusDamage?: number): void {
  for (const effect of effects) {
    if (effect.type !== "damage") continue;
    attackTempleV2(game, owner, findTempleV2(game, templeUid), (effect.amount ?? 0) + (bonusDamage ?? 0), { ignoreDefense: effect.ignore_defense });
  }
}

/**
 * Executa uma carta já escolhida pelo jogador (carta + rank + alvo): valida
 * o alvo contra o alcance do rank, cobra a mana de equipe, consome e limpa o
 * bônus de `buff_next_card` (Passo das Sombras da Vextra) se a própria carta
 * não renová-lo, e resolve os efeitos (resolveCardEffectsV2) na hora —
 * resolução imediata, sem passar pela pilha de respostas rápidas (essa é
 * turn.ts, que decide quando empilhar e quando resolver). Lança
 * `IllegalActionV2` se algo for inválido (carta fora da mão, alvo inválido,
 * mana insuficiente, dono fora de campo).
 */
export function playCardV2(game: GameStateV2, team: TeamId, cardUid: string, rankNumber: number, t: TargetV2): PlayCardResultV2 {
  const hand = game.teams[team].hand;
  const cardInstance = hand.find((c) => c.uid === cardUid);
  if (!cardInstance) fail("Carta não está na mão");
  const owner = getChampionV2(game, cardInstance.owner);
  if (!owner.alive) fail("O dono da carta não está em campo");
  const def = getCardDefV2(cardInstance.cardId);
  const rank = getCardRankV2(def, rankNumber);

  const err = validateTargetV2(game, owner, { range: rankRangeV2(rank), target: def.target }, t);
  if (err) fail(err);
  if (!canPayCardV2(game, team, owner, rank.cost)) fail("Mana insuficiente");
  if (resurrectBlockedV2(game, team, rank.effects)) fail("Ressurgir já foi usado");

  const buff = game.teams[team].nextCardBuff ?? undefined;

  spendCardManaV2(game, team, owner, rank.cost);
  game.teams[team].hand = hand.filter((c) => c.uid !== cardUid);
  discardCardV2(game, cardInstance);
  if (buff && !rank.effects.some((e) => e.type === "buff_next_card")) game.teams[team].nextCardBuff = null;

  resolveCardEffectsV2(game, owner, def, rank, t, buff?.bonusDamage);
  return { owner, card: def, rank };
}

export interface PlayBasicResultV2 {
  owner: ChampionStateV2;
  basic: BasicDefV2;
}

/** Mesma ideia de resolveCardEffectsV2, mas pra habilidade básica (sem rank/mana/descarte). */
export function resolveBasicEffectsV2(game: GameStateV2, owner: ChampionStateV2, basic: BasicDefV2, t: TargetV2): void {
  const target = basicTargetV2(basic);
  const { targets, ctxExtra, bossTarget, monsterTarget, minionTarget, templeTarget } = resolveCardTargetsV2(owner, target, t, game);
  if (bossTarget) {
    applyCardEffectsToBossV2(game, owner, basic.effects);
    logV2(game, `${owner.defId} (${owner.team}) usa a básica (${basic.name}) no Boss`);
    return;
  }
  if (monsterTarget) {
    applyCardEffectsToMonsterV2(game, owner, findMonsterV2(game, monsterTarget), basic.effects);
    logV2(game, `${owner.defId} (${owner.team}) usa a básica (${basic.name}) num monstro`);
    return;
  }
  if (minionTarget) {
    applyCardEffectsToMinionV2(game, owner, minionTarget, basic.effects);
    logV2(game, `${owner.defId} (${owner.team}) usa a básica (${basic.name}) num lacaio`);
    return;
  }
  if (templeTarget) {
    applyCardEffectsToTempleV2(game, owner, templeTarget, basic.effects);
    logV2(game, `${owner.defId} (${owner.team}) usa a básica (${basic.name}) num guardião de templo`);
    return;
  }
  const ctx: EffectContextV2 = {
    game,
    attacker: owner,
    nextId: () => nextIdV2(game),
    ...ctxExtra,
  };
  for (const effect of basic.effects) applyEffectV2(ctx, effect, targets);
  logV2(game, `${owner.defId} (${owner.team}) usa a básica (${basic.name})`);
}

/**
 * Executa a habilidade básica de um campeão (custo 0, fora do baralho — não
 * passa por mana nem descarte), resolvendo na hora. O alvo é validado contra
 * `basic.range` e o `target` inferido por `basicTargetV2` (ver cabeçalho do
 * arquivo e regras-e-decisoes.md §6). Lança `IllegalActionV2` se o dono
 * estiver fora de campo ou o alvo for inválido.
 */
export function playBasicV2(game: GameStateV2, championUid: string, t: TargetV2): PlayBasicResultV2 {
  const owner = getChampionV2(game, championUid);
  if (!owner.alive) fail("O campeão não está em campo");
  const def = getChampionDefV2(owner.defId);
  const basic = def.basic;

  const err = validateTargetV2(game, owner, { range: basic.range, target: basicTargetV2(basic) }, t);
  if (err) fail(err);

  resolveBasicEffectsV2(game, owner, basic, t);
  return { owner, basic };
}
