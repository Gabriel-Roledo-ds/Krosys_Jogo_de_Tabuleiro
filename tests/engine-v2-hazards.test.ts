// Efeitos de casa do motor hexagonal (roster v2) — item 37 do KANBAN
// (catálogo restante de tipos de efeito). Cobre hidden_trap, spring,
// fire_wall, venom_terrain, mark_ground_area, detonate_nearby_ground_fire
// (effects.ts cria as entradas em `game.ground`; hazards.ts/onLandV2 resolve
// o que acontece quando alguém termina o movimento ali), além de link_buff e
// jump_to_nearest_enemy_on_target_death (sem relação com hazards de casa).

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import {
  applyEffectV2,
  applyHiddenTrap,
  applySpring,
  applyFireWall,
  applyVenomTerrain,
  applyMarkGroundArea,
  applyDetonateNearbyGroundFire,
  applyLinkBuff,
  applyJumpToNearestEnemyOnTargetDeath,
  applyStatus,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { onLandV2 } from "../src/engine-v2/hazards";
import { statusAmount, hasStatus } from "../src/engine-v2/status";
import { killChampionV2 } from "../src/engine-v2/death";
import { playCardV2 } from "../src/engine-v2/cardPlay";
import type { CardInstanceV2 } from "../src/engine-v2/state";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const target = game.teams.B.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, target, ctx };
}

function putCardInHand(game: ReturnType<typeof createGameV2>, team: "A" | "B", ownerUid: string, cardId: string): CardInstanceV2 {
  const card: CardInstanceV2 = { uid: `test#${cardId}#${ownerUid}`, cardId, owner: ownerUid };
  game.teams[team].hand.push(card);
  return card;
}

describe("hidden_trap", () => {
  it("cria a armadilha; alguém que termina o movimento nela sofre dano e some em seguida", () => {
    const { game, target, ctx } = setup();
    const cell = { q: target.pos.q + 3, r: target.pos.r };
    applyHiddenTrap({ ...ctx, targetCell: cell }, { type: "hidden_trap", damage: 5 });
    expect(game.ground.some((g) => g.kind === "trap")).toBe(true);

    target.pos = { ...cell };
    const hpBefore = target.hp;
    onLandV2(game, target, { voluntary: true });

    expect(target.hp).toBe(hpBefore - 5);
    expect(game.ground.some((g) => g.kind === "trap")).toBe(false); // consumida
  });

  it("★★★ aplica penalidade de movimento (move_penalty) junto com o dano", () => {
    const { game, target, ctx } = setup();
    const cell = { q: target.pos.q + 3, r: target.pos.r };
    applyHiddenTrap({ ...ctx, targetCell: cell }, { type: "hidden_trap", damage: 7, slow_amount: 2 });
    target.pos = { ...cell };
    onLandV2(game, target, { voluntary: true });
    expect(statusAmount(target, "move_penalty")).toBe(2);
  });

  it("não dispara duas vezes pra quem só passa perto, sem terminar o movimento ali", () => {
    const { game, target, ctx } = setup();
    const trapCell = { q: target.pos.q + 3, r: target.pos.r };
    applyHiddenTrap({ ...ctx, targetCell: trapCell }, { type: "hidden_trap", damage: 5 });
    const hpBefore = target.hp;
    onLandV2(game, target, { voluntary: true }); // target ainda não está na casa da armadilha
    expect(target.hp).toBe(hpBefore);
    expect(game.ground).toHaveLength(1);
  });
});

describe("spring", () => {
  it("lança quem termina o movimento na mola, continuando na direção de onde veio", () => {
    const { game, target, ctx } = setup();
    // Reposiciona longe da borda do tabuleiro e de qualquer ocupante, pra
    // sobrarem casas livres suficientes na direção do lançamento (q_size=19 —
    // ver src/design/hexGrid board placeholder).
    target.pos = { q: 2, r: 0 };
    const springCell = { q: target.pos.q + 1, r: target.pos.r };
    applySpring({ ...ctx, targetCell: springCell }, { type: "spring", distance: 3 });
    const from = { ...target.pos };
    target.pos = { ...springCell };

    onLandV2(game, target, { voluntary: true, from });

    expect(target.pos).toEqual({ q: springCell.q + 3, r: springCell.r }); // continuou na mesma direção (q crescente)
  });

  it("sem `from` (ex. já começou parado na mola), usa a direção padrão e não lança erro", () => {
    const { game, target, ctx } = setup();
    target.pos = { q: 2, r: 0 }; // longe da borda e de outros campeões
    const springCell = { ...target.pos };
    applySpring({ ...ctx, targetCell: springCell }, { type: "spring", distance: 2 });
    expect(() => onLandV2(game, target, { voluntary: true })).not.toThrow();
    expect(target.pos).not.toEqual(springCell);
  });
});

describe("fire_wall", () => {
  it("cria uma linha de N casas na direção escolhida; cada entrada causa dano (não some depois de 1 uso)", () => {
    const { game, attacker, ctx } = setup();
    const dir = { q: 1, r: 0 };
    applyFireWall({ ...ctx, moveDir: dir }, { type: "fire_wall", length: 4, damage_on_enter: 3, duration: { unit: "rounds", value: 2 } });
    expect(game.ground.filter((g) => g.kind === "fire_wall")).toHaveLength(4);

    const target = game.teams.B.champions[0];
    target.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    const hpBefore = target.hp;
    onLandV2(game, target, { voluntary: true });
    expect(target.hp).toBe(hpBefore - 3);
    expect(game.ground.some((g) => g.kind === "fire_wall" && g.pos.q === target.pos.q && g.pos.r === target.pos.r)).toBe(true); // ainda lá
  });
});

describe("venom_terrain", () => {
  it("aplica pilhas de veneno a quem entra na área (não precisa esperar a rodada)", () => {
    const { game, target, ctx } = setup();
    const cell = { q: target.pos.q + 1, r: target.pos.r };
    applyVenomTerrain({ ...ctx, targetCell: cell }, { type: "venom_terrain", radius: 2, stacks_on_enter: 3, duration: { unit: "rounds", value: 3 } });
    target.pos = { ...cell };
    onLandV2(game, target, { voluntary: true });
    expect(statusAmount(target, "venom_stacks")).toBe(3);
  });
});

describe("mark_ground_area", () => {
  it("retrigga a fração do dano original a quem entra na área marcada", () => {
    const { game, target, ctx } = setup();
    const cell = { q: target.pos.q + 1, r: target.pos.r };
    applyMarkGroundArea({ ...ctx, targetCell: cell, bonusDamage: 0 }, { type: "mark_ground_area", radius: 2, retrigger_damage_fraction: 0.5, amount: 10 });
    target.pos = { ...cell };
    const hpBefore = target.hp;
    onLandV2(game, target, { voluntary: true });
    expect(target.hp).toBe(hpBefore - 5); // 50% de 10
  });
});

describe("detonate_nearby_ground_fire", () => {
  it("aplica de uma vez o dano de todas as rodadas restantes e remove a área de fogo", () => {
    const { game, attacker, target, ctx } = setup();
    target.pos = { ...attacker.pos, q: attacker.pos.q + 1 };
    game.ground.push({ id: 999, kind: "fire", pos: { ...target.pos }, radius: 1, team: "A", remaining: 3, damagePerRound: 2 });
    const hpBefore = target.hp;

    applyDetonateNearbyGroundFire(ctx, { type: "detonate_nearby_ground_fire" }, [target]);

    expect(target.hp).toBe(hpBefore - 6); // 2 * 3 rodadas restantes de uma vez
    expect(game.ground.some((g) => g.id === 999)).toBe(false);
  });

  it("sem fogo próximo do alvo, não faz nada (sem lançar erro)", () => {
    const { ctx, target } = setup();
    expect(() => applyDetonateNearbyGroundFire(ctx, { type: "detonate_nearby_ground_fire" }, [target])).not.toThrow();
  });
});

describe("link_buff (Pacto Arcano da Aurelia)", () => {
  it("aplica o mesmo status em quem usou a carta e no aliado escolhido", () => {
    const { game, attacker, ctx } = setup();
    const ally = game.teams.A.champions[1];
    applyLinkBuff(ctx, { type: "link_buff", status: "damage_buff", amount: 3, duration: { unit: "rounds", value: 2 } }, [ally]);
    expect(statusAmount(attacker, "damage_buff")).toBe(3);
    expect(statusAmount(ally, "damage_buff")).toBe(3);
  });
});

describe("jump_to_nearest_enemy_on_target_death (Marca do Predador ★★★ da Niara)", () => {
  it("quando o marcado morre, a marca salta pro inimigo vivo mais próximo", () => {
    const { game, attacker, target, ctx } = setup();
    const otherEnemy = game.teams.B.champions[1];
    const thirdChampion = game.teams.B.champions[2];
    otherEnemy.pos = { q: target.pos.q + 1, r: target.pos.r }; // mais perto do alvo marcado do que qualquer outro
    thirdChampion.pos = { q: target.pos.q + 5, r: target.pos.r }; // bem mais longe, sem ambiguidade de empate
    applyStatus(ctx, { type: "apply_status", status: "mark", bonus_damage: 6, duration: { unit: "rounds", value: 3 } }, [target]);
    applyJumpToNearestEnemyOnTargetDeath([target]);
    expect(target.statuses.find((s) => s.status === "mark")?.jumpOnDeath).toBe(true);

    killChampionV2(game, target);

    expect(hasStatus(target, "mark")).toBe(false); // status limpo na morte (killChampionV2 zera statuses)
    expect(hasStatus(otherEnemy, "mark")).toBe(true);
    expect(statusAmount(otherEnemy, "mark")).toBe(6);
    expect(otherEnemy.statuses.find((s) => s.status === "mark")?.jumpOnDeath).toBe(true); // continua podendo saltar de novo
  });

  it("sem jumpOnDeath, a marca simplesmente desaparece com a morte (comportamento padrão)", () => {
    const { game, target, ctx } = setup();
    applyStatus(ctx, { type: "apply_status", status: "mark", bonus_damage: 4, duration: { unit: "rounds", value: 2 } }, [target]);
    killChampionV2(game, target);
    const anyoneElseHasMark = game.teams.B.champions.some((c) => c.uid !== target.uid && hasStatus(c, "mark"));
    expect(anyoneElseHasMark).toBe(false);
  });
});

describe("playCardV2 — ponta a ponta com os novos tipos", () => {
  it("dorin_armadilha cria a armadilha e dispara ao pisar", () => {
    const game = createGameV2(1, { comp: { A: ["dorin", "sylvane", "selene"], B: ["borak", "niara", "varek"] } });
    const dorin = game.teams.A.champions.find((c) => c.defId === "dorin")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const cell = { q: dorin.pos.q + 1, r: dorin.pos.r };
    game.teams.A.mana = 10;
    const card = putCardInHand(game, "A", dorin.uid, "dorin_armadilha");

    playCardV2(game, "A", card.uid, 1, { pos: cell });
    expect(game.ground.some((g) => g.kind === "trap")).toBe(true);

    borak.pos = { ...cell };
    const hpBefore = borak.hp;
    onLandV2(game, borak, { voluntary: true });
    expect(borak.hp).toBe(hpBefore - 3); // rank 1: damage 3
  });
});
