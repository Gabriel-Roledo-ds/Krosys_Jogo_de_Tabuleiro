// Testes da quinta leva de efeitos do motor hexagonal (roster v2) — os que
// reaproveitam dano/movimento em linha: move_in_line, damage_first_in_path,
// damage_pierce_line, damage_behind_target, damage_second/third_target
// (ricochete), gap_close_strike e buff_next_card. Ver KANBAN.md.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { hexDistance } from "../src/design/hexGrid";
import {
  applyMoveInLine,
  applyDamageFirstInPath,
  applyDamagePierceLine,
  applyDamageBehindTarget,
  applyDamage,
  applyDamageSecondTarget,
  applyDamageThirdTarget,
  applyGapCloseStrike,
  applyBuffNextCard,
  type EffectContextV2,
} from "../src/engine-v2/effects";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, ctx };
}

describe("move_in_line", () => {
  it("avança na direção escolhida, parando antes de obstáculo", () => {
    const { game, attacker, ctx } = setup();
    const blocker = game.teams.B.champions[0];
    blocker.pos = { q: attacker.pos.q + 3, r: attacker.pos.r };
    applyMoveInLine({ ...ctx, moveDir: { q: 1, r: 0 } }, { type: "move_in_line", distance: 10 });
    expect(attacker.pos.q).toBe(blocker.pos.q - 1);
  });
});

describe("damage_first_in_path", () => {
  it("acerta o primeiro campeão na direção, empurra se push_distance estiver presente", () => {
    const { game, attacker, ctx } = setup();
    const first = game.teams.B.champions[0];
    const behind = game.teams.B.champions[1];
    first.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    behind.pos = { q: attacker.pos.q + 5, r: attacker.pos.r };
    const before = first.hp;
    const beforePos = { ...first.pos };
    const out = applyDamageFirstInPath({ ...ctx, moveDir: { q: 1, r: 0 } }, { type: "damage_first_in_path", amount: 5, push_distance: 1 });
    expect(out[first.uid]).toBeGreaterThan(0);
    expect(first.hp).toBeLessThan(before);
    expect(first.pos).not.toEqual(beforePos); // empurrado
    expect(behind.hp).toBe(behind.maxHp); // não foi atingido, era o segundo no caminho
  });

  it("sem ninguém no caminho, não faz nada", () => {
    const { ctx } = setup();
    const out = applyDamageFirstInPath({ ...ctx, moveDir: { q: 1, r: 0 } }, { type: "damage_first_in_path", amount: 5 });
    expect(out).toEqual({});
  });
});

describe("damage_pierce_line", () => {
  it("acerta até `targets` campeões em linha a partir de quem usou a carta", () => {
    const { game, attacker, ctx } = setup();
    const [e1, e2, e3] = game.teams.B.champions;
    e1.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    e2.pos = { q: attacker.pos.q + 2, r: attacker.pos.r };
    e3.pos = { q: attacker.pos.q + 3, r: attacker.pos.r };
    const out = applyDamagePierceLine(ctx, { type: "damage_pierce_line", amount: 4, targets: 2 }, [e1]);
    expect(Object.keys(out)).toHaveLength(2);
    expect(out[e1.uid]).toBeGreaterThan(0);
    expect(out[e2.uid]).toBeGreaterThan(0);
    expect(out[e3.uid]).toBeUndefined(); // só os 2 primeiros, mesmo tendo um 3º na linha
  });
});

describe("damage_behind_target", () => {
  it("acerta quem está bem atrás do alvo escolhido, na mesma linha", () => {
    const { game, attacker, ctx } = setup();
    const front = game.teams.B.champions[0];
    const behind = game.teams.B.champions[1];
    front.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    behind.pos = { q: attacker.pos.q + 2, r: attacker.pos.r };
    const out = applyDamageBehindTarget(ctx, { type: "damage_behind_target", amount: 10 }, [front]);
    expect(out[behind.uid]).toBeGreaterThan(0);
  });

  it("sem ninguém atrás, não faz nada", () => {
    const { game, attacker, ctx } = setup();
    const front = game.teams.B.champions[0];
    front.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    const out = applyDamageBehindTarget(ctx, { type: "damage_behind_target", amount: 10 }, [front]);
    expect(out).toEqual({});
  });
});

describe("damage_second_target / damage_third_target (Ricochete)", () => {
  it("encadeia a partir do último alvo atingido pelo bloco damage anterior", () => {
    const { game, attacker, ctx } = setup();
    const first = game.teams.B.champions[0];
    const second = game.teams.B.champions[1];
    first.pos = { q: attacker.pos.q + 4, r: attacker.pos.r };
    second.pos = { q: first.pos.q + 1, r: first.pos.r }; // perto do primeiro, não do atacante
    applyDamage(ctx, { type: "damage", amount: 3 }, [first]); // grava ctx.lastTarget = first
    const out = applyDamageSecondTarget(ctx, { type: "damage_second_target", amount: 3, max_distance_from_first: 4 });
    expect(out[second.uid]).toBeGreaterThan(0);
    expect(ctx.lastTarget?.uid).toBe(second.uid); // encadeado pro 3º alvo
  });

  it("sem alvo anterior (ctx.lastTarget vazio), não faz nada", () => {
    const { ctx } = setup();
    const out = applyDamageSecondTarget(ctx, { type: "damage_second_target", amount: 3, max_distance_from_first: 4 });
    expect(out).toEqual({});
  });

  it("damage_third_target encadeia a partir do segundo alvo", () => {
    const { game, attacker, ctx } = setup();
    const first = game.teams.B.champions[0];
    const second = game.teams.A.champions[1]; // fogo amigo também conta
    const third = game.teams.B.champions[1];
    first.pos = { q: attacker.pos.q + 4, r: attacker.pos.r };
    second.pos = { q: first.pos.q + 1, r: first.pos.r };
    third.pos = { q: second.pos.q + 1, r: second.pos.r };
    applyDamage(ctx, { type: "damage", amount: 3 }, [first]);
    applyDamageSecondTarget(ctx, { type: "damage_second_target", amount: 3, max_distance_from_first: 4 });
    const out = applyDamageThirdTarget(ctx, { type: "damage_third_target", amount: 3, max_distance_from_second: 4 });
    expect(out[third.uid]).toBeGreaterThan(0);
  });
});

describe("gap_close_strike", () => {
  it("teleporta quem usou a carta pra uma casa livre ao lado do alvo", () => {
    const { game, attacker, ctx } = setup();
    const target = game.teams.B.champions[0];
    target.pos = { q: attacker.pos.q + 6, r: attacker.pos.r };
    applyGapCloseStrike(ctx, { type: "gap_close_strike", distance: 10 }, [target]);
    expect(hexDistance(attacker.pos, target.pos)).toBe(1);
  });

  it("não teleporta se nenhuma casa livre ao lado estiver dentro da distância", () => {
    const { game, attacker, ctx } = setup();
    const target = game.teams.B.champions[0];
    target.pos = { q: attacker.pos.q + 6, r: attacker.pos.r };
    const before = { ...attacker.pos };
    applyGapCloseStrike(ctx, { type: "gap_close_strike", distance: 1 }, [target]);
    expect(attacker.pos).toEqual(before);
  });
});

describe("buff_next_card", () => {
  it("guarda o bônus da próxima carta no estado da equipe", () => {
    const { game, ctx } = setup();
    applyBuffNextCard(ctx, { type: "buff_next_card", bonus_damage: 3 });
    expect(game.teams.A.nextCardBuff).toEqual({ bonusDamage: 3 });
  });
});
