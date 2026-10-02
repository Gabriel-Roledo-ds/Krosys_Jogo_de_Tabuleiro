// Testes do movimento no tabuleiro hexagonal (roster v2) — src/engine-v2/movement.ts.
// Ver KANBAN.md ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { calcMovement, moveChampion, reachableCells, movePath, rollMovementDie } from "../src/engine-v2/movement";
import { hexDistance } from "../src/design/hexGrid";

describe("rollMovementDie / calcMovement", () => {
  it("o dado sempre cai entre 1 e 6 (d6)", () => {
    const game = createGameV2(1);
    for (let i = 0; i < 50; i++) {
      const die = rollMovementDie(game);
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(6);
    }
  });

  it("calcMovement soma bônus e subtrai penalidade, com mínimo 0", () => {
    expect(calcMovement(3)).toBe(3);
    expect(calcMovement(3, 2)).toBe(5);
    expect(calcMovement(3, 0, 5)).toBe(0);
  });
});

describe("reachableCells", () => {
  it("todas as casas alcançáveis estão a no máximo `steps` de distância hexagonal", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const steps = 3;
    for (const cell of reachableCells(game, mover, steps)) {
      expect(hexDistance(mover.pos, cell)).toBeLessThanOrEqual(steps);
    }
  });

  it("com 0 passos, não há casas alcançáveis pra parar (só a própria, que não conta)", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    expect(reachableCells(game, mover, 0)).toHaveLength(0);
  });

  it("não inclui casas ocupadas por outro campeão vivo", () => {
    const game = createGameV2(1);
    const [mover, blocker] = game.teams.A.champions;
    blocker.pos = { q: mover.pos.q + 1, r: mover.pos.r };
    const cells = reachableCells(game, mover, 3);
    expect(cells.some((c) => c.q === blocker.pos.q && c.r === blocker.pos.r)).toBe(false);
  });
});

describe("moveChampion", () => {
  it("move o campeão pra uma casa alcançável e devolve o custo", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const dest = reachableCells(game, mover, 3)[0];
    const cost = moveChampion(game, mover, dest, 3);
    expect(mover.pos).toEqual(dest);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(3);
  });

  it("andar 0 casas é permitido (fica no lugar)", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const before = { ...mover.pos };
    expect(moveChampion(game, mover, before, 3)).toBe(0);
    expect(mover.pos).toEqual(before);
  });

  it("lança erro se o destino não for alcançável", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const farAway = { q: mover.pos.q + 50, r: mover.pos.r };
    expect(() => moveChampion(game, mover, farAway, 3)).toThrow();
  });
});

describe("movePath", () => {
  it("o caminho até um destino alcançável tem o mesmo tamanho do custo", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const dest = reachableCells(game, mover, 2).find((c) => hexDistance(mover.pos, c) === 2)!;
    const path = movePath(game, mover, dest, 2);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(dest);
  });

  it("devolve null pra um destino fora do orçamento", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const farAway = { q: mover.pos.q + 50, r: mover.pos.r };
    expect(movePath(game, mover, farAway, 3)).toBeNull();
  });
});
