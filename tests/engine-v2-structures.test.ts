// Últimos ~9 tipos de efeito do catálogo de cards_v2.json (item 37 do
// KANBAN): fire_trail, delayed_damage, damage_all_adjacent_during_move,
// create_structure, create_walls_line/shape/around_target, create_portal_pair
// e slow_cell. Completa o que tests/engine-v2-hazards.test.ts já cobria.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import {
  applyEffectV2,
  applyFireTrail,
  applyDelayedDamage,
  applyMoveSelf,
  applyDamageAllAdjacentDuringMove,
  applyCreateStructure,
  applyCreateWallsLine,
  applyCreateWallsShape,
  applyCreateWallsAroundTarget,
  applyCreatePortalPair,
  applySlowCell,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { onLandV2 } from "../src/engine-v2/hazards";
import { tickRoundV2 } from "../src/engine-v2/tick";
import { applyActionV2 } from "../src/engine-v2/turn";
import { reachableMap } from "../src/engine-v2/movement";
import { wallAtV2 } from "../src/engine-v2/world";
import { hasStatus } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const target = game.teams.B.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, target, ctx };
}

describe("fire_trail (Rastro de Fogo da Ignira)", () => {
  it("não deixa fogo na hora — só no próximo movimento voluntário, consumindo o status", () => {
    const { game, attacker, ctx } = setup();
    applyFireTrail(ctx, { type: "fire_trail", damage_per_round: 2, duration: { unit: "rounds", value: 2 } }, [attacker]);
    expect(hasStatus(attacker, "fire_trail_active")).toBe(true);
    expect(game.ground).toHaveLength(0);

    game.turn.main = attacker.uid;
    game.turn.phase = "act";
    game.turn.movementLeft = 3;
    const dest = [...reachableMap(game, attacker, 3).keys()][0];
    const [q, r] = dest.split(",").map(Number);
    applyActionV2(game, attacker.team, { type: "move", to: { q, r }, champion: attacker.uid });

    expect(hasStatus(attacker, "fire_trail_active")).toBe(false); // consumido
    expect(game.ground.some((g) => g.kind === "fire" && g.damagePerRound === 2)).toBe(true);
  });

  it("instant_bonus_on_enter (★★★) causa dano extra a quem entra no rastro, além do dano por rodada", () => {
    const { game, target, ctx } = setup();
    game.ground.push({ id: 999, kind: "fire", pos: { ...target.pos }, radius: 0, team: "A", remaining: 2, damagePerRound: 2, instantBonusOnEnter: 3 });
    const hpBefore = target.hp;
    onLandV2(game, target, { voluntary: true });
    expect(target.hp).toBe(hpBefore - 3); // só o bônus instantâneo; o dano por rodada é no tick
  });
});

describe("delayed_damage (Explosão Retardada da Ignira)", () => {
  it("explode sozinho depois de `delay_rounds`, acertando quem estiver na área nesse momento", () => {
    const { game, target, ctx } = setup();
    applyDelayedDamage(ctx, { type: "delayed_damage", amount: 6, delay_rounds: 2, radius: 1 }, [target]);
    expect(game.delayedDamages).toHaveLength(1);

    const hpBefore = target.hp;
    tickRoundV2(game); // rodada 1: ainda não explodiu
    expect(target.hp).toBe(hpBefore);
    expect(game.delayedDamages).toHaveLength(1);

    tickRoundV2(game); // rodada 2: explode
    expect(target.hp).toBe(hpBefore - 6);
    expect(game.delayedDamages).toHaveLength(0);
  });
});

describe("damage_all_adjacent_during_move (Dança das Lâminas da Vextra)", () => {
  it("dano a todo inimigo adjacente a qualquer casa do caminho do move_self, sem repetir", () => {
    const { game, attacker, ctx } = setup();
    attacker.pos = { q: 2, r: 0 };
    const enemy1 = game.teams.B.champions[0];
    const enemy2 = game.teams.B.champions[1];
    enemy1.pos = { q: 3, r: 1 }; // adjacente à 1ª casa do caminho (3,0), sem bloquear o caminho
    enemy2.pos = { q: 5, r: 1 }; // adjacente à última casa do caminho (5,0)
    enemy1.defense = 0;
    enemy2.defense = 0;

    const moveCtx: EffectContextV2 = { ...ctx, moveDir: { q: 1, r: 0 } };
    applyMoveSelf(moveCtx, { type: "move_self", distance: 3 }, [attacker]);
    expect(attacker.pos).toEqual({ q: 5, r: 0 });

    const hp1Before = enemy1.hp;
    const hp2Before = enemy2.hp;
    applyDamageAllAdjacentDuringMove(moveCtx, { type: "damage_all_adjacent_during_move", amount: 5 });
    expect(enemy1.hp).toBe(hp1Before - 5);
    expect(enemy2.hp).toBe(hp2Before - 5);
  });

  it("sem ctx.lastMovePath (carta sem move_self antes), não faz nada", () => {
    const { ctx } = setup();
    expect(() => applyDamageAllAdjacentDuringMove(ctx, { type: "damage_all_adjacent_during_move", amount: 5 })).not.toThrow();
  });
});

describe("create_structure (Torre de Vigia do Dorin)", () => {
  it("dano por rodada a inimigos dentro do alcance, resolvido no tick; bloqueia a casa como parede", () => {
    const { game, attacker, target, ctx } = setup();
    target.pos = { q: attacker.pos.q + 2, r: attacker.pos.r }; // perto o bastante pra entrar no alcance
    const cell = { q: attacker.pos.q + 1, r: attacker.pos.r };
    applyCreateStructure({ ...ctx, targetCell: cell }, { type: "create_structure", hp: 3, damage_per_round: 2, range: 5 });
    expect(game.structures).toHaveLength(1);
    expect(wallAtV2(game, cell)).toBeNull(); // é estrutura, não parede — mas bloqueia movimento igual (ver isSolid)

    const hpBefore = target.hp;
    tickRoundV2(game);
    expect(target.hp).toBe(hpBefore - 2);
  });

  it("estruturas com duration expiram; sem duration, ficam até serem destruídas", () => {
    const { game, ctx } = setup();
    applyCreateStructure({ ...ctx, targetCell: { q: 1, r: 1 } }, { type: "create_structure", hp: 3, damage_per_round: 2, range: 5, duration: { unit: "rounds", value: 1 } });
    expect(game.structures).toHaveLength(1);
    tickRoundV2(game);
    expect(game.structures).toHaveLength(0);
  });
});

describe("create_walls_line (Muralha do Dorin)", () => {
  it("cria `count` paredes em fila na direção de quem usou a carta até a casa escolhida", () => {
    const { game, attacker, ctx } = setup();
    attacker.pos = { q: 2, r: 2 };
    const cell = { q: 4, r: 2 };
    applyCreateWallsLine({ ...ctx, targetCell: cell, moveDir: { q: 1, r: 0 } }, { type: "create_walls_line", count: 3, hp: 5, duration: { unit: "rounds", value: 3 } });
    expect(wallAtV2(game, { q: 4, r: 2 })).not.toBeNull();
    expect(wallAtV2(game, { q: 5, r: 2 })).not.toBeNull();
    expect(wallAtV2(game, { q: 6, r: 2 })).not.toBeNull();
    expect(game.walls).toHaveLength(3);
  });
});

describe("create_walls_shape (Barricada do Dorin)", () => {
  it("cria `count` paredes formando uma cunha, derivando a direção de quem usou a carta até a casa", () => {
    const { game, attacker, ctx } = setup();
    attacker.pos = { q: 2, r: 2 };
    const cell = { q: 3, r: 2 };
    applyCreateWallsShape({ ...ctx, targetCell: cell }, { type: "create_walls_shape", count: 5, hp: 4, duration: { unit: "rounds", value: 2 } });
    expect(game.walls).toHaveLength(5);
  });
});

describe("create_walls_around_target (Bastião Impenetrável do Dorin)", () => {
  it("cerca a casa escolhida com `count` paredes (anel 1 completo + o resto do anel 2)", () => {
    const { game, ctx } = setup();
    const cell = { q: 9, r: 4 - 3 }; // longe do boss (9,4) e de monstros, ainda dentro do tabuleiro
    applyCreateWallsAroundTarget({ ...ctx, targetCell: cell }, { type: "create_walls_around_target", count: 8, hp: 8, duration: { unit: "rounds", value: 3 } });
    expect(game.walls).toHaveLength(8);
    expect(wallAtV2(game, cell)).toBeNull(); // a própria casa central não é murada, só o entorno
  });
});

describe("create_portal_pair (Portal do Dorin)", () => {
  it("entrar numa ponta teleporta pra outra", () => {
    const { game, target, ctx } = setup();
    const a = { q: 2, r: 2 };
    const b = { q: 14, r: 8 }; // longe de monstros/boss/campeões padrão (ver createGameV2(1))
    applyCreatePortalPair({ ...ctx, targetCell: a, targetCell2: b }, { type: "create_portal_pair" });
    expect(game.portals).toHaveLength(1);

    target.pos = { ...a };
    onLandV2(game, target, { voluntary: true });
    expect(target.pos).toEqual(b);
  });

  it("lasts_until_destroyed: remaining fica null (não expira por tempo)", () => {
    const { ctx } = setup();
    const game = ctx.game;
    applyCreatePortalPair({ ...ctx, targetCell: { q: 1, r: 1 }, targetCell2: { q: 2, r: 1 } }, { type: "create_portal_pair", lasts_until_destroyed: true });
    expect(game.portals[0].remaining).toBeNull();
  });
});

describe("slow_cell (Teia da Sylvane)", () => {
  it("custa o dobro de movimento pra atravessar a área", () => {
    const { game, attacker, ctx } = setup();
    attacker.pos = { q: 2, r: 0 };
    const cell = { q: 3, r: 0 };
    applySlowCell({ ...ctx, targetCell: cell }, { type: "slow_cell", radius: 0, duration: { unit: "rounds", value: 2 } });

    const reach2 = reachableMap(game, attacker, 2);
    // Com custo normal, 2 de movimento chegaria até (4,0); com a teia em (3,0)
    // custando 2, só dá pra chegar até ela mesma com 2 de orçamento.
    expect(reach2.has("3,0")).toBe(true);
    expect(reach2.has("4,0")).toBe(false);
  });
});
