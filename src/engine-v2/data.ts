// Carrega os dados do roster v2 (data/champions_v2.json, data/cards_v2.json).
// Motor hexagonal — ver regras-e-decisoes.md §19/§20 e claude/formato-dados.md.
// Ainda não é o jogo jogável: o MVP (src/engine/) continua sendo o motor em
// produção até essa etapa terminar (ver KANBAN.md).

import championsJson from "../../data/champions_v2.json";
import cardsJson from "../../data/cards_v2.json";
import monstersMapJson from "../../data/monsters_map.json";
import type { Effect } from "../engine/data";

export interface CardRank {
  rank: number;
  cost: number;
  range: number | string | null;
  text: string;
  effects: Effect[];
  assumed_range?: boolean;
}

export type RankType = "regular" | "exclusive" | "climax";

export interface CardDefV2 {
  id: string;
  owner: string;
  name: string;
  notes: string | null;
  fast: boolean;
  rank_type: RankType;
  ranks: CardRank[];
  target: string;
}

export interface BasicDefV2 {
  name: string;
  range: number | "self";
  effects: Effect[];
  text: string;
}

export interface PassiveDefV2 {
  name: string;
  text: string;
}

export interface SacrificeDefV2 {
  name: string;
  text: string;
}

export interface ChampionDefV2 {
  id: string;
  name: string;
  archetype: string;
  role: "dano" | "suporte";
  hp: number;
  defense: number;
  basic: BasicDefV2;
  passive: PassiveDefV2;
  sacrifice: SacrificeDefV2 | null;
}

export interface PotionTemplate {
  name: string;
  cost: number;
  fast: boolean;
  effects: Effect[];
  text: string;
}

const championsData = championsJson as {
  potion_templates: Record<string, PotionTemplate>;
  potions_per_champion: { count: number; templates: string[]; proportion_choice: string };
  champions: ChampionDefV2[];
};

export const championsV2: ChampionDefV2[] = championsData.champions;
export const potionTemplates = championsData.potion_templates;
export const potionsPerChampion = championsData.potions_per_champion;

export const cardsV2: CardDefV2[] = cardsJson as CardDefV2[];

/**
 * Cartas de recompensa de monstro (claude/monstros-mapa.md, item 7 do KANBAN)
 * vêm em data/monsters_map.json#reward_cards no formato "chato" do MVP original
 * (cost/range/effects direto, sem ranks) — não em cards_v2.json. Adaptadas aqui
 * pra um único rank (★, rank 1) do formato v2, só pra poderem ser jogadas pelo
 * mesmo playCardV2/resolveCardEffectsV2 sem duplicar lógica. `getCardDefV2`
 * procura nas duas listas.
 */
interface RawRewardCardV2 {
  id: string;
  owner: string;
  name: string;
  cost: number;
  fast: boolean;
  range: number | "self";
  target: string;
  effects: Effect[];
  text: string;
}

const rawRewardCards = (monstersMapJson as unknown as { reward_cards: Record<string, RawRewardCardV2> }).reward_cards;

export const monsterRewardCardsV2: CardDefV2[] = Object.values(rawRewardCards).map((raw) => ({
  id: raw.id,
  owner: raw.owner,
  name: raw.name,
  notes: null,
  fast: raw.fast,
  rank_type: "exclusive",
  target: raw.target,
  ranks: [{ rank: 1, cost: raw.cost, range: raw.range, text: raw.text, effects: raw.effects }],
}));

const championById = new Map(championsV2.map((c) => [c.id, c]));

export function getChampionDefV2(id: string): ChampionDefV2 {
  const c = championById.get(id);
  if (!c) throw new Error(`Campeão v2 inexistente: ${id}`);
  return c;
}

export function cardsOf(championId: string): CardDefV2[] {
  return cardsV2.filter((c) => c.owner === championId);
}

const cardById = new Map([...cardsV2, ...monsterRewardCardsV2].map((c) => [c.id, c]));

export function getCardDefV2(id: string): CardDefV2 {
  const c = cardById.get(id);
  if (!c) throw new Error(`Carta v2 inexistente: ${id}`);
  return c;
}

/** Rank escolhido de uma carta. Lança erro se o rank não existir pra essa carta. */
export function getCardRankV2(card: CardDefV2, rank: number): CardRank {
  const r = card.ranks.find((x) => x.rank === rank);
  if (!r) throw new Error(`Carta ${card.id} não tem rank ${rank}`);
  return r;
}

/** Cópias de cada carta no baralho de 30, conforme regras-e-decisoes.md §19. */
export function copiesForRankType(rankType: RankType): number {
  if (rankType === "regular") return 3;
  if (rankType === "exclusive") return 2;
  return 1; // climax
}

/**
 * Monta a lista de ids de carta que entram no baralho de 30 de um campeão:
 * uma entrada por cópia de cada carta (regular/exclusive/climax), mais as 3
 * poções (vida/mana, na proporção escolhida pelo jogador). O baralho não
 * resolve "qual rank" aqui — isso é escolha do jogador na hora de comprar/jogar,
 * ver regras-e-decisoes.md §19 (pendência de implementação).
 */
export function deckCardIdsV2(championId: string, potionChoice: ("life" | "mana")[]): string[] {
  if (potionChoice.length !== potionsPerChampion.count) {
    throw new Error(`Escolha de poções precisa ter ${potionsPerChampion.count} itens`);
  }
  const ids: string[] = [];
  for (const card of cardsOf(championId)) {
    const copies = copiesForRankType(card.rank_type);
    for (let i = 0; i < copies; i++) ids.push(card.id);
  }
  for (const potion of potionChoice) ids.push(`potion_${potion}`);
  return ids;
}

const SUPPORT_EFFECT_TYPES = new Set(["heal", "heal_over_time", "shield", "remove_negative_effects", "grant_personal_mana"]);
const GROUND_EFFECT_TYPES = new Set(["create_wall", "create_structure", "ground_fire", "venom_zone"]);

/**
 * Alvo da habilidade básica de um campeão v2 — `champions_v2.json` não guarda
 * um campo `target` pra ela (só `range`+`effects`), diferente das cartas de
 * `cards_v2.json`. Inferido dos próprios `effects`, regra [PADRÃO] documentada
 * em regras-e-decisoes.md §6 ("Alvo da habilidade básica no roster v2"):
 * 1) um `target` explícito num bloco de efeito vence (ex. Bênção da Aurelia);
 * 2) senão, só efeito de apoio (heal/shield/etc., sem nenhum dano) -> "ally";
 * 3) senão, cria parede/estrutura/área no chão -> "cell";
 * 4) senão (dano, empurrão, controle sem alvo explícito) -> "enemy".
 */
export function basicTargetV2(def: BasicDefV2): string {
  for (const e of def.effects) {
    if (typeof e.target === "string") return e.target;
  }
  const hasDamage = def.effects.some((e) => e.type === "damage");
  if (!hasDamage && def.effects.some((e) => SUPPORT_EFFECT_TYPES.has(e.type))) return "ally";
  if (def.effects.some((e) => GROUND_EFFECT_TYPES.has(e.type))) return "cell";
  return "enemy";
}

export const ALL_CHAMPION_IDS: string[] = championsV2.map((c) => c.id);
export const DANO_CHAMPION_IDS: string[] = championsV2.filter((c) => c.role === "dano").map((c) => c.id);
export const SUPORTE_CHAMPION_IDS: string[] = championsV2.filter((c) => c.role === "suporte").map((c) => c.id);
