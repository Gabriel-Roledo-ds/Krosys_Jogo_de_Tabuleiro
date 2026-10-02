// Testes de sanidade dos dados do roster v2 (ainda não ligados ao motor — ver
// regras-e-decisoes.md §19). Conferem a estrutura dos próprios arquivos JSON,
// não o comportamento do jogo: isso vem quando esses dados forem implementados.

import { describe, it, expect } from "vitest";
import championsV2 from "../data/champions_v2.json";
import cardsV2 from "../data/cards_v2.json";
import monstersMap from "../data/monsters_map.json";

describe("champions_v2.json", () => {
  it("tem os 10 campeões do roster v2 (fichas-campeoes.md)", () => {
    expect(championsV2.champions).toHaveLength(10);
    const ids = championsV2.champions.map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
  });

  it("5 de dano e 5 de suporte", () => {
    const dano = championsV2.champions.filter((c) => c.role === "dano");
    const suporte = championsV2.champions.filter((c) => c.role === "suporte");
    expect(dano).toHaveLength(5);
    expect(suporte).toHaveLength(5);
  });

  it("todo campeão tem HP, defesa, básica e passiva", () => {
    for (const c of championsV2.champions) {
      expect(c.hp, c.id).toBeGreaterThan(0);
      expect(c.defense, c.id).toBeGreaterThanOrEqual(0);
      expect(c.basic?.name, c.id).toBeTruthy();
      expect(c.passive?.name, c.id).toBeTruthy();
    }
  });

  it("HP e defesa batem com fichas-campeoes.md", () => {
    const by = (id: string) => championsV2.champions.find((c) => c.id === id)!;
    expect([by("niara").hp, by("niara").defense]).toEqual([14, 0]);
    expect([by("borak").hp, by("borak").defense]).toEqual([20, 2]);
    expect([by("varek").hp, by("varek").defense]).toEqual([22, 3]);
    expect([by("vextra").hp, by("vextra").defense]).toEqual([12, 0]);
  });

  it("Niara é a única sem sacrifício nomeado no texto original", () => {
    const comSacrificio = championsV2.champions.filter((c) => c.sacrifice !== null);
    const semSacrificio = championsV2.champions.filter((c) => c.sacrifice === null);
    expect(semSacrificio.map((c) => c.id)).toEqual(["niara"]);
    expect(comSacrificio).toHaveLength(9);
  });
});

describe("cards_v2.json", () => {
  it("120 cartas: 12 por campeão (5 regular + 5 exclusive + 2 climax)", () => {
    expect(cardsV2).toHaveLength(120);
    for (const champ of championsV2.champions) {
      const owned = cardsV2.filter((c) => c.owner === champ.id);
      expect(owned, champ.id).toHaveLength(12);
      expect(owned.filter((c) => c.rank_type === "regular"), champ.id).toHaveLength(5);
      expect(owned.filter((c) => c.rank_type === "exclusive"), champ.id).toHaveLength(5);
      expect(owned.filter((c) => c.rank_type === "climax"), champ.id).toHaveLength(2);
    }
  });

  it("ids únicos", () => {
    const ids = cardsV2.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cartas 'regular' têm rank 1/2/3; 'exclusive' só rank 2/3; 'climax' têm rank 1/2/3", () => {
    for (const c of cardsV2) {
      const ranks = c.ranks.map((r) => r.rank);
      if (c.rank_type === "regular" || c.rank_type === "climax") expect(ranks, c.id).toEqual([1, 2, 3]);
      if (c.rank_type === "exclusive") expect(ranks, c.id).toEqual([2, 3]);
    }
  });

  it("custo nunca cai de um rank pro próximo, dentro da mesma carta", () => {
    for (const c of cardsV2) {
      for (let i = 1; i < c.ranks.length; i++) {
        expect(c.ranks[i].cost, `${c.id} rank ${c.ranks[i].rank}`).toBeGreaterThanOrEqual(c.ranks[i - 1].cost);
      }
    }
  });

  it("cartas-clímax custam 13/14/15 de mana, nessa ordem", () => {
    for (const c of cardsV2.filter((x) => x.rank_type === "climax")) {
      expect(c.ranks.map((r) => r.cost), c.id).toEqual([13, 14, 15]);
    }
  });

  it("achado de design: só 3 dos 10 campeões têm carta marcada como rápida no texto original", () => {
    // fichas-campeoes.md só escreve "(rápida)" explicitamente nas cartas de Niara (2),
    // Vextra (1) e Selene (3) — Borak, Ignira, Thorne, Varek, Sylvane, Dorin e Aurelia
    // não têm nenhuma carta rápida no texto, o que contradiz a regra geral (seção 6:
    // "cada campeão tem suas próprias cartas rápidas"). Esse teste trava esse estado
        // atual dos dados; se fichas-campeoes.md for corrigido, ele deve falhar e ser
    // atualizado junto.
    const fastByChampion = new Map<string, number>();
    for (const c of cardsV2) {
      if (c.fast) fastByChampion.set(c.owner, (fastByChampion.get(c.owner) ?? 0) + 1);
    }
    expect([...fastByChampion.keys()].sort()).toEqual(["niara", "selene", "vextra"]);
    expect(fastByChampion.get("niara")).toBe(2);
    expect(fastByChampion.get("vextra")).toBe(1);
    expect(fastByChampion.get("selene")).toBe(3);
  });
});

describe("monsters_map.json carrega e bate com champions_v2/cards_v2 em escala", () => {
  it("20 tipos de criatura, nenhum reward_primary.card_id órfão nas reward_cards do próprio arquivo", () => {
    const types = Object.values(monstersMap.types) as any[];
    expect(types).toHaveLength(20);
    for (const t of types) {
      for (const reward of [t.reward_primary, t.reward_secondary]) {
        if (reward?.type === "card") {
          expect(monstersMap.reward_cards, `${t.name} -> ${reward.card_id}`).toHaveProperty(reward.card_id);
        }
      }
    }
  });
});
