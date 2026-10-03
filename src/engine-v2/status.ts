// Status de campeão no motor hexagonal (roster v2). Cada status tem um `status`
// (nome livre, catalogado em claude/formato-dados.md) e um `amount` opcional.
// Positivo (buff) ou negativo (debuff/controle) é dado pelo campo `negative` de
// quem cria o status, não pelo nome — mas por convenção os nomes já indicam o
// sentido (ex. "defense_buff" vs. "defense_down").

import type { ChampionStateV2, StatusV2 } from "./state";

/** Cura simples, sem passar do hp máximo. Devolve a cura efetiva. Usado pelo tick (heal_over_time). */
export function heal(c: ChampionStateV2, amount: number): number {
  if (!c.alive) return 0;
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + amount);
  return c.hp - before;
}

export function hasStatus(c: ChampionStateV2, status: string): boolean {
  return c.statuses.some((s) => s.status === status);
}

/** Soma o `amount` de todos os status ativos com esse nome (0 se nenhum). */
export function statusAmount(c: ChampionStateV2, status: string): number {
  return c.statuses.filter((s) => s.status === status).reduce((sum, s) => sum + (s.amount ?? 0), 0);
}

export interface AddStatusOptions {
  amount?: number;
  negative?: boolean;
  partner?: string;
  /** Raio da explosão — só usado por "death_ward" (ver death.ts). */
  radius?: number;
  /** Status "mark" que salta pro inimigo mais próximo se o marcado morrer (ver death.ts). */
  jumpOnDeath?: boolean;
  /** Status "fire_trail_active" (ver turn.ts/effects.ts applyFireTrail). */
  trailDurationRounds?: number;
  trailInstantBonus?: number;
}

/** Adiciona um status com duração; não funde com um já existente (pode haver vários). */
export function addStatus(
  c: ChampionStateV2,
  nextId: number,
  status: string,
  unit: "rounds" | "champion_turns",
  duration: number,
  opts: AddStatusOptions = {},
): StatusV2 {
  const entry: StatusV2 = {
    id: nextId,
    status,
    unit,
    remaining: duration,
    amount: opts.amount,
    negative: opts.negative ?? false,
    partner: opts.partner,
    radius: opts.radius,
    jumpOnDeath: opts.jumpOnDeath,
    trailDurationRounds: opts.trailDurationRounds,
    trailInstantBonus: opts.trailInstantBonus,
  };
  c.statuses.push(entry);
  return entry;
}

/** Remove todos os status com esse nome. Devolve quantos foram removidos. */
export function removeStatus(c: ChampionStateV2, status: string): number {
  const before = c.statuses.length;
  c.statuses = c.statuses.filter((s) => s.status !== status);
  return before - c.statuses.length;
}

/** Remove até `amount` status negativos (ou todos, com `all: true`). */
export function removeNegativeStatuses(c: ChampionStateV2, opts: { all?: boolean; amount?: number } = {}): number {
  const negatives = c.statuses.filter((s) => s.negative);
  const toRemove = opts.all ? negatives : negatives.slice(0, opts.amount ?? 1);
  for (const st of toRemove) {
    const idx = c.statuses.indexOf(st);
    if (idx >= 0) c.statuses.splice(idx, 1);
  }
  return toRemove.length;
}

/** Remove até `amount` status positivos (buffs) — o inverso de removeNegativeStatuses. */
export function removePositiveStatuses(c: ChampionStateV2, opts: { all?: boolean; amount?: number } = {}): number {
  const positives = c.statuses.filter((s) => !s.negative);
  const toRemove = opts.all ? positives : positives.slice(0, opts.amount ?? 1);
  for (const st of toRemove) {
    const idx = c.statuses.indexOf(st);
    if (idx >= 0) c.statuses.splice(idx, 1);
  }
  return toRemove.length;
}

/**
 * Passa o tempo: reduz `remaining` dos status da unidade `unit` em 1 e remove
 * os que chegaram a 0. Chamado em pontos distintos do turno pra "rounds" (fim
 * de rodada) e "champion_turns" (fim do turno do próprio campeão) — ver tick.ts
 * do MVP para o equivalente.
 */
export function tickStatuses(c: ChampionStateV2, unit: "rounds" | "champion_turns"): void {
  for (const s of c.statuses) {
    if (s.unit === unit) s.remaining -= 1;
  }
  c.statuses = c.statuses.filter((s) => s.remaining > 0);
}
