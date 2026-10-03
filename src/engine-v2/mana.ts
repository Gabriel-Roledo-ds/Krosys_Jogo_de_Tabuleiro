// Mana de equipe do motor hexagonal (roster v2) — igual a src/engine/mana.ts,
// mas lendo balance.mana_v2 (teto 15 em vez de 10, ver regras-e-decisoes.md
// §19 e balance.json). Mana pessoal (por campeão) é GANHA/PERDIDA em
// effects.ts (grant_personal_mana/drain_personal_mana — poções, buffs); aqui
// mora só o lado de GASTAR: toda carta v2 tem um dono fixo (CardInstanceV2.owner,
// diferente do MVP), então o custo de QUALQUER carta pode ser coberto também
// pela mana pessoal do dono, nunca a de outro campeão nem a mana de equipe de
// outro time — "só serve pras cartas do próprio campeão" (regras-e-decisoes.md
// §6/§19). [PADRÃO, 02/10/2026]: a mana pessoal é gasta SEMPRE primeiro (até
// cobrir o custo), e a de equipe cobre o resto — like a personal pool is
// otherwise useless to anyone else, não há razão pra guardá-la em vez de usar.

import { balance } from "../engine/data";
import { getChampionV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";

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

/** Custo de uma carta coberto pela mana pessoal do dono + mana de equipe, juntas. */
export const canPayCardV2 = (s: GameStateV2, team: TeamId, owner: ChampionStateV2, cost: number): boolean =>
  s.teams[team].mana + owner.personalMana >= cost;

/**
 * Gasta o custo de uma carta: mana pessoal do dono primeiro (até cobrir o
 * custo), mana de equipe pelo resto. Lança erro se as duas juntas não
 * bastarem. Usado por toda carta (não pela básica, que custa 0) — ver
 * cabeçalho do arquivo.
 */
export function spendCardManaV2(s: GameStateV2, team: TeamId, owner: ChampionStateV2, cost: number): void {
  if (!canPayCardV2(s, team, owner, cost)) {
    throw new Error(`Mana insuficiente: tem ${s.teams[team].mana} de equipe + ${owner.personalMana} pessoal, custa ${cost}`);
  }
  const fromPersonal = Math.min(owner.personalMana, cost);
  owner.personalMana -= fromPersonal;
  s.teams[team].mana -= cost - fromPersonal;
}

/** Atalho pra achar o dono de uma carta e checar/gastar a combinação acima. */
export const canPayCardOwnerV2 = (s: GameStateV2, team: TeamId, ownerUid: string, cost: number): boolean => canPayCardV2(s, team, getChampionV2(s, ownerUid), cost);
