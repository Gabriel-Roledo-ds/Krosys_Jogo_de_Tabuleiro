// Testes de teleporte e empurrão/puxão no motor hexagonal (roster v2) —
// src/engine-v2/movement.ts. Ver KANBAN.md ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { teleportChampion, pushChampion, pullChampion, forcedMove } from "../src/engine-v2/movement";
import { hexDistance } from "../src/design/hexGrid";

describe("teleportChampion", () => {
  it("salta direto pra uma casa livre dentro da distância máxima", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const dest = { q: mover.pos.q + 2, r: mover.pos.r };
    teleportChampion(game, mover, dest, 3);
    expect(mover.pos).toEqual(dest);
  });

  it("lança erro se o destino passar da distância máxima", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const dest = { q: mover.pos.q + 5, r: mover.pos.r };
    expect(() => teleportChampion(game, mover, dest, 2)).toThrow();
  });

  it("lança erro se o destino estiver ocupado por outro campeão vivo", () => {
    const game = createGameV2(1);
    const [mover, blocker] = game.teams.A.champions;
    const dest = { q: mover.pos.q + 1, r: mover.pos.r };
    blocker.pos = { ...dest };
    expect(() => teleportChampion(game, mover, dest, 3)).toThrow();
  });

  it("ficar no lugar não faz nada (sem erro)", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const before = { ...mover.pos };
    teleportChampion(game, mover, before, 0);
    expect(mover.pos).toEqual(before);
  });
});

describe("pushChampion / pullChampion", () => {
  it("push afasta o alvo do ponto de origem", () => {
    const game = createGameV2(1);
    const origin = { q: 5, r: 5 };
    const target = game.teams.B.champions[0];
    target.pos = { q: 6, r: 5 }; // adjacente, na direção +q
    const before = hexDistance(origin, target.pos);
    pushChampion(game, target, origin, 2);
    expect(hexDistance(origin, target.pos)).toBeGreaterThan(before);
  });

  it("pull aproxima o alvo da origem, sem sobrepor", () => {
    const game = createGameV2(1);
    const origin = { q: 5, r: 5 };
    const target = game.teams.B.champions[0];
    target.pos = { q: 8, r: 5 };
    pullChampion(game, target, origin, 5); // pede mais do que cabe
    expect(target.pos).not.toEqual(origin); // nunca sobrepõe a origem
    expect(hexDistance(origin, target.pos)).toBe(1);
  });

  it("push para antes de sair do tabuleiro ou bater em outro campeão", () => {
    const game = createGameV2(1);
    const origin = { q: 0, r: 0 };
    const [target, blocker] = game.teams.A.champions;
    target.pos = { q: 1, r: 0 };
    blocker.pos = { q: 3, r: 0 }; // bloqueia o caminho do empurrão
    const moved = pushChampion(game, target, origin, 5);
    expect(moved).toBeLessThan(5);
    expect(target.pos).not.toEqual(blocker.pos);
  });
});

describe("forcedMove", () => {
  it("devolve quantas casas de fato andou, respeitando limites do tabuleiro", () => {
    const game = createGameV2(1);
    const mover = game.teams.A.champions[0];
    const moved = forcedMove(game, mover, { q: -1, r: 0 }, 50); // sai do tabuleiro rápido
    expect(moved).toBeLessThan(50);
    expect(moved).toBeGreaterThanOrEqual(0);
  });
});
