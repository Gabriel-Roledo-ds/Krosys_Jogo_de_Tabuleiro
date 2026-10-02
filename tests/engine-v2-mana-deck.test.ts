// Testes de mana de equipe e baralho do motor hexagonal (roster v2) —
// src/engine-v2/{mana,deck}.ts. Ver KANBAN.md ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { addManaV2, canPayV2, gainTurnManaV2, spendManaV2 } from "../src/engine-v2/mana";
import { discardCardV2, drawFromV2, deckSizeV2 } from "../src/engine-v2/deck";

describe("mana de equipe (roster v2)", () => {
  it("começa em 0 e sobe +3 por turno, sem passar do teto 15", () => {
    const game = createGameV2(1);
    expect(game.teams.A.mana).toBe(0);
    gainTurnManaV2(game, "A");
    expect(game.teams.A.mana).toBe(3);
    for (let i = 0; i < 10; i++) gainTurnManaV2(game, "A");
    expect(game.teams.A.mana).toBe(15);
  });

  it("canPayV2/spendManaV2 funcionam e lançam erro sem mana suficiente", () => {
    const game = createGameV2(1);
    addManaV2(game, "A", 5);
    expect(canPayV2(game, "A", 5)).toBe(true);
    expect(canPayV2(game, "A", 6)).toBe(false);
    spendManaV2(game, "A", 5);
    expect(game.teams.A.mana).toBe(0);
    expect(() => spendManaV2(game, "A", 1)).toThrow(/insuficiente/);
  });
});

describe("baralho de campeão (roster v2)", () => {
  it("compra cartas pra mão da equipe, vindas do baralho do campeão", () => {
    const game = createGameV2(1);
    const champ = game.teams.A.champions[0];
    const before = deckSizeV2(game, champ.uid);
    const drawn = drawFromV2(game, champ.uid, 3);
    expect(drawn).toBe(3);
    expect(game.teams.A.hand).toHaveLength(3);
    expect(game.teams.A.hand.every((c) => c.owner === champ.uid)).toBe(true);
    // deckSizeV2 só conta o monte de compra + descarte (igual ao MVP) — as 3
    // que foram pra mão saem dessa conta até serem descartadas de novo.
    expect(deckSizeV2(game, champ.uid)).toBe(before - 3);
  });

  it("descartar e reembaralhar: o baralho não esgota de verdade", () => {
    const game = createGameV2(1);
    const champ = game.teams.A.champions[0];
    const total = deckSizeV2(game, champ.uid);
    // Compra tudo que existir, descarta tudo, e tenta comprar de novo.
    const firstBatch = drawFromV2(game, champ.uid, total);
    expect(firstBatch).toBe(total);
    for (const card of [...game.teams.A.hand]) discardCardV2(game, card);
    game.teams.A.hand = [];
    const secondBatch = drawFromV2(game, champ.uid, 1);
    expect(secondBatch).toBe(1); // reembaralhou o descarte e comprou de novo
    expect(deckSizeV2(game, champ.uid)).toBe(total - 1); // a 1 que comprou saiu da conta, o resto voltou pro monte
  });
});
