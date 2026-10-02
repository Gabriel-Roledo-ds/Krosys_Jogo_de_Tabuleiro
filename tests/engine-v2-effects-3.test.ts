// Testes da terceira leva de efeitos do motor hexagonal (roster v2) —
// resolução de alvo "ao redor de si" (around_self/area_radius), dano próprio
// (self_damage) e "todo inimigo no alcance" (all_enemies_in_range/
// all_poisoned_enemies). Ver KANBAN.md.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import {
  applyDamage,
  applySelfDamage,
  applyStatusAroundSelf,
  applyPush,
  applyVenomStacks,
  applyDetonateVenomStacks,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { hasStatus, statusAmount } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, ctx };
}

describe("damage com around_self", () => {
  it("acerta todo mundo no raio ao redor do atacante, aliado incluso (fogo amigo)", () => {
    const { game, attacker, ctx } = setup();
    const ally = game.teams.A.champions[1];
    const enemy = game.teams.B.champions[0];
    ally.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    enemy.pos = { q: attacker.pos.q - 1, r: attacker.pos.r };
    const far = game.teams.B.champions[1];
    far.pos = { q: attacker.pos.q + 10, r: attacker.pos.r };
    const [allyBefore, enemyBefore, farBefore] = [ally.hp, enemy.hp, far.hp];
    applyDamage(ctx, { type: "damage", around_self: true, radius: 1, amount: 3, ignore_defense: true }, []);
    expect(ally.hp).toBeLessThan(allyBefore);
    expect(enemy.hp).toBeLessThan(enemyBefore);
    expect(far.hp).toBe(farBefore); // longe demais, não é afetado
  });

  it("não acerta o próprio atacante", () => {
    const { attacker, ctx } = setup();
    const before = attacker.hp;
    applyDamage(ctx, { type: "damage", around_self: true, radius: 3, amount: 5, ignore_defense: true }, []);
    expect(attacker.hp).toBe(before);
  });
});

describe("applySelfDamage", () => {
  it("o próprio atacante perde vida, ignorando defesa e escudo", () => {
    const { attacker, ctx } = setup();
    attacker.defense = 99;
    attacker.shield = 99;
    const before = attacker.hp;
    const dealt = applySelfDamage(ctx, { type: "self_damage", amount: 3 });
    expect(dealt).toBe(3);
    expect(attacker.hp).toBe(before - 3);
    expect(attacker.shield).toBe(99); // não passou pelo escudo
  });
});

describe("apply_status_around_self", () => {
  it("aplica o status em todo mundo no raio ao redor do atacante", () => {
    const { game, attacker, ctx } = setup();
    const nearby = game.teams.B.champions[0];
    nearby.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    applyStatusAroundSelf(ctx, { type: "apply_status_around_self", radius: 1, status: "movement_reduced", amount: 2, duration: { unit: "champion_turns", value: 1 } });
    expect(hasStatus(nearby, "movement_reduced")).toBe(true);
    expect(statusAmount(nearby, "movement_reduced")).toBe(2);
  });
});

describe("push com area_radius", () => {
  it("empurra todo mundo ao redor de si, ignorando o `targets` passado", () => {
    const { game, attacker, ctx } = setup();
    const nearby = game.teams.B.champions[0];
    nearby.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    const before = { ...nearby.pos };
    applyPush(ctx, { type: "push", area_radius: 1, distance: 2 }, []);
    expect(nearby.pos).not.toEqual(before);
  });
});

describe("apply_venom_stacks / detonate_venom_stacks com *_in_range", () => {
  it("all_enemies_in_range aplica pilhas em todo inimigo dentro de rangeForAll", () => {
    const { game, attacker, ctx } = setup();
    const near = game.teams.B.champions[0];
    const far = game.teams.B.champions[1];
    near.pos = { q: attacker.pos.q + 2, r: attacker.pos.r };
    far.pos = { q: attacker.pos.q + 10, r: attacker.pos.r };
    applyVenomStacks({ ...ctx, rangeForAll: 5 }, { type: "apply_venom_stacks", amount: 2, all_enemies_in_range: true }, []);
    expect(statusAmount(near, "venom_stacks")).toBe(2);
    expect(statusAmount(far, "venom_stacks")).toBe(0);
  });

  it("all_poisoned_enemies detona só quem já tinha pilhas", () => {
    const { game, attacker, ctx } = setup();
    const poisoned = game.teams.B.champions[0];
    const clean = game.teams.B.champions[1];
    poisoned.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    clean.pos = { q: attacker.pos.q + 2, r: attacker.pos.r };
    applyVenomStacks(ctx, { type: "apply_venom_stacks", amount: 3 }, [poisoned]);
    const [beforePoisoned, beforeClean] = [poisoned.hp, clean.hp];
    applyDetonateVenomStacks({ ...ctx, rangeForAll: 5 }, { type: "detonate_venom_stacks", damage_per_stack: 2, all_poisoned_enemies: true }, []);
    expect(poisoned.hp).toBeLessThan(beforePoisoned);
    expect(clean.hp).toBe(beforeClean);
  });
});
