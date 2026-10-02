// Testes do estado inicial do motor hexagonal (roster v2) — src/engine-v2/state.ts.
// Design/engine em construção — ver KANBAN.md ("Construir motor hexagonal").
// Não é o jogo jogável ainda; o MVP (src/engine/) continua sendo o motor em produção.

import { describe, it, expect } from "vitest";
import { createGameV2, allChampionsV2, TEAM_IDS } from "../src/engine-v2/state";
import { startAreaCells } from "../src/design/hexBoard";
import { hexKey } from "../src/design/hexGrid";
import { deckCardIdsV2, cardsOf, copiesForRankType } from "../src/engine-v2/data";

describe("createGameV2", () => {
  it("cria as duas equipes com 3 campeões cada", () => {
    const game = createGameV2(1);
    for (const teamId of TEAM_IDS) {
      expect(game.teams[teamId].champions).toHaveLength(3);
    }
  });

  it("cada campeão começa na área de largada da própria equipe", () => {
    const game = createGameV2(1);
    const startA = new Set(startAreaCells("equipe_a").map(hexKey));
    const startB = new Set(startAreaCells("equipe_b").map(hexKey));
    for (const c of game.teams.A.champions) {
      expect(startA.has(hexKey(c.pos)), c.uid).toBe(true);
    }
    for (const c of game.teams.B.champions) {
      expect(startB.has(hexKey(c.pos)), c.uid).toBe(true);
    }
  });

  it("todos os campeões começam vivos, com hp cheio e sem mana pessoal", () => {
    const game = createGameV2(1);
    for (const c of allChampionsV2(game)) {
      expect(c.alive).toBe(true);
      expect(c.hp).toBe(c.maxHp);
      expect(c.personalMana).toBe(0);
    }
  });

  it("cada campeão tem um baralho de 30 cartas (27 de combate + 3 poções)", () => {
    const game = createGameV2(1);
    for (const c of allChampionsV2(game)) {
      const deck = game.teams[c.team].decks[c.uid];
      expect(deck.draw, c.uid).toHaveLength(30);
      expect(deck.discard).toHaveLength(0);
    }
  });

  it("mesma seed gera o mesmo baralho embaralhado (reproduzível)", () => {
    const a = createGameV2(42);
    const b = createGameV2(42);
    expect(a.teams.A.decks["A-niara"].draw.map((c) => c.cardId)).toEqual(
      b.teams.A.decks["A-niara"].draw.map((c) => c.cardId),
    );
  });

  it("seeds diferentes tendem a embaralhar diferente", () => {
    const a = createGameV2(1);
    const b = createGameV2(2);
    expect(a.teams.A.decks["A-niara"].draw.map((c) => c.cardId)).not.toEqual(
      b.teams.A.decks["A-niara"].draw.map((c) => c.cardId),
    );
  });
});

describe("deckCardIdsV2", () => {
  it("27 cartas de combate: 5 regular x3 + 5 exclusive x2 + 2 climax x1", () => {
    const ids = deckCardIdsV2("niara", ["life", "life", "mana"]);
    const combatIds = ids.filter((id) => !id.startsWith("potion_"));
    expect(combatIds).toHaveLength(27);
  });

  it("inclui exatamente as 3 poções escolhidas", () => {
    const ids = deckCardIdsV2("niara", ["life", "mana", "mana"]);
    const potions = ids.filter((id) => id.startsWith("potion_"));
    expect(potions).toEqual(["potion_life", "potion_mana", "potion_mana"]);
  });

  it("cada carta de niara aparece o número certo de cópias", () => {
    const ids = deckCardIdsV2("niara", ["life", "life", "mana"]);
    for (const card of cardsOf("niara")) {
      const count = ids.filter((id) => id === card.id).length;
      expect(count, card.id).toBe(copiesForRankType(card.rank_type));
    }
  });

  it("recusa escolha de poções com tamanho errado", () => {
    expect(() => deckCardIdsV2("niara", ["life"])).toThrow();
  });
});
