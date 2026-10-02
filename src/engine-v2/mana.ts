// Mana de equipe do motor hexagonal (roster v2) — igual a src/engine/mana.ts,
// mas lendo balance.mana_v2 (teto 15 em vez de 10, ver regras-e-decisoes.md
// §19 e balance.json). Mana pessoal (por campeão) é tratada em effects.ts
// (grant_personal_mana/drain_personal_mana), não aqui.

import { balance } from "../engine/data";
import type { GameStateV2, TeamId } from "./state";

/** Fase de compra: sobe a mana da equipe (+3 por padrão) sem passar do teto (15). */
export function gainTurnManaV2(s: GameStateV2, team: TeamId): number {
  return addManaV2(s, team, balance.mana_v2.gain_per_turn);
}

/** Soma mana de equipe respeitando o teto. Devolve a mana final. */
export function addManaV2(s: GameStateV2, team: TeamId, amount: number): number {
  const t = s.teams[team];
  t.mana = Math.min(balance.mana_v2.cap, t.mana + amount);
  return t.mana;
}

export const canPayV2 = (s: GameStateV2, team: TeamId, cost: number): boolean => s.teams[team].mana >= cost;

/** Gasta mana de equipe. Lança erro se não houver o suficiente. */
export function spendManaV2(s: GameStateV2, team: TeamId, cost: number): number {
  if (!canPayV2(s, team, cost)) throw new Error(`Mana insuficiente: tem ${s.teams[team].mana}, custa ${cost}`);
  s.teams[team].mana -= cost;
  return s.teams[team].mana;
}
