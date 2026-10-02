// Execução dos blocos de `effects` das cartas v2 (roster novo) — motor hexagonal.
// Cobre por agora os 5 tipos mais usados em cards_v2.json (damage, apply_status,
// apply_status_area, heal, shield — juntos são ~220 das ~290 ocorrências de
// efeito nas 120 cartas). Os outros ~45 tipos do catálogo em
// claude/formato-dados.md entram em incrementos seguintes (ver KANBAN.md).
//
// Escopo: isto é só "o que o efeito faz" com uma lista de alvos já resolvida —
// "quem é o alvo" (ler o target da carta, alcance, área ao redor de uma casa
// etc.) é uma camada de cima ainda não construída (orquestração de jogar uma
// carta). Então as funções aqui recebem os campeões-alvo já escolhidos.

import { balance, type Effect } from "../engine/data";
import { addHex, hexDirectionTo, hexDistance, hexNeighbors, sameHex, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, type ChampionStateV2, type GameStateV2 } from "./state";
import { dealDamageV2, type DamageOptsV2 } from "./damage";
import { addStatus, heal, removeNegativeStatuses, removePositiveStatuses, removeStatus, statusAmount } from "./status";
import { forcedMove, pullChampion, pushChampion, teleportChampion } from "./movement";
import { championsInRadius } from "./targeting";
import { wallAtV2 } from "./world";

/** Nenhum campeão vivo (de qualquer equipe) na casa. */
function isEmptyOfChampions(game: GameStateV2, h: Hex): boolean {
  return !allChampionsV2(game).some((c) => c.alive && sameHex(c.pos, h));
}

/** Status sem duração natural — persiste até ser consumido/removido (pilhas de veneno). */
const PERSISTENT_REMAINING = 999;

/** Status cujo nome já é negativo por convenção (ver claude/formato-dados.md). */
const NEGATIVE_STATUS_NAMES = new Set([
  "defense_down",
  "movement_reduced",
  "damage_down",
  "stun",
  "root",
  "taunted",
  "silenced",
]);

function isNegativeStatus(name: string): boolean {
  return NEGATIVE_STATUS_NAMES.has(name);
}

export interface EffectContextV2 {
  game: GameStateV2;
  attacker: ChampionStateV2 | null;
  /** Gera o próximo id único de status, igual a nextId(s) do estado. */
  nextId: () => number;
  /**
   * Destino escolhido pelo jogador pra `move_self`/`teleport_self` quando a
   * carta não restringe a uma direção (target "self" ou "cell") — a escolha
   * em si é feita pela camada de "jogar uma carta", que ainda não existe (ver
   * KANBAN.md); por enquanto quem chama applyEffectV2 passa o destino direto.
   */
  moveDest?: Hex;
  /** Direção escolhida pelo jogador pra `move_self` quando o target é "direction". */
  moveDir?: Hex;
  /**
   * Casa-centro escolhida pelo jogador pra efeitos de alvo "cell" que criam
   * algo no chão (ground_fire, venom_zone) — mesma ideia de moveDest, mas
   * pros efeitos que não movem ninguém. Preenchida por quem chama
   * applyEffectV2 até a camada de "jogar carta" existir de verdade.
   */
  targetCell?: Hex;
  /**
   * Alcance resolvido da carta no rank escolhido (com bônus já somados) —
   * só usado por efeitos com `all_enemies_in_range`/`all_poisoned_enemies`
   * (Praga em Massa, Colapso Tóxico etc. do Thorne), que afetam todo mundo
   * dentro do alcance da carta em vez de um alvo escolhido. Preenchida por
   * quem chama applyEffectV2 até a camada de "jogar carta" existir de verdade.
   */
  rangeForAll?: number;
  /**
   * Último campeão atingido por um bloco de dano desta mesma carta — como os
   * blocos de uma carta são executados em sequência sobre o MESMO ctx (não
   * uma cópia), `damage` guarda aqui quem acertou, e `damage_second_target`/
   * `damage_third_target` (Ricochete da Niara) leem daqui pra encadear
   * "o próximo alvo perto do anterior", sem precisar saber de fora quem foi
   * atingido antes.
   */
  lastTarget?: ChampionStateV2 | null;
  /** uids já atingidos pela cadeia de ricochete desta carta (inclui o 1º alvo) — pra `damage_third_target` não voltar a acertar quem o `damage_second_target` já pulou. */
  hitChain?: Set<string>;
}

/** O mais próximo de `origin` (fora `exclude`) a até `maxDistance` casas, com desempate estável por uid. */
function nearestOtherChampion(
  game: GameStateV2,
  origin: Hex,
  maxDistance: number,
  exclude: Set<string>,
): ChampionStateV2 | null {
  const candidates = allChampionsV2(game).filter((c) => c.alive && !exclude.has(c.uid) && hexDistance(c.pos, origin) <= maxDistance);
  candidates.sort((a, b) => hexDistance(a.pos, origin) - hexDistance(b.pos, origin) || a.uid.localeCompare(b.uid));
  return candidates[0] ?? null;
}

/**
 * Quem está a até `radius` casas de quem usou a carta (área ao redor de si
 * mesmo — Nova de Fogo, Grito de Guerra). [PADRÃO]: não inclui o próprio
 * atacante (o "around_self" é lido como "nos outros ao redor", não em si
 * mesmo) — revisar se o dono do projeto quiser que também se afete.
 */
function resolveAroundSelf(ctx: EffectContextV2, effect: Effect): ChampionStateV2[] {
  if (!ctx.attacker) return [];
  const radius = effect.radius ?? effect.area_radius ?? 0;
  return championsInRadius(ctx.game, ctx.attacker.pos, radius, { excludeUid: ctx.attacker.uid });
}

/** Todo inimigo vivo a até `ctx.rangeForAll` casas de quem usou a carta. */
function resolveAllEnemiesInRange(ctx: EffectContextV2): ChampionStateV2[] {
  if (!ctx.attacker || ctx.rangeForAll === undefined) return [];
  return championsInRadius(ctx.game, ctx.attacker.pos, ctx.rangeForAll, { excludeUid: ctx.attacker.uid }).filter(
    (c) => c.team !== ctx.attacker!.team,
  );
}

/** Todo inimigo vivo e COM pilhas de veneno a até `ctx.rangeForAll` casas de quem usou a carta. */
function resolveAllPoisonedEnemiesInRange(ctx: EffectContextV2): ChampionStateV2[] {
  return resolveAllEnemiesInRange(ctx).filter((c) => statusAmount(c, "venom_stacks") > 0);
}

/**
 * `damage`: causa dano a cada alvo. Devolve o resultado por alvo (uid -> dano
 * final). Com `around_self` (Nova de Fogo, Golpe do Titã), ignora `targets` e
 * acerta todo mundo (aliado incluso — fogo amigo existe) ao redor de quem usou
 * a carta, raio `effect.radius`.
 */
export function applyDamage(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const opts: DamageOptsV2 = {
    ignoreDefense: effect.ignore_defense,
    ignoreShield: effect.ignore_shield,
  };
  const actualTargets = effect.around_self ? resolveAroundSelf(ctx, effect) : targets;
  const out: Record<string, number> = {};
  for (const target of actualTargets) {
    const result = dealDamageV2(ctx.attacker, target, effect.amount ?? 0, opts);
    out[target.uid] = result.final;
    // Devolve o reflexo (escudo com reflect_amount/reflect_absorbed_damage) a
    // quem causou o dano — um nível só, sem repropagar um novo reflexo.
    if (result.reflectToAttacker > 0 && ctx.attacker) {
      dealDamageV2(null, ctx.attacker, result.reflectToAttacker, { ignoreDefense: true, ignoreShield: true });
    }
  }
  if (actualTargets.length > 0) {
    ctx.lastTarget = actualTargets[actualTargets.length - 1];
    ctx.hitChain = new Set([...(ctx.hitChain ?? []), ...actualTargets.map((t) => t.uid)]);
  }
  return out;
}

/** `self_damage`: o próprio dono da carta perde vida (custo do efeito, ignora defesa/escudo). */
export function applySelfDamage(ctx: EffectContextV2, effect: Effect): number {
  if (!ctx.attacker) return 0;
  return dealDamageV2(null, ctx.attacker, effect.amount ?? 0, { ignoreDefense: true, ignoreShield: true }).final;
}

function durationFromEffect(effect: Effect): { unit: "rounds" | "champion_turns"; value: number } {
  if (effect.duration) return effect.duration;
  return { unit: "rounds", value: 1 };
}

/** `apply_status` / `apply_status_area`: aplica o mesmo status num ou mais alvos. */
export function applyStatus(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  const negative = isNegativeStatus(effect.status);
  for (const target of targets) {
    addStatus(target, ctx.nextId(), effect.status, duration.unit, duration.value, {
      amount: effect.amount,
      negative,
    });
  }
}

/** `apply_status_around_self`: aplica o status em todo mundo ao redor de quem usou a carta (Grito de Guerra). */
export function applyStatusAroundSelf(ctx: EffectContextV2, effect: Effect): void {
  applyStatus(ctx, effect, resolveAroundSelf(ctx, effect));
}

/**
 * Propaga uma fração da cura recebida ao parceiro de Elo de cura (Corrente de
 * Vida da Selene), se houver. Não repropaga a partir do parceiro — evita
 * ida-e-volta infinita entre os dois lados do vínculo.
 */
function propagateLinkedHeal(ctx: EffectContextV2, source: ChampionStateV2, healAmount: number): void {
  if (healAmount <= 0) return;
  const link = source.statuses.find((s) => s.status === "link_heal" && s.partner);
  if (!link || link.amount === undefined) return;
  const partner = allChampionsV2(ctx.game).find((c) => c.uid === link.partner);
  if (!partner || !partner.alive) return;
  const shared = Math.round((healAmount * link.amount) / 100);
  if (shared > 0) heal(partner, shared);
}

/** `heal`: cura, sem passar do hp máximo. Devolve a cura efetiva por alvo (propaga ao Elo de cura, se houver). */
export function applyHeal(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const target of targets) {
    if (!target.alive) {
      out[target.uid] = 0;
      continue;
    }
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + (effect.amount ?? 0));
    const healed = target.hp - before;
    out[target.uid] = healed;
    propagateLinkedHeal(ctx, target, healed);
  }
  return out;
}

/** `heal_over_time`: cura por rodada, resolvida de verdade pelo tick (tick.ts). */
export function applyHealOverTime(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) {
    addStatus(target, ctx.nextId(), "heal_over_time", duration.unit, duration.value, { amount: effect.amount });
  }
}

/** `shield`: soma escudo (não substitui) e define o reflexo, se houver. */
export function applyShield(effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    target.shield += effect.amount ?? 0;
    if (effect.reflect_amount !== undefined) target.reflect = effect.reflect_amount;
  }
}

/** `remove_negative_effects` / `remove_negative_effects_all_allies`. */
export function applyRemoveNegativeEffects(effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    removeNegativeStatuses(target, { all: effect.all, amount: effect.amount });
  }
}

/** `remove_positive_effects`: o inverso, usado pela Aurelia (Dissonância). */
export function applyRemovePositiveEffects(effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    removePositiveStatuses(target, { all: effect.all, amount: effect.amount });
  }
}

/** `grant_personal_mana` / `drain_personal_mana` (mana pessoal, não a de equipe). */
export function applyPersonalMana(effect: Effect, targets: ChampionStateV2[], sign: 1 | -1): void {
  for (const target of targets) {
    target.personalMana = Math.max(0, target.personalMana + sign * (effect.amount ?? 0));
  }
}

/** `push`: afasta cada alvo do atacante (ou de quem usou a carta) por `distance` casas. */
export function applyPush(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  const actualTargets = effect.area_radius !== undefined ? resolveAroundSelf(ctx, effect) : targets;
  for (const target of actualTargets) pushChampion(ctx.game, target, ctx.attacker.pos, effect.distance ?? 0);
}

/** `pull`: aproxima cada alvo de quem usou a carta por `distance` casas. */
export function applyPull(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  for (const target of targets) pullChampion(ctx.game, target, ctx.attacker.pos, effect.distance ?? 0);
}

/**
 * `move_self`: reposicionamento instantâneo do próprio dono. Com `ctx.moveDir`
 * (cartas de target "direction", ex. Dança das Lâminas da Vextra), avança em
 * linha naquela direção, parando antes de obstáculo. Com `ctx.moveDest`
 * (target "self", ex. Recuo Calculado da Niara), salta pra qualquer casa
 * livre a até `effect.distance` de distância.
 */
export function applyMoveSelf(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    if (ctx.moveDir) forcedMove(ctx.game, target, ctx.moveDir, effect.distance ?? 0);
    else if (ctx.moveDest) teleportChampion(ctx.game, target, ctx.moveDest, effect.distance ?? 0);
  }
}

/** `teleport_self`: salta pra uma casa escolhida (target "cell"), já validada em alcance por quem chamou. */
export function applyTeleportSelf(ctx: EffectContextV2, _effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.moveDest) return;
  for (const target of targets) teleportChampion(ctx.game, target, ctx.moveDest, Infinity);
}

/** `apply_venom_stacks`: acumula pilhas de veneno no alvo, até `max_stacks`. */
export function applyVenomStacks(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const gain = effect.amount ?? 1;
  const max = effect.max_stacks ?? Infinity;
  let actualTargets = targets;
  if (effect.all_enemies_in_range) actualTargets = resolveAllEnemiesInRange(ctx);
  else if (effect.radius !== undefined && ctx.targetCell) actualTargets = championsInRadius(ctx.game, ctx.targetCell, effect.radius);
  for (const target of actualTargets) {
    const current = statusAmount(target, "venom_stacks");
    if (current > 0) removeStatus(target, "venom_stacks");
    const next = Math.min(max, current + gain);
    addStatus(target, ctx.nextId(), "venom_stacks", "rounds", PERSISTENT_REMAINING, { amount: next, negative: true });
  }
}

/** `detonate_venom_stacks`: consome as pilhas do alvo, causando dano proporcional. */
export function applyDetonateVenomStacks(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const actualTargets = effect.all_poisoned_enemies ? resolveAllPoisonedEnemiesInRange(ctx) : targets;
  const out: Record<string, number> = {};
  for (const target of actualTargets) {
    const stacks = statusAmount(target, "venom_stacks");
    removeStatus(target, "venom_stacks");
    out[target.uid] = stacks > 0 ? dealDamageV2(ctx.attacker, target, stacks * (effect.damage_per_stack ?? 0)).final : 0;
  }
  return out;
}

/**
 * `link`: cria o vínculo (Elo) entre quem usou a carta e o alvo. Guardado
 * como status "link_heal" (Corrente de Vida da Selene — propaga cura, ver
 * propagateLinkedHeal) ou "link_control" (Elo Natural da Sylvane — propagação
 * de controle ainda não implementada, ver KANBAN.md), conforme qual
 * `share_*_percent` a carta trouxer.
 *
 * Nota de design em aberto: no texto original, o Elo Natural da Sylvane liga
 * dois INIMIGOS entre si ("compartilha entre inimigos"), não o próprio
 * campeão a um inimigo — mas a carta hoje só tem um `target: "enemy"" (um
 * alvo só). Até a camada de "jogar uma carta" existir e resolver isso,
 * applyLink liga sempre quem usou a carta a cada alvo recebido.
 */
export function applyLink(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  const duration = durationFromEffect(effect);
  const kind = effect.share_heal_percent !== undefined ? "link_heal" : "link_control";
  const amount = effect.share_heal_percent ?? effect.share_control_percent ?? effect.amount;
  for (const target of targets) {
    addStatus(ctx.attacker, ctx.nextId(), kind, duration.unit, duration.value, { amount, partner: target.uid });
    addStatus(target, ctx.nextId(), kind, duration.unit, duration.value, { amount, partner: ctx.attacker.uid });
  }
}

/** uid do parceiro de Elo ativo (cura ou controle) de um campeão, se houver. */
export function linkedPartnerOf(c: ChampionStateV2): string | null {
  return c.statuses.find((s) => s.status === "link_heal" || s.status === "link_control")?.partner ?? null;
}

/**
 * `ground_fire`: cria (ou renova, se já houver uma no mesmo centro e dono)
 * uma área de fogo em `ctx.targetCell`, que causa `damage_per_round` por
 * rodada a quem estiver dentro (resolvido no tick, ver tick.ts).
 */
export function applyGroundFire(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground = ctx.game.ground.filter((g) => !(g.kind === "fire" && sameHex(g.pos, ctx.targetCell!)));
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "fire",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
    damagePerRound: effect.damage_per_round,
  });
}

/**
 * `venom_zone`: cria uma área que aplica `stacks_per_round` pilhas de veneno
 * por rodada a quem estiver dentro (resolvido no tick, ver tick.ts).
 */
export function applyVenomZone(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground = ctx.game.ground.filter((g) => !(g.kind === "venom" && sameHex(g.pos, ctx.targetCell!)));
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "venom",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
    stacksPerRound: effect.stacks_per_round,
  });
}

/** `reflect_absorbed_damage`: enquanto tiver escudo, reflete `percent`% do dano absorvido (Vingança do Escudo). */
export function applyReflectAbsorbedDamage(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  ctx.attacker.reflectPercent = effect.percent ?? 0;
}

/**
 * `extend_existing_control`: estende a duração de todo controle (status
 * negativo) já ativo no alvo, na mesma unidade do `duration` da carta — não
 * aplica controle novo por si (Marca da Natureza da Sylvane). Sem controle
 * ativo, não faz nada.
 */
export function applyExtendExistingControl(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) {
    for (const st of target.statuses) {
      if (st.negative && st.unit === duration.unit) st.remaining += duration.value;
    }
  }
}

/**
 * `taunt_area`: provoca todo inimigo ao redor de quem usou a carta (status
 * "taunted", já negativo por convenção). Guarda só o status — fazer os
 * inimigos de fato priorizarem atacar o provocador depende da IA de
 * bots/boss, que ainda não existe no motor v2 (ver KANBAN.md).
 */
export function applyTauntArea(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  const duration = durationFromEffect(effect);
  const enemies = resolveAroundSelf(ctx, effect).filter((c) => c.team !== ctx.attacker!.team);
  for (const target of enemies) addStatus(target, ctx.nextId(), "taunted", duration.unit, duration.value, { negative: true });
}

/**
 * `block_ranged_attacks`: guarda o status no próprio dono da carta (Parede
 * Humana do Varek) — bloquear de fato ataques à distância contra ele (ou,
 * com `blocks_area`, contra a área ao redor) ainda depende de targeting.ts
 * saber ler esse status, o que não existe ainda (ver KANBAN.md).
 */
export function applyBlockRangedAttacks(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  const duration = durationFromEffect(effect);
  addStatus(ctx.attacker, ctx.nextId(), "block_ranged_attacks", duration.unit, duration.value, { negative: false, amount: effect.blocks_area ? 1 : 0 });
}

/**
 * `protective_dome`: guarda o status no(s) alvo(s) (Cúpula do Dorin,
 * combinável com `shield` na mesma carta). Reduzir/bloquear dano de fato
 * ainda depende de damage.ts saber ler esse status, o que não existe ainda.
 */
export function applyProtectiveDome(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) addStatus(target, ctx.nextId(), "protective_dome", duration.unit, duration.value, { negative: false });
}

/** `create_wall`: cria uma parede em `ctx.targetCell` (Barreira Rápida/Pilar do Dorin). */
export function applyCreateWall(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  if (wallAtV2(ctx.game, ctx.targetCell)) return; // já tem parede ali — não duplica, não renova sozinha
  ctx.game.walls.push({
    id: ctx.nextId(),
    pos: { ...ctx.targetCell },
    hp: effect.hp ?? balance.walls.normal_wall_hp,
    team: ctx.attacker.team,
    remaining: balance.walls.default_duration_rounds,
    blocksRangedAttacks: effect.blocks_ranged_attacks,
  });
}

/** `reinforce_wall`: soma hp a uma parede já existente em `ctx.targetCell` (target "wall"). Sem parede ali, não faz nada. */
export function applyReinforceWall(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.targetCell) return;
  const wall = wallAtV2(ctx.game, ctx.targetCell);
  if (!wall) return;
  wall.hp += effect.amount ?? effect.bonus_hp ?? 0;
  if (effect.permanent) wall.remaining = null;
}

/** `destroy_wall`: remove a parede em `ctx.targetCell`, se houver. */
export function applyDestroyWall(ctx: EffectContextV2): void {
  if (!ctx.targetCell) return;
  ctx.game.walls = ctx.game.walls.filter((w) => !sameHex(w.pos, ctx.targetCell!));
}

/** `move_in_line`: avança em linha reta na direção escolhida, parando antes de obstáculo (Investida Selvagem/Perseguição do Borak). */
export function applyMoveInLine(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.moveDir) return;
  forcedMove(ctx.game, ctx.attacker, ctx.moveDir, effect.distance ?? 0);
}

/** Primeiro campeão vivo (de qualquer equipe) na direção `ctx.moveDir` a partir de quem usou a carta, se houver, antes de uma parede ou da borda. */
function firstChampionInPath(ctx: EffectContextV2): ChampionStateV2 | null {
  if (!ctx.attacker || !ctx.moveDir) return null;
  let pos = ctx.attacker.pos;
  const maxSteps = ctx.game.board.q_size + ctx.game.board.r_size;
  for (let i = 0; i < maxSteps; i++) {
    pos = addHex(pos, ctx.moveDir);
    if (!inHexBoard(pos, ctx.game.board) || wallAtV2(ctx.game, pos)) return null;
    const hit = allChampionsV2(ctx.game).find((c) => c.alive && c.uid !== ctx.attacker!.uid && sameHex(c.pos, pos));
    if (hit) return hit;
  }
  return null;
}

/**
 * `damage_first_in_path`: dano ao primeiro campeão na direção da investida
 * (Investida Selvagem/Perseguição Implacável do Borak), com empurrão opcional
 * (`push_distance`). O parâmetro `stun_if_target_marked_or_weak` ainda não é
 * avaliado — depende do status "mark"/de um conceito de "fraco" que o motor
 * v2 não define ainda (ver KANBAN.md).
 */
export function applyDamageFirstInPath(ctx: EffectContextV2, effect: Effect): Record<string, number> {
  const target = firstChampionInPath(ctx);
  if (!target || !ctx.attacker) return {};
  const out: Record<string, number> = { [target.uid]: dealDamageV2(ctx.attacker, target, effect.amount ?? 0).final };
  if (effect.push_distance) pushChampion(ctx.game, target, ctx.attacker.pos, effect.push_distance);
  ctx.lastTarget = target;
  return out;
}

/** `damage_pierce_line`: dano em até `targets` campeões em linha, a partir de quem usou a carta na direção do alvo escolhido (Disparo Perfurante da Niara). */
export function applyDamagePierceLine(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  if (!ctx.attacker || targets.length === 0) return {};
  const dir = hexDirectionTo(ctx.attacker.pos, targets[0].pos);
  if (dir.q === 0 && dir.r === 0) return {};
  const out: Record<string, number> = {};
  const maxHits = effect.targets ?? 1;
  const maxSteps = ctx.game.board.q_size + ctx.game.board.r_size;
  let pos = ctx.attacker.pos;
  for (let i = 0; i < maxSteps && Object.keys(out).length < maxHits; i++) {
    pos = addHex(pos, dir);
    if (!inHexBoard(pos, ctx.game.board) || wallAtV2(ctx.game, pos)) break;
    const hit = allChampionsV2(ctx.game).find((c) => c.alive && c.uid !== ctx.attacker!.uid && sameHex(c.pos, pos));
    if (hit) out[hit.uid] = dealDamageV2(ctx.attacker, hit, effect.amount ?? 0).final;
  }
  return out;
}

/** `damage_behind_target`: dano em quem estiver bem atrás do alvo escolhido, na mesma linha de ataque (Golpe Fendente do Borak). */
export function applyDamageBehindTarget(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  if (!ctx.attacker || targets.length === 0) return {};
  const primary = targets[0];
  const dir = hexDirectionTo(ctx.attacker.pos, primary.pos);
  if (dir.q === 0 && dir.r === 0) return {};
  const behindPos = addHex(primary.pos, dir);
  const behind = allChampionsV2(ctx.game).find((c) => c.alive && c.uid !== ctx.attacker!.uid && sameHex(c.pos, behindPos));
  if (!behind) return {};
  return { [behind.uid]: dealDamageV2(ctx.attacker, behind, effect.amount ?? 0).final };
}

/**
 * `damage_second_target` / `damage_third_target`: ricochete (Ricochete da
 * Niara) — acerta o campeão vivo mais próximo do ÚLTIMO alvo atingido nesta
 * mesma carta (`ctx.lastTarget`, deixado pelo bloco `damage` anterior), a até
 * `max_distance_from_first`/`max_distance_from_second` casas, excluindo quem
 * já foi atingido. Sem alvo anterior ou sem ninguém por perto, não faz nada.
 */
function applyDamageChainedTarget(ctx: EffectContextV2, effect: Effect, maxDistanceKey: string): Record<string, number> {
  if (!ctx.lastTarget) return {};
  const exclude = new Set<string>(ctx.hitChain ?? []);
  exclude.add(ctx.lastTarget.uid);
  if (ctx.attacker) exclude.add(ctx.attacker.uid);
  const next = nearestOtherChampion(ctx.game, ctx.lastTarget.pos, effect[maxDistanceKey] ?? 0, exclude);
  if (!next) return {};
  const out = { [next.uid]: dealDamageV2(ctx.attacker, next, effect.amount ?? 0).final };
  ctx.lastTarget = next;
  ctx.hitChain = new Set([...exclude, next.uid]);
  return out;
}

export const applyDamageSecondTarget = (ctx: EffectContextV2, effect: Effect): Record<string, number> =>
  applyDamageChainedTarget(ctx, effect, "max_distance_from_first");

export const applyDamageThirdTarget = (ctx: EffectContextV2, effect: Effect): Record<string, number> =>
  applyDamageChainedTarget(ctx, effect, "max_distance_from_second");

/** `gap_close_strike`: teleporta quem usou a carta pra uma casa livre ao lado do alvo, a até `distance` do ponto de partida (Sombra Letal da Vextra). */
export function applyGapCloseStrike(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker || targets.length === 0) return;
  const target = targets[0];
  const maxDistance = effect.distance ?? Infinity;
  const candidates = hexNeighbors(target.pos)
    .filter((h) => inHexBoard(h, ctx.game.board) && !wallAtV2(ctx.game, h) && isEmptyOfChampions(ctx.game, h))
    .filter((h) => hexDistance(ctx.attacker!.pos, h) <= maxDistance)
    .sort((a, b) => hexDistance(ctx.attacker!.pos, a) - hexDistance(ctx.attacker!.pos, b));
  const dest = candidates[0];
  if (!dest) return;
  ctx.attacker.pos = { ...dest };
}

/** `buff_next_card`: guarda o bônus pra próxima carta jogada pela equipe (Passo das Sombras da Vextra). Consumir esse bônus é tarefa da camada de "jogar carta", que ainda não existe (ver KANBAN.md). */
export function applyBuffNextCard(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  ctx.game.teams[ctx.attacker.team].nextCardBuff = { bonusDamage: effect.bonus_damage ?? 0 };
}

const DISPATCH: Record<string, (ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]) => void> = {
  damage: (ctx, effect, targets) => applyDamage(ctx, effect, targets),
  apply_status: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  apply_status_area: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  apply_status_all_allies: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  heal: (ctx, effect, targets) => applyHeal(ctx, effect, targets) as unknown as void,
  heal_all_allies: (ctx, effect, targets) => applyHeal(ctx, effect, targets) as unknown as void,
  shield: (_ctx, effect, targets) => applyShield(effect, targets),
  shield_all_allies: (_ctx, effect, targets) => applyShield(effect, targets),
  remove_negative_effects: (_ctx, effect, targets) => applyRemoveNegativeEffects(effect, targets),
  remove_negative_effects_all_allies: (_ctx, effect, targets) => applyRemoveNegativeEffects(effect, targets),
  remove_positive_effects: (_ctx, effect, targets) => applyRemovePositiveEffects(effect, targets),
  grant_personal_mana: (_ctx, effect, targets) => applyPersonalMana(effect, targets, 1),
  drain_personal_mana: (_ctx, effect, targets) => applyPersonalMana(effect, targets, -1),
  push: (ctx, effect, targets) => applyPush(ctx, effect, targets),
  pull: (ctx, effect, targets) => applyPull(ctx, effect, targets),
  move_self: (ctx, effect, targets) => applyMoveSelf(ctx, effect, targets),
  teleport_self: (ctx, effect, targets) => applyTeleportSelf(ctx, effect, targets),
  apply_venom_stacks: (ctx, effect, targets) => applyVenomStacks(ctx, effect, targets),
  detonate_venom_stacks: (ctx, effect, targets) => applyDetonateVenomStacks(ctx, effect, targets) as unknown as void,
  link: (ctx, effect, targets) => applyLink(ctx, effect, targets),
  heal_over_time: (ctx, effect, targets) => applyHealOverTime(ctx, effect, targets),
  ground_fire: (ctx, effect) => applyGroundFire(ctx, effect),
  venom_zone: (ctx, effect) => applyVenomZone(ctx, effect),
  apply_status_around_self: (ctx, effect) => applyStatusAroundSelf(ctx, effect),
  self_damage: (ctx, effect) => applySelfDamage(ctx, effect) as unknown as void,
  reflect_absorbed_damage: (ctx, effect) => applyReflectAbsorbedDamage(ctx, effect),
  extend_existing_control: (ctx, effect, targets) => applyExtendExistingControl(ctx, effect, targets),
  taunt_area: (ctx, effect) => applyTauntArea(ctx, effect),
  block_ranged_attacks: (ctx, effect) => applyBlockRangedAttacks(ctx, effect),
  protective_dome: (ctx, effect, targets) => applyProtectiveDome(ctx, effect, targets),
  create_wall: (ctx, effect) => applyCreateWall(ctx, effect),
  reinforce_wall: (ctx, effect) => applyReinforceWall(ctx, effect),
  destroy_wall: (ctx) => applyDestroyWall(ctx),
  move_in_line: (ctx, effect) => applyMoveInLine(ctx, effect),
  damage_first_in_path: (ctx, effect) => applyDamageFirstInPath(ctx, effect) as unknown as void,
  damage_pierce_line: (ctx, effect, targets) => applyDamagePierceLine(ctx, effect, targets) as unknown as void,
  damage_behind_target: (ctx, effect, targets) => applyDamageBehindTarget(ctx, effect, targets) as unknown as void,
  damage_second_target: (ctx, effect) => applyDamageSecondTarget(ctx, effect) as unknown as void,
  damage_third_target: (ctx, effect) => applyDamageThirdTarget(ctx, effect) as unknown as void,
  gap_close_strike: (ctx, effect, targets) => applyGapCloseStrike(ctx, effect, targets),
  buff_next_card: (ctx, effect) => applyBuffNextCard(ctx, effect),
};

/** Tipos de efeito que já têm execução real no motor v2 (os outros ainda só existem como dado). */
export const IMPLEMENTED_EFFECT_TYPES: string[] = Object.keys(DISPATCH);

/**
 * Executa um bloco de efeito sobre os alvos já resolvidos. Lança erro se o
 * tipo ainda não está implementado — a lista de implementados cresce conforme
 * os incrementos do KANBAN avançam pelo catálogo de claude/formato-dados.md.
 */
export function applyEffectV2(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const fn = DISPATCH[effect.type];
  if (!fn) throw new Error(`Tipo de efeito ainda não implementado no motor v2: ${effect.type}`);
  fn(ctx, effect, targets);
}
