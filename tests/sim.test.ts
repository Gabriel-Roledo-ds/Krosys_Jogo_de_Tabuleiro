import { describe, it, expect } from "vitest";
import { runGame, report } from "../src/sim/run";
import { createGame } from "../src/engine/state";
import { applyAction, startGame } from "../src/engine/turn";
import { randomBot } from "../src/bots/random";
import { createRng } from "../src/engine/rng";

describe("partidas simuladas", () => {
  it("bot guloso contra bot guloso termina uma partida completa sem erro", () => {
    const r = runGame(2, "guloso");
    expect(r.error).toBeUndefined();
    expect(r.winner).not.toBeNull();
    expect(r.actions).toBeGreaterThan(50);
  }, 120000);

  it("a mesma seed repete a mesma partida", () => {
    const a = runGame(4, "guloso");
    const b = runGame(4, "guloso");
    expect([a.winner, a.rounds, a.actions]).toEqual([b.winner, b.rounds, b.actions]);
  }, 120000);

  it("bot aleatório joga milhares de ações sem quebrar o motor", () => {
    for (const seed of [1, 2, 3]) {
      const s = createGame({ A: ["enredador", "piromante", "atirador"], B: ["arquiteto", "andarilho", "curandeiro"] }, seed);
      const bot = randomBot(createRng(seed));
      startGame(s);
      for (let i = 0; i < 4000 && !s.winner; i++) {
        const team = s.pending ? s.pending.priority : s.turn.team;
        applyAction(s, team, bot(s, team));
      }
      expect(s.winner !== null || s.round > 10).toBe(true);
    }
  }, 120000);

  it("relatório resume vitórias e cartas nunca jogadas", () => {
    const text = report([runGame(2, "guloso")]);
    expect(text).toMatch(/Partidas: 1/);
    expect(text).toMatch(/nunca jogadas/);
  }, 120000);
});
