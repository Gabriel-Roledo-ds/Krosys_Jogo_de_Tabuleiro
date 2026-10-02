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

import type { Effect } from "../engine/data";
import type { Hex } from "../design/hexGrid";
import { allChampionsV2, type ChampionStateV2, type GameStateV2 } from "./state";
import { dealDamageV2, type DamageOptsV2 } from "./damage";
import { addStatus, heal, removeNegativeStatuses, removePositiveStatuses, removeStatus, statusAmount } from "./status";
import { forcedMove, pullChampion, pushChampion, teleportChampion } from "./movement";

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
}

/** `damage`: causa dano a cada alvo. Devolve o resultado por alvo (uid -> dano final). */
export function applyDamage(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const opts: DamageOptsV2 = {
    ignoreDefense: effect.ignore_defense,
    ignoreShield: effect.ignore_shield,
  };
  const out: Record<string, number> = {};
  for (const target of targets) {
    out[target.uid] = dealDamageV2(ctx.attacker, target, effect.amount ?? 0, opts).final;
  }
  return out;
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
  for (const target of targets) pushChampion(ctx.game, target, ctx.attacker.pos, effect.distance ?? 0);
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
  for (const target of targets) {
    const current = statusAmount(target, "venom_stacks");
    if (current > 0) removeStatus(target, "venom_stacks");
    const next = Math.min(max, current + gain);
    addStatus(target, ctx.nextId(), "venom_stacks", "rounds", PERSISTENT_REMAINING, { amount: next, negative: true });
  }
}

/** `detonate_venom_stacks`: consome as pilhas do alvo, causando dano proporcional. */
export function applyDetonateVenomStacks(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const target of targets) {
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
