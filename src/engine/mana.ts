// Mana compartilhada pela equipe. Fase 2 do turno: ganha energia até o teto.

import { balance } from "./data";
import type { GameState, TeamId } from "./state";

/** Fase 2: sobe a mana da equipe (padrão +1) sem passar do teto (padrão 10). */
export function gainTurnMana(state: GameState, team: TeamId): number {
  return addMana(state, team, balance.mana.gain_per_turn);
}

/** Soma mana respeitando o teto. Devolve a mana final. */
export function addMana(state: GameState, team: TeamId, amount: number): number {
  const t = state.teams[team];
  t.mana = Math.min(balance.mana.cap, t.mana + amount);
  return t.mana;
}

export const canPay = (state: GameState, team: TeamId, cost: number): boolean =>
  state.teams[team].mana >= cost;

/** Gasta mana. Lança erro se a equipe não tiver o suficiente. */
export function spendMana(state: GameState, team: TeamId, cost: number): number {
  if (!canPay(state, team, cost)) {
    throw new Error(`Mana insuficiente: tem ${state.teams[team].mana}, custa ${cost}`);
  }
  state.teams[team].mana -= cost;
  return state.teams[team].mana;
}
