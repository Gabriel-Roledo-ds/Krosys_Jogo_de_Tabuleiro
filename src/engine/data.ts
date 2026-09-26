// Carrega os JSONs de data/. O motor não tem números de regra fixos no código:
// tudo vem de balance.json, champions.json, cards.json, boss.json e monsters.json.

import balanceJson from "../../data/balance.json";
import championsJson from "../../data/champions.json";
import cardsJson from "../../data/cards.json";
import bossJson from "../../data/boss.json";
import monstersJson from "../../data/monsters.json";

export const balance = balanceJson;
export const championDefs = championsJson;
export const cardDefs = cardsJson;
export const bossDef = bossJson;
export const monsterData = monstersJson;

export type Balance = typeof balanceJson;
export type ChampionDef = (typeof championsJson)[number];
export type CardDef = (typeof cardsJson)[number];

export function getChampionDef(id: string): ChampionDef {
  const def = championDefs.find((c) => c.id === id);
  if (!def) throw new Error(`Campeão desconhecido: ${id}`);
  return def;
}
