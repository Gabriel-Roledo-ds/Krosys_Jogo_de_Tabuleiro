// Testes das áreas de chão do motor hexagonal (roster v2) — ground_fire e
// venom_zone em effects.ts, resolvidas por rodada em tick.ts. Ver KANBAN.md
// ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { applyEffectV2, applyGroundFire, applyVenomZone, type EffectContextV2 } from "../src/engine-v2/effects";
import { tickRoundV2 } from "../src/engine-v2/tick";
import { statusAmount } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, ctx };
}

describe("applyGroundFire", () => {
  it("cria uma área de fogo na casa-alvo, com raio/dano/duração da carta", () => {
    const { game, ctx } = setup();
    const center = { q: 7, r: 7 };
    applyEffectV2({ ...ctx, targetCell: center }, { type: "ground_fire", radius: 1, damage_per_round: 2, duration: { unit: "rounds", value: 2 } }, []);
    expect(game.ground).toHaveLength(1);
    expect(game.ground[0]).toMatchObject({ kind: "fire", pos: center, radius: 1, damagePerRound: 2, remaining: 2 });
  });

  it("renova (não duplica) uma área de fogo já existente no mesmo centro", () => {
    const { ctx, game } = setup();
    const center = { q: 7, r: 7 };
    applyGroundFire({ ...ctx, targetCell: center }, { type: "ground_fire", radius: 1, damage_per_round: 2, duration: { unit: "rounds", value: 2 } });
    applyGroundFire({ ...ctx, targetCell: center }, { type: "ground_fire", radius: 2, damage_per_round: 3, duration: { unit: "rounds", value: 3 } });
    expect(game.ground).toHaveLength(1);
    expect(game.ground[0]).toMatchObject({ radius: 2, damagePerRound: 3, remaining: 3 });
  });

  it("causa dano por rodada a quem estiver na área, ignorando defesa", () => {
    const { game, ctx } = setup();
    const victim = game.teams.B.champions[0];
    victim.defense = 10; // dano contínuo ignora defesa
    victim.pos = { q: 7, r: 7 };
    applyGroundFire({ ...ctx, targetCell: { q: 7, r: 7 } }, { type: "ground_fire", radius: 0, damage_per_round: 3, duration: { unit: "rounds", value: 2 } });
    const before = victim.hp;
    tickRoundV2(game);
    expect(victim.hp).toBe(before - 3);
  });

  it("some depois que a duração acaba", () => {
    const { game, ctx } = setup();
    applyGroundFire({ ...ctx, targetCell: { q: 7, r: 7 } }, { type: "ground_fire", radius: 0, damage_per_round: 1, duration: { unit: "rounds", value: 1 } });
    tickRoundV2(game);
    expect(game.ground).toHaveLength(0);
  });
});

describe("applyVenomZone", () => {
  it("aplica pilhas de veneno por rodada a quem estiver na área", () => {
    const { game, ctx } = setup();
    const victim = game.teams.B.champions[0];
    victim.pos = { q: 3, r: 3 };
    applyVenomZone({ ...ctx, targetCell: { q: 3, r: 3 } }, { type: "venom_zone", radius: 1, stacks_per_round: 2, duration: { unit: "rounds", value: 2 } });
    tickRoundV2(game);
    expect(statusAmount(victim, "venom_stacks")).toBe(2);
    tickRoundV2(game);
    expect(statusAmount(victim, "venom_stacks")).toBe(4);
  });

  it("não afeta quem está fora do raio", () => {
    const { game, ctx } = setup();
    const victim = game.teams.B.champions[0];
    victim.pos = { q: 3, r: 10 };
    applyVenomZone({ ...ctx, targetCell: { q: 3, r: 3 } }, { type: "venom_zone", radius: 1, stacks_per_round: 2, duration: { unit: "rounds", value: 2 } });
    tickRoundV2(game);
    expect(statusAmount(victim, "venom_stacks")).toBe(0);
  });
});
