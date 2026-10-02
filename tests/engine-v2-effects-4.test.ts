// Testes da quarta leva de efeitos do motor hexagonal (roster v2) —
// reflexo (fixo e proporcional), extensão de controle existente, provocação
// em área, bloqueio de ataque à distância e cúpula protetora. Ver KANBAN.md.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import {
  applyDamage,
  applyShield,
  applyReflectAbsorbedDamage,
  applyExtendExistingControl,
  applyTauntArea,
  applyBlockRangedAttacks,
  applyProtectiveDome,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { addStatus, hasStatus } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const target = game.teams.B.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, target, ctx };
}

describe("applyDamage devolve o reflexo fixo (reflect_amount do escudo)", () => {
  it("quem causou o dano absorvido pelo escudo sofre o reflexo de volta", () => {
    const { attacker, target, ctx } = setup();
    applyShield({ type: "shield", amount: 5, reflect_amount: 3 }, [target]);
    const before = attacker.hp;
    applyDamage(ctx, { type: "damage", amount: 4, ignore_defense: true }, [target]);
    expect(attacker.hp).toBe(before - 3);
  });
});

describe("reflect_absorbed_damage (reflexo proporcional)", () => {
  it("reflete uma fração do dano absorvido pelo escudo, não um valor fixo", () => {
    const { attacker, target, ctx } = setup();
    applyShield({ type: "shield", amount: 10 }, [target]);
    applyReflectAbsorbedDamage({ ...ctx, attacker: target }, { type: "reflect_absorbed_damage", percent: 50 });
    const before = attacker.hp;
    applyDamage(ctx, { type: "damage", amount: 8, ignore_defense: true }, [target]); // absorve 8, reflete 50% = 4
    expect(attacker.hp).toBe(before - 4);
  });

  it("some quando o escudo zera", () => {
    const { attacker, target, ctx } = setup();
    applyShield({ type: "shield", amount: 5 }, [target]);
    applyReflectAbsorbedDamage({ ...ctx, attacker: target }, { type: "reflect_absorbed_damage", percent: 100 });
    applyDamage(ctx, { type: "damage", amount: 5, ignore_defense: true }, [target]); // zera o escudo
    const before = attacker.hp;
    applyDamage(ctx, { type: "damage", amount: 3, ignore_defense: true }, [target]); // sem escudo, sem reflexo
    expect(attacker.hp).toBe(before); // nada reflete de volta, o dano foi todo no target
  });
});

describe("extend_existing_control", () => {
  it("soma duração a um controle já ativo, sem aplicar nada novo", () => {
    const { target, ctx } = setup();
    addStatus(target, ctx.nextId(), "root", "champion_turns", 1, { negative: true });
    applyExtendExistingControl(ctx, { type: "extend_existing_control", duration: { unit: "champion_turns", value: 2 } }, [target]);
    expect(target.statuses.find((s) => s.status === "root")?.remaining).toBe(3);
  });

  it("sem controle ativo, não faz nada (nenhum status novo)", () => {
    const { target, ctx } = setup();
    const before = target.statuses.length;
    applyExtendExistingControl(ctx, { type: "extend_existing_control", duration: { unit: "champion_turns", value: 2 } }, [target]);
    expect(target.statuses.length).toBe(before);
  });
});

describe("taunt_area", () => {
  it("provoca inimigos ao redor de quem usou a carta, não aliados", () => {
    const { game, attacker, ctx } = setup();
    const enemy = game.teams.B.champions[0];
    const ally = game.teams.A.champions[1];
    enemy.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    ally.pos = { q: attacker.pos.q - 1, r: attacker.pos.r };
    applyTauntArea(ctx, { type: "taunt_area", radius: 1, duration: { unit: "champion_turns", value: 1 } });
    expect(hasStatus(enemy, "taunted")).toBe(true);
    expect(hasStatus(ally, "taunted")).toBe(false);
  });
});

describe("block_ranged_attacks / protective_dome", () => {
  it("registra o status no próprio dono da carta", () => {
    const { attacker, ctx } = setup();
    applyBlockRangedAttacks(ctx, { type: "block_ranged_attacks", duration: { unit: "champion_turns", value: 1 } });
    expect(hasStatus(attacker, "block_ranged_attacks")).toBe(true);
  });

  it("registra o status no(s) alvo(s) escolhido(s)", () => {
    const { target, ctx } = setup();
    applyProtectiveDome(ctx, { type: "protective_dome", duration: { unit: "rounds", value: 2 } }, [target]);
    expect(hasStatus(target, "protective_dome")).toBe(true);
  });
});
