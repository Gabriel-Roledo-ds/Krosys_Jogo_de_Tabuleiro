// Status em campeões: marca, controle, cura contínua, elo, imunidade.

import { balance } from "./data";
import { type ChampionState, type GameState, type Status } from "./state";

type NewStatus = Omit<Status, "id" | "fresh">;

export function addStatus(s: GameState, c: ChampionState, st: NewStatus): Status {
  const fresh = s.turn.phase === "act" && s.turn.activated.includes(c.uid);
  const status: Status = { ...st, id: s.nextId++, fresh };
  // Mesmo tipo de marca ou de imunidade: renova em vez de empilhar.
  if (st.kind === "mark" || st.kind === "control_immune") {
    c.statuses = c.statuses.filter((x) => x.kind !== st.kind);
  }
  c.statuses.push(status);
  return status;
}

export const hasStatus = (c: ChampionState, kind: Status["kind"]): boolean => c.statuses.some((x) => x.kind === kind);

export const statusAmount = (c: ChampionState, kind: Status["kind"]): number =>
  c.statuses.filter((x) => x.kind === kind).reduce((sum, x) => sum + (x.amount ?? 0), 0);

/**
 * Tenta aplicar um efeito de controle. Falha se o campeão está imune ou já sofreu
 * controle nesta rodada (limite de 1 por rodada). Se passar, registra a rodada.
 */
export function tryControl(s: GameState, c: ChampionState): boolean {
  if (hasStatus(c, "control_immune")) return false;
  if (balance.effects.max_control_effects_per_champion_per_round <= 1 && c.lastControlRound === s.round) return false;
  c.lastControlRound = s.round;
  return true;
}

/** Remove efeitos negativos (Purificar). Devolve quantos foram removidos. */
export function removeNegative(c: ChampionState): number {
  const before = c.statuses.length;
  c.statuses = c.statuses.filter((x) => !x.negative);
  return before - c.statuses.length;
}

export function heal(c: ChampionState, amount: number): number {
  if (!c.alive) return 0;
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + amount);
  return c.hp - before;
}

/** Ao fim do turno de um campeão principal, expira o controle que já valeu neste turno. */
export function expireTurnStatuses(c: ChampionState): void {
  c.statuses = c.statuses.filter((x) => {
    if (x.unit !== "champion_turns") return true;
    if (x.fresh) {
      x.fresh = false;
      return true;
    }
    return false;
  });
}
