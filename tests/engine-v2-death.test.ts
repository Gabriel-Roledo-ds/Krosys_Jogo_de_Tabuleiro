// Testes de morte, retorno e vitória do motor hexagonal (roster v2) —
// src/engine-v2/death.ts. Ver KANBAN.md ("Construir motor hexagonal").
// Escopo: sem boss v2 ainda, toda morte aqui é temporária (ver nota no topo
// de death.ts).

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { killChampionV2, returnDeadChampionsV2, resolveDeathsV2, checkEliminationV2 } from "../src/engine-v2/death";
import { startAreaCells } from "../src/design/hexBoard";
import { addStatus } from "../src/engine-v2/status";

describe("killChampionV2", () => {
  it("zera vida/escudo/status e guarda a mão do campeão morto", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    c.shield = 5;
    addStatus(c, nextIdV2(game), "damage_buff", "rounds", 2, { amount: 1 });
    game.teams.A.hand.push({ uid: "card#1", cardId: "niara_tiro_certeiro", owner: c.uid });
    game.teams.A.hand.push({ uid: "card#2", cardId: "niara_bencao", owner: game.teams.A.champions[1].uid });
    killChampionV2(game, c);
    expect(c.alive).toBe(false);
    expect(c.hp).toBe(0);
    expect(c.shield).toBe(0);
    expect(c.statuses).toHaveLength(0);
    expect(c.deaths).toBe(1);
    expect(c.outTurns).toBeGreaterThan(0);
    expect(c.limbo).toHaveLength(1);
    expect(c.limbo[0].uid).toBe("card#1");
    // A mão da equipe só perde a carta do morto, a do outro campeão fica.
    expect(game.teams.A.hand.map((card) => card.uid)).toEqual(["card#2"]);
  });

  it("a segunda morte custa mais turnos fora do que a primeira", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    killChampionV2(game, c);
    const firstOut = c.outTurns;
    c.alive = true; // simula o retorno sem esperar os turnos, só pra testar a segunda morte
    killChampionV2(game, c);
    expect(c.outTurns).toBeGreaterThan(firstOut);
  });
});

describe("returnDeadChampionsV2", () => {
  it("não volta antes de outTurns chegar a 0", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    killChampionV2(game, c);
    const startCells = startAreaCells("equipe_a", game.board);
    while (c.outTurns > 0) {
      returnDeadChampionsV2(game, "A", startCells);
      expect(c.alive).toBe(false);
    }
    returnDeadChampionsV2(game, "A", startCells);
    expect(c.alive).toBe(true);
    expect(c.hp).toBe(c.maxHp);
    expect(c.untargetable).toBe(true);
  });

  it("devolve a mão guardada pro baralho do campeão ao voltar", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    const deckBefore = game.teams.A.decks[c.uid].draw.length;
    game.teams.A.hand.push({ uid: "card#1", cardId: "niara_tiro_certeiro", owner: c.uid });
    killChampionV2(game, c);
    const startCells = startAreaCells("equipe_a", game.board);
    const callsNeeded = c.outTurns + 1; // outTurns muda a cada chamada — captura o valor inicial antes do laço
    for (let i = 0; i < callsNeeded; i++) returnDeadChampionsV2(game, "A", startCells);
    expect(game.teams.A.decks[c.uid].draw.length).toBe(deckBefore + 1);
    expect(c.limbo).toHaveLength(0);
  });
});

describe("resolveDeathsV2 / checkEliminationV2", () => {
  it("mata quem está com hp <= 0 depois de dano", () => {
    const game = createGameV2(1);
    const c = game.teams.B.champions[0];
    c.hp = 0;
    resolveDeathsV2(game, "A");
    expect(c.alive).toBe(false);
  });

  it("declara vencedor quando uma equipe inteira cai de uma vez", () => {
    const game = createGameV2(1);
    for (const c of game.teams.B.champions) c.alive = false;
    checkEliminationV2(game, "A");
    expect(game.winner).toBe("A");
  });

  it("empate duplo (as duas equipes caem juntas) favorece quem o chamador indicar", () => {
    const game = createGameV2(1);
    for (const c of [...game.teams.A.champions, ...game.teams.B.champions]) c.alive = false;
    checkEliminationV2(game, "B");
    expect(game.winner).toBe("B");
  });

  it("não sobrescreve um vencedor já definido", () => {
    const game = createGameV2(1);
    game.winner = "A";
    for (const c of game.teams.A.champions) c.alive = false;
    checkEliminationV2(game, "B");
    expect(game.winner).toBe("A");
  });
});
