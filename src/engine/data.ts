// Carrega os JSONs de data/. O motor não tem números de regra fixos no código:
// tudo vem de balance.json, champions.json, cards.json, boss.json e monsters.json.

import balanceJson from "../../data/balance.json";
import championsJson from "../../data/champions.json";
import cardsJson from "../../data/cards.json";
import bossJson from "../../data/boss.json";
import monstersJson from "../../data/monsters.json";

/** Bloco de efeito: `type` mais parâmetros livres (ver docs/formato-dados.md). */
export interface Effect {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface Duration {
  unit: "rounds" | "champion_turns";
  value: number;
}

export interface CardDef {
  id: string;
  /** id do campeão dono, ou "monster" */
  owner: string;
  name: string;
  cost: number;
  fast: boolean;
  range: number | "self";
  target: string;
  effects: Effect[];
  text: string;
  source?: string;
  assumed_range?: boolean;
}

export interface BasicDef {
  name: string;
  range: number | "self";
  target: string;
  effects: Effect[];
}

export interface ChampionDef {
  id: string;
  name: string;
  role: string;
  hp: number;
  defense: number;
  basic: BasicDef;
  passive: { name: string; effects: Effect[] };
}

export interface BossCardDef {
  id: string;
  name: string;
  target: "closest" | "last_attacker" | "aura" | "area";
  radius?: number;
  aura_scope?: "boss" | "radius";
  effects: Effect[];
  text: string;
}

export interface MonsterType {
  name: string;
  hp: number;
  defense: number;
  range: number;
  attack: number;
  continuous_effect: { type: string; amount: number };
  reward_card: string;
}

export const balance = balanceJson;
export type Balance = typeof balanceJson;

export const championDefs = championsJson as unknown as ChampionDef[];
export const cardDefs = cardsJson as unknown as CardDef[];
export const bossDef = bossJson as unknown as { hp: number; defense: number; range: number; deck: BossCardDef[] };
export const monsterTypes = monstersJson.types as unknown as Record<string, MonsterType>;
export const monsterPlacements = monstersJson.placements as unknown as {
  id: string;
  type: string;
  ring: string;
  position: { x: number; y: number };
}[];

const championById = new Map(championDefs.map((c) => [c.id, c]));
const cardById = new Map(cardDefs.map((c) => [c.id, c]));
const bossCardById = new Map(bossDef.deck.map((c) => [c.id, c]));

export function getChampionDef(id: string): ChampionDef {
  const def = championById.get(id);
  if (!def) throw new Error(`Campeão desconhecido: ${id}`);
  return def;
}

export function getCardDef(id: string): CardDef {
  const def = cardById.get(id);
  if (!def) throw new Error(`Carta desconhecida: ${id}`);
  return def;
}

export function getBossCard(id: string): BossCardDef {
  const def = bossCardById.get(id);
  if (!def) throw new Error(`Carta do boss desconhecida: ${id}`);
  return def;
}

/** Cartas do baralho de um campeão (as de monstro ficam de fora). */
export const deckCardIds = (championId: string): string[] =>
  cardDefs.filter((c) => c.owner === championId).map((c) => c.id);
