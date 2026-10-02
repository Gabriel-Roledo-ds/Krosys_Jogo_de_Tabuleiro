// Testes de passagem de tempo do motor hexagonal (roster v2) — src/engine-v2/tick.ts.
// tickRoundV2 (fim de rodada: cura DoT, decrementa status de "rounds", mantém
// venom_stacks intacto) e expireChampionTurnStatuses (status "champion_turns"
// aplicados no próprio turno só valem a partir do próximo, via flag `fresh`).

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { tickRoundV2, expireChampionTurnStatuses } from "../src/engine-v2/tick";
import { addStatus, hasStatus, statusAmount } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const target = game.teams.B.champions[0];
  return { game, target };
}

describe("tickRoundV2", () => {
  it("aplica a cura de heal_over_time e decrementa a duração", () => {
    const { game, target } = setup();
    target.hp = target.maxHp - 10;
    addStatus(target, nextIdV2(game), "heal_over_time", "rounds", 2, { amount: 3 });
    tickRoundV2(game);
    expect(target.hp).toBe(target.maxHp - 7);
    expect(target.statuses.find((s) => s.status === "heal_over_time")?.remaining).toBe(1);
  });

  it("remove status de rounds quando a duração chega a 0", () => {
    const { game, target } = setup();
    addStatus(target, nextIdV2(game), "damage_buff", "rounds", 1, { amount: 2 });
    tickRoundV2(game);
    expect(hasStatus(target, "damage_buff")).toBe(false);
  });

  it("não decrementa nem remove venom_stacks (persiste até ser detonado)", () => {
    const { game, target } = setup();
    addStatus(target, nextIdV2(game), "venom_stacks", "rounds", 999, { amount: 4, negative: true });
    tickRoundV2(game);
    tickRoundV2(game);
    expect(statusAmount(target, "venom_stacks")).toBe(4);
    expect(hasStatus(target, "venom_stacks")).toBe(true);
  });

  it("ignora campeões mortos", () => {
    const { game, target } = setup();
    target.alive = false;
    target.hp = 0;
    addStatus(target, nextIdV2(game), "heal_over_time", "rounds", 2, { amount: 5 });
    tickRoundV2(game);
    expect(target.hp).toBe(0);
  });

  it("não afeta status de champion_turns", () => {
    const { game, target } = setup();
    addStatus(target, nextIdV2(game), "stun", "champion_turns", 1, { negative: true });
    tickRoundV2(game);
    expect(target.statuses.find((s) => s.status === "stun")?.remaining).toBe(1);
  });
});

describe("expireChampionTurnStatuses", () => {
  it("mantém um status 'fresh' no turno em que foi aplicado, consumindo a flag", () => {
    const { target } = setup();
    addStatus(target, 1, "silenced", "champion_turns", 1, { negative: true });
    target.statuses[0].fresh = true;
    expireChampionTurnStatuses(target);
    expect(hasStatus(target, "silenced")).toBe(true);
    expect(target.statuses[0].fresh).toBe(false);
  });

  it("remove um status de champion_turns não-fresh (já passou pelo turno)", () => {
    const { target } = setup();
    addStatus(target, 1, "silenced", "champion_turns", 1, { negative: true });
    expireChampionTurnStatuses(target);
    expect(hasStatus(target, "silenced")).toBe(false);
  });

  it("não toca em status de rounds", () => {
    const { target } = setup();
    addStatus(target, 1, "damage_buff", "rounds", 2, { amount: 1 });
    expireChampionTurnStatuses(target);
    expect(hasStatus(target, "damage_buff")).toBe(true);
  });
});
