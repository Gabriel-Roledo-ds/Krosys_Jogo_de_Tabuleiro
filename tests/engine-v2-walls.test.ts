// Testes de paredes do motor hexagonal (roster v2) — world.ts (consulta),
// movement.ts (bloqueio), targeting.ts (alvo "wall" + linha de visão),
// effects.ts (create/reinforce/destroy_wall) e tick.ts (duração). Ver
// KANBAN.md ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { wallAtV2, isFreeCellV2, hasLineOfSightV2 } from "../src/engine-v2/world";
import { reachableCells, teleportChampion, forcedMove } from "../src/engine-v2/movement";
import { validateTargetV2 } from "../src/engine-v2/targeting";
import { applyCreateWall, applyReinforceWall, applyDestroyWall, type EffectContextV2 } from "../src/engine-v2/effects";
import { tickRoundV2 } from "../src/engine-v2/tick";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, ctx };
}

describe("applyCreateWall / world.ts", () => {
  it("cria uma parede na casa-alvo, com hp/duração da carta", () => {
    const { game, ctx } = setup();
    const pos = { q: 7, r: 7 };
    applyCreateWall({ ...ctx, targetCell: pos }, { type: "create_wall", hp: 4 });
    const wall = wallAtV2(game, pos);
    expect(wall).not.toBeNull();
    expect(wall?.hp).toBe(4);
    expect(isFreeCellV2(game, pos)).toBe(false);
  });

  it("não duplica se já houver parede na mesma casa", () => {
    const { game, ctx } = setup();
    const pos = { q: 7, r: 7 };
    applyCreateWall({ ...ctx, targetCell: pos }, { type: "create_wall", hp: 4 });
    applyCreateWall({ ...ctx, targetCell: pos }, { type: "create_wall", hp: 9 });
    expect(game.walls).toHaveLength(1);
    expect(game.walls[0].hp).toBe(4); // a segunda não substituiu a primeira
  });
});

describe("parede bloqueia movimento", () => {
  it("campeão não consegue andar/teleportar pra cima ou através de uma parede", () => {
    const { game, attacker, ctx } = setup();
    const wallPos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    applyCreateWall({ ...ctx, targetCell: wallPos }, { type: "create_wall", hp: 4 });
    const reachable = reachableCells(game, attacker, 5);
    expect(reachable.some((h) => h.q === wallPos.q && h.r === wallPos.r)).toBe(false);
    expect(() => teleportChampion(game, attacker, wallPos, 5)).toThrow();
  });

  it("empurrão/puxão para antes de entrar na parede", () => {
    const { game, attacker, ctx } = setup();
    const target = game.teams.B.champions[0];
    target.pos = { q: attacker.pos.q - 1, r: attacker.pos.r };
    const wallPos = { q: attacker.pos.q - 2, r: attacker.pos.r };
    applyCreateWall({ ...ctx, targetCell: wallPos }, { type: "create_wall", hp: 4 });
    const moved = forcedMove(game, target, { q: -1, r: 0 }, 5);
    expect(moved).toBe(0); // já estava encostado, não tem pra onde ir
  });
});

describe("linha de visão e alvo 'wall'", () => {
  it("parede entre duas casas bloqueia o alcance", () => {
    const { game, attacker, ctx } = setup();
    const wallPos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    const farPos = { q: attacker.pos.q + 2, r: attacker.pos.r };
    expect(hasLineOfSightV2(game, attacker.pos, farPos)).toBe(true);
    applyCreateWall({ ...ctx, targetCell: wallPos }, { type: "create_wall", hp: 4 });
    expect(hasLineOfSightV2(game, attacker.pos, farPos)).toBe(false);
  });

  it("validateTargetV2 aceita o target 'wall' quando há parede na casa, dentro do alcance", () => {
    const { game, attacker, ctx } = setup();
    const wallPos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    applyCreateWall({ ...ctx, targetCell: wallPos }, { type: "create_wall", hp: 4 });
    expect(validateTargetV2(game, attacker, { range: 3, target: "wall" }, { pos: wallPos })).toBeNull();
    const emptyNearby = { q: attacker.pos.q, r: attacker.pos.r + 2 }; // direção diferente da parede, pra não ser bloqueado por linha de visão
    expect(validateTargetV2(game, attacker, { range: 3, target: "wall" }, { pos: emptyNearby })).toMatch(/não há parede/);
  });
});

describe("applyReinforceWall / applyDestroyWall", () => {
  it("reforçar soma hp, e com permanent remove a duração", () => {
    const { game, ctx } = setup();
    const pos = { q: 7, r: 7 };
    applyCreateWall({ ...ctx, targetCell: pos }, { type: "create_wall", hp: 4 });
    applyReinforceWall({ ...ctx, targetCell: pos }, { type: "reinforce_wall", amount: 5 });
    expect(wallAtV2(game, pos)?.hp).toBe(9);
    applyReinforceWall({ ...ctx, targetCell: pos }, { type: "reinforce_wall", amount: 8, permanent: true });
    expect(wallAtV2(game, pos)?.remaining).toBeNull();
  });

  it("reforçar sem parede na casa não faz nada", () => {
    const { ctx } = setup();
    applyReinforceWall({ ...ctx, targetCell: { q: 1, r: 1 } }, { type: "reinforce_wall", amount: 5 });
    expect(ctx.game.walls).toHaveLength(0);
  });

  it("destruir remove a parede da casa", () => {
    const { game, ctx } = setup();
    const pos = { q: 7, r: 7 };
    applyCreateWall({ ...ctx, targetCell: pos }, { type: "create_wall", hp: 4 });
    applyDestroyWall({ ...ctx, targetCell: pos });
    expect(wallAtV2(game, pos)).toBeNull();
  });
});

describe("duração da parede no tick", () => {
  it("some depois que a duração acaba, mas uma permanente nunca some", () => {
    const { game, ctx } = setup();
    const temp = { q: 7, r: 7 };
    const perm = { q: 8, r: 8 };
    applyCreateWall({ ...ctx, targetCell: temp }, { type: "create_wall", hp: 4 }); // dura balance.walls.default_duration_rounds
    applyCreateWall({ ...ctx, targetCell: perm }, { type: "create_wall", hp: 4 });
    applyReinforceWall({ ...ctx, targetCell: perm }, { type: "reinforce_wall", amount: 1, permanent: true });
    for (let i = 0; i < 10; i++) tickRoundV2(game);
    expect(wallAtV2(game, temp)).toBeNull();
    expect(wallAtV2(game, perm)).not.toBeNull();
  });
});
