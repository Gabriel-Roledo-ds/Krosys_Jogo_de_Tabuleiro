// Testes da segunda leva de efeitos do motor hexagonal (roster v2) —
// push/pull, move_self/teleport_self, veneno e elo. Ver KANBAN.md.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import {
  applyEffectV2,
  applyVenomStacks,
  applyDetonateVenomStacks,
  applyLink,
  linkedPartnerOf,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { hexDistance } from "../src/design/hexGrid";
import { statusAmount, hasStatus } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const target = game.teams.B.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, target, ctx };
}

describe("push / pull via applyEffectV2", () => {
  it("push afasta o alvo do atacante", () => {
    const { attacker, target, ctx } = setup();
    target.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    const before = hexDistance(attacker.pos, target.pos);
    applyEffectV2(ctx, { type: "push", distance: 2 }, [target]);
    expect(hexDistance(attacker.pos, target.pos)).toBeGreaterThan(before);
  });

  it("pull aproxima o alvo do atacante", () => {
    const { attacker, target, ctx } = setup();
    target.pos = { q: attacker.pos.q + 4, r: attacker.pos.r };
    const before = hexDistance(attacker.pos, target.pos);
    applyEffectV2(ctx, { type: "pull", distance: 2 }, [target]);
    expect(hexDistance(attacker.pos, target.pos)).toBeLessThan(before);
  });
});

describe("move_self / teleport_self via applyEffectV2", () => {
  it("move_self com moveDest salta pra uma casa livre a até `distance`", () => {
    const { attacker, ctx } = setup();
    const dest = { q: attacker.pos.q + 2, r: attacker.pos.r };
    applyEffectV2({ ...ctx, moveDest: dest }, { type: "move_self", distance: 3 }, [attacker]);
    expect(attacker.pos).toEqual(dest);
  });

  it("move_self com moveDir avança em linha, respeitando obstáculo", () => {
    const { game, attacker, ctx } = setup();
    const blocker = game.teams.A.champions[1];
    blocker.pos = { q: attacker.pos.q + 2, r: attacker.pos.r };
    applyEffectV2({ ...ctx, moveDir: { q: 1, r: 0 } }, { type: "move_self", distance: 5 }, [attacker]);
    expect(attacker.pos).not.toEqual(blocker.pos);
    expect(attacker.pos.q).toBeLessThan(blocker.pos.q);
  });

  it("teleport_self usa moveDest sem limite de distância próprio", () => {
    const { attacker, ctx } = setup();
    const dest = { q: attacker.pos.q + 4, r: attacker.pos.r };
    applyEffectV2({ ...ctx, moveDest: dest }, { type: "teleport_self" }, [attacker]);
    expect(attacker.pos).toEqual(dest);
  });
});

describe("apply_venom_stacks / detonate_venom_stacks", () => {
  it("acumula pilhas até max_stacks", () => {
    const { target, ctx } = setup();
    applyVenomStacks(ctx, { type: "apply_venom_stacks", amount: 2, max_stacks: 5 }, [target]);
    applyVenomStacks(ctx, { type: "apply_venom_stacks", amount: 2, max_stacks: 5 }, [target]);
    expect(statusAmount(target, "venom_stacks")).toBe(4);
    applyVenomStacks(ctx, { type: "apply_venom_stacks", amount: 2, max_stacks: 5 }, [target]);
    expect(statusAmount(target, "venom_stacks")).toBe(5); // capado
  });

  it("detona as pilhas, causa dano proporcional e zera", () => {
    const { target, ctx } = setup();
    applyVenomStacks(ctx, { type: "apply_venom_stacks", amount: 4 }, [target]);
    const before = target.hp;
    const out = applyDetonateVenomStacks(ctx, { type: "detonate_venom_stacks", damage_per_stack: 2 }, [target]);
    expect(out[target.uid]).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(before);
    expect(hasStatus(target, "venom_stacks")).toBe(false);
  });

  it("detonar sem pilhas não causa dano", () => {
    const { target, ctx } = setup();
    const out = applyDetonateVenomStacks(ctx, { type: "detonate_venom_stacks", damage_per_stack: 2 }, [target]);
    expect(out[target.uid]).toBe(0);
  });
});

describe("link", () => {
  it("cria o vínculo nos dois lados, com o uid do parceiro certo", () => {
    const { attacker, target, ctx } = setup();
    applyLink(ctx, { type: "link", share_heal_percent: 50, duration: { unit: "rounds", value: 2 } }, [target]);
    expect(linkedPartnerOf(attacker)).toBe(target.uid);
    expect(linkedPartnerOf(target)).toBe(attacker.uid);
  });
});
