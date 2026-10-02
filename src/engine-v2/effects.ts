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
import type { ChampionStateV2 } from "./state";
import { dealDamageV2, type DamageOptsV2 } from "./damage";
import { addStatus, removeNegativeStatuses, removePositiveStatuses } from "./status";

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
  attacker: ChampionStateV2 | null;
  /** Gera o próximo id único de status, igual a nextId(s) do estado. */
  nextId: () => number;
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

/** `heal`: cura, sem passar do hp máximo. Devolve a cura efetiva por alvo. */
export function applyHeal(effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const target of targets) {
    if (!target.alive) {
      out[target.uid] = 0;
      continue;
    }
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + (effect.amount ?? 0));
    out[target.uid] = target.hp - before;
  }
  return out;
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

const DISPATCH: Record<string, (ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]) => void> = {
  damage: (ctx, effect, targets) => applyDamage(ctx, effect, targets),
  apply_status: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  apply_status_area: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  apply_status_all_allies: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  heal: (_ctx, effect, targets) => applyHeal(effect, targets) as unknown as void,
  heal_all_allies: (_ctx, effect, targets) => applyHeal(effect, targets) as unknown as void,
  shield: (_ctx, effect, targets) => applyShield(effect, targets),
  shield_all_allies: (_ctx, effect, targets) => applyShield(effect, targets),
  remove_negative_effects: (_ctx, effect, targets) => applyRemoveNegativeEffects(effect, targets),
  remove_negative_effects_all_allies: (_ctx, effect, targets) => applyRemoveNegativeEffects(effect, targets),
  remove_positive_effects: (_ctx, effect, targets) => applyRemovePositiveEffects(effect, targets),
  grant_personal_mana: (_ctx, effect, targets) => applyPersonalMana(effect, targets, 1),
  drain_personal_mana: (_ctx, effect, targets) => applyPersonalMana(effect, targets, -1),
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
