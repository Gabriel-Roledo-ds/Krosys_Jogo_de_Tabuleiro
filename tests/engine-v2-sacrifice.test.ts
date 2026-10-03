// Sacrifícios de passiva (roster v2) — item 44 do KANBAN, regras-e-decisoes.md
// §22. 9 regras bespoke (uma por campeão com `sacrifice !== null`), cada uma
// abrindo mão de um recurso do próprio turno por um bônus específico. Ver
// src/engine-v2/sacrifice.ts.
//
// Esta suíte também cobre dois achados corrigidos no caminho (ver cabeçalhos
// dos próprios arquivos): `untargetable` nunca era checado em targeting.ts
// (campeão recém-voltado da morte podia ser alvo de verdade, violando a
// regra [DEFINIDO] da seção 9), e `apply_status_area` com `radius` nunca
// expandia a área de verdade (7 cartas em 5 campeões só acertavam quem usou
// a própria carta).

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2, type GameStateV2 } from "../src/engine-v2/state";
import { applyActionV2, legalActionsV2 } from "../src/engine-v2/turn";
import { canSacrificeV2, applySacrificeV2, sacrificeAllyTargetsV2 } from "../src/engine-v2/sacrifice";
import {
  applyDamage,
  applyHeal,
  applyStatus,
  applyGroundFire,
  applyCreateWall,
  applyCreateWallsLine,
  applyVenomStacks,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { resolveCardEffectsV2 } from "../src/engine-v2/cardPlay";
import type { CardDefV2 } from "../src/engine-v2/data";
import { dealDamageV2 } from "../src/engine-v2/damage";
import { addStatus, hasStatus, statusAmount } from "../src/engine-v2/status";
import { validateTargetV2 } from "../src/engine-v2/targeting";
import { tickRoundV2 } from "../src/engine-v2/tick";

/** Time A: niara, varek, selene (default). Time B: borak, dorin, aurelia (default). */
function setupDefault(): GameStateV2 {
  return createGameV2(1);
}

/** Composição alternativa pra cobrir ignira/vextra/thorne/sylvane, que não estão no default. */
function setupAlt(): GameStateV2 {
  return createGameV2(1, { comp: { A: ["ignira", "vextra", "thorne"], B: ["sylvane", "niara", "varek"] } });
}

/** Carta mínima de alvo "cell" com um único efeito `apply_status_area`, pra testar a área sem depender de cards_v2.json. */
function cellStatusAreaCard(status: string, radius: number): CardDefV2 {
  return {
    id: "test_area_card",
    owner: "test",
    name: "Teste",
    notes: null,
    fast: false,
    rank_type: "regular",
    target: "cell",
    ranks: [{ rank: 1, cost: 0, range: 3, text: "", effects: [{ type: "apply_status_area", status, radius, duration: { unit: "rounds", value: 1 } }] }],
  };
}

describe("validação geral (canSacrificeV2)", () => {
  it("falha pra campeão sem sacrifício de passiva (Niara)", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    expect(canSacrificeV2(game, "A", niara.uid)).toMatch(/não tem sacrifício/);
  });

  it("falha se não for o turno dessa equipe", () => {
    const game = setupDefault();
    game.turn.phase = "act"; // ainda turno de A
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    expect(canSacrificeV2(game, "B", borak.uid)).toMatch(/não é o turno/);
  });

  it("só pode ser usado 1x por turno (sacrificeUsedThisTurn)", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    applySacrificeV2(game, "A", varek.uid, selene.uid);
    expect(varek.sacrificeUsedThisTurn).toBe(true);
    expect(canSacrificeV2(game, "A", varek.uid, selene.uid)).toMatch(/já usado/);
  });

  it("finishTurn reseta sacrificeUsedThisTurn pro próximo turno da equipe", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    applySacrificeV2(game, "A", varek.uid, selene.uid);
    applyActionV2(game, "A", { type: "end" });
    expect(varek.sacrificeUsedThisTurn).toBe(false);
  });

  it("aparece em legalActionsV2 na fase certa", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const actions = legalActionsV2(game, "A");
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    expect(actions.some((a) => a.type === "sacrifice" && a.champion === varek.uid)).toBe(true);
  });
});

describe("Fúria Desenfreada (Borak) — +3 de dano fixo no turno, perde 4 de vida (hp>=5)", () => {
  it("exige hp>=5", () => {
    const game = setupDefault();
    game.turn.team = "B";
    game.turn.phase = "act";
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.hp = 4;
    expect(canSacrificeV2(game, "B", borak.uid)).toMatch(/pelo menos 5/);
  });

  it("perde 4 de vida e ganha o status de bônus", () => {
    const game = setupDefault();
    game.turn.team = "B";
    game.turn.phase = "act";
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.hp = 20;
    applySacrificeV2(game, "B", borak.uid);
    expect(borak.hp).toBe(16);
    expect(statusAmount(borak, "sacrifice_bonus_damage")).toBe(3);
  });

  it("applyDamage soma o bônus ao dano de um ataque contra campeão", () => {
    const game = setupDefault();
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const target = game.teams.A.champions[0];

    const ctxWithout: EffectContextV2 = { game, attacker: borak, nextId: () => nextIdV2(game), bonusDamage: 0 };
    const hpBefore1 = target.hp;
    applyDamage(ctxWithout, { type: "damage", amount: 5 }, [target]);
    const dealtWithout = hpBefore1 - target.hp;
    target.hp = hpBefore1; // restaura pra comparar no mesmo campeão (defesa igual)

    addStatus(borak, nextIdV2(game), "sacrifice_bonus_damage", "rounds", 1, { amount: 3 });
    const ctxWith: EffectContextV2 = { game, attacker: borak, nextId: () => nextIdV2(game), bonusDamage: statusAmount(borak, "sacrifice_bonus_damage") };
    const hpBefore2 = target.hp;
    applyDamage(ctxWith, { type: "damage", amount: 5 }, [target]);
    const dealt = hpBefore2 - target.hp;

    expect(dealt).toBe(dealtWithout + 3);
  });
});

describe("Fogo Selvagem (Ignira) — abre mão da compra, +1 raio/+1 rodada no chão em chamas", () => {
  it("só pode ser declarado na fase de compra", () => {
    const game = setupAlt();
    game.turn.phase = "act";
    const ignira = game.teams.A.champions.find((c) => c.defId === "ignira")!;
    expect(canSacrificeV2(game, "A", ignira.uid)).toMatch(/fase de compra/);
  });

  it("pula a compra (vai pra fase de ação) e dá o status", () => {
    const game = setupAlt();
    expect(game.turn.phase).toBe("draw");
    const ignira = game.teams.A.champions.find((c) => c.defId === "ignira")!;
    applyActionV2(game, "A", { type: "sacrifice", champion: ignira.uid });
    expect(game.turn.phase).toBe("act");
    expect(hasStatus(ignira, "sacrifice_fogo_selvagem")).toBe(true);
  });

  it("applyGroundFire soma +1 de raio e +1 de rodada de duração", () => {
    const game = setupAlt();
    const ignira = game.teams.A.champions.find((c) => c.defId === "ignira")!;
    addStatus(ignira, nextIdV2(game), "sacrifice_fogo_selvagem", "rounds", 1, {});
    const ctx: EffectContextV2 = { game, attacker: ignira, nextId: () => nextIdV2(game), targetCell: { q: 5, r: 5 } };
    applyGroundFire(ctx, { type: "ground_fire", radius: 2, damage_per_round: 3, duration: { unit: "rounds", value: 2 } });
    const g = game.ground.find((x) => x.kind === "fire")!;
    expect(g.radius).toBe(3);
    expect(g.remaining).toBe(3);
  });
});

describe("Em Sombras (Vextra) — abre mão de agir, invisível até o próximo turno, golpe furtivo garantido", () => {
  it("abre mão de movimento/básica/cartas (activated+basicUsed+cannotCast) e fica stealthed", () => {
    const game = setupAlt();
    game.turn.phase = "act";
    const vextra = game.teams.A.champions.find((c) => c.defId === "vextra")!;
    applySacrificeV2(game, "A", vextra.uid);
    expect(game.turn.activated).toContain(vextra.uid);
    expect(game.turn.basicUsed).toContain(vextra.uid);
    expect(hasStatus(vextra, "stealthed")).toBe(true);
  });

  it("stealthed não pode ser escolhida como alvo único 'enemy' por um inimigo", () => {
    const game = setupAlt();
    const vextra = game.teams.A.champions.find((c) => c.defId === "vextra")!;
    const enemy = game.teams.B.champions[0];
    addStatus(vextra, nextIdV2(game), "stealthed", "rounds", 1, {});
    vextra.pos = { ...enemy.pos };
    const err = validateTargetV2(game, enemy, { range: 10, target: "enemy" }, { uid: vextra.uid });
    expect(err).not.toBeNull();
  });

  it("[achado corrigido] campeão untargetable (recém-voltado da morte) também não pode ser alvo único 'enemy'", () => {
    const game = setupDefault();
    const revived = game.teams.A.champions[0];
    const enemy = game.teams.B.champions[0];
    revived.untargetable = true;
    revived.pos = { ...enemy.pos };
    const err = validateTargetV2(game, enemy, { range: 10, target: "enemy" }, { uid: revived.uid });
    expect(err).not.toBeNull();
  });

  it("o primeiro dano depois (applyDamage) ganha o bônus de golpe furtivo e consome o status", () => {
    const game = setupAlt();
    const vextra = game.teams.A.champions.find((c) => c.defId === "vextra")!;
    const target = game.teams.B.champions[0];
    const ctx: EffectContextV2 = { game, attacker: vextra, nextId: () => nextIdV2(game) };

    const hpBefore0 = target.hp;
    applyDamage(ctx, { type: "damage", amount: 5 }, [target]);
    const dealtWithout = hpBefore0 - target.hp;
    target.hp = hpBefore0; // restaura pra comparar no mesmo campeão (defesa igual)

    addStatus(vextra, nextIdV2(game), "sacrifice_backstab_next_hit", "rounds", 1, { amount: 4 });
    const hpBefore = target.hp;
    applyDamage(ctx, { type: "damage", amount: 5 }, [target]);
    expect(hpBefore - target.hp).toBe(dealtWithout + 4);
    expect(hasStatus(vextra, "sacrifice_backstab_next_hit")).toBe(false); // consumido

    // um segundo golpe não ganha mais o bônus
    const hpBefore2 = target.hp;
    applyDamage(ctx, { type: "damage", amount: 5 }, [target]);
    expect(hpBefore2 - target.hp).toBe(dealtWithout);
  });
});

describe("Toxina Concentrada (Thorne) — -2 casas de alcance, +1 estaca de veneno por acerto", () => {
  it("reduz o alcance efetivo de uma carta jogada por ela (validateTargetV2 com rangeBonus negativo)", () => {
    const game = setupAlt();
    const thorne = game.teams.A.champions.find((c) => c.defId === "thorne")!;
    const enemy = game.teams.B.champions[0];
    enemy.pos = { q: thorne.pos.q + 4, r: thorne.pos.r };
    expect(validateTargetV2(game, thorne, { range: 5, target: "enemy" }, { uid: enemy.uid })).toBeNull();
    expect(validateTargetV2(game, thorne, { range: 5, target: "enemy" }, { uid: enemy.uid }, -2)).toMatch(/fora de alcance/);
  });

  it("applyVenomStacks aplica 1 estaca extra com o bônus ativo", () => {
    const game = setupAlt();
    const thorne = game.teams.A.champions.find((c) => c.defId === "thorne")!;
    const target = game.teams.B.champions[0];
    const ctxNormal: EffectContextV2 = { game, attacker: thorne, nextId: () => nextIdV2(game) };
    applyVenomStacks(ctxNormal, { type: "apply_venom_stacks", amount: 1 }, [target]);
    expect(statusAmount(target, "venom_stacks")).toBe(1);

    const target2 = game.teams.B.champions[1];
    const ctxBoosted: EffectContextV2 = { game, attacker: thorne, nextId: () => nextIdV2(game), bonusVenomStacks: 1 };
    applyVenomStacks(ctxBoosted, { type: "apply_venom_stacks", amount: 1 }, [target2]);
    expect(statusAmount(target2, "venom_stacks")).toBe(2);
  });
});

describe("Prece Desesperada (Selene) — perde 3 de vida (hp>=4), dobra a próxima cura", () => {
  it("exige hp>=4", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    selene.hp = 3;
    expect(canSacrificeV2(game, "A", selene.uid)).toMatch(/pelo menos 4/);
  });

  it("perde 3 de vida e dobra só a PRÓXIMA cura, consumindo o status", () => {
    const game = setupDefault();
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    selene.hp = 20;
    game.turn.phase = "act";
    applySacrificeV2(game, "A", selene.uid);
    expect(selene.hp).toBe(17);

    const ally = game.teams.A.champions[0];
    ally.hp = Math.max(1, ally.maxHp - 20);
    const ctx: EffectContextV2 = { game, attacker: selene, nextId: () => nextIdV2(game) };
    const before = ally.hp;
    applyHeal(ctx, { type: "heal", amount: 4 }, [ally]);
    expect(ally.hp - before).toBe(8); // dobrado
    expect(hasStatus(selene, "sacrifice_double_heal")).toBe(false);

    const before2 = ally.hp;
    applyHeal(ctx, { type: "heal", amount: 4 }, [ally]);
    expect(ally.hp - before2).toBe(4); // não dobra mais
  });
});

describe("Último Bastião (Varek) — abre mão do movimento, redireciona dano do aliado pra si", () => {
  it("exige escolher um aliado vivo, diferente de si mesmo", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    expect(canSacrificeV2(game, "A", varek.uid)).toMatch(/escolha o aliado/);
    expect(canSacrificeV2(game, "A", varek.uid, varek.uid)).toMatch(/não pode proteger a si/);
  });

  it("sacrificeAllyTargetsV2 lista os outros 2 campeões vivos da equipe", () => {
    const game = setupDefault();
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    const targets = sacrificeAllyTargetsV2(game, varek.uid);
    expect(targets).toHaveLength(2);
    expect(targets).not.toContain(varek.uid);
  });

  it("marca o movimento como gasto (sem virar 'main') e protege o aliado — dano do aliado vai pro Varek", () => {
    const game = setupDefault();
    game.turn.phase = "act";
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    applySacrificeV2(game, "A", varek.uid, selene.uid);
    expect(game.turn.activated).toContain(varek.uid);
    expect(game.turn.main).not.toBe(varek.uid);
    expect(selene.protectedBy).toBe(varek);

    const varekHpBefore = varek.hp;
    const seleneHpBefore = selene.hp;
    const enemy = game.teams.B.champions[0];
    const result = dealDamageV2(enemy, selene, 10);
    expect(result.final).toBeGreaterThan(0);
    expect(selene.hp).toBe(seleneHpBefore); // Selene não sofreu nada
    expect(varek.hp).toBe(varekHpBefore - result.final); // Varek sofreu no lugar dela
  });

  it("a proteção dura só até o próximo tickRoundV2 (granularidade de 1 rodada)", () => {
    const game = setupDefault();
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    selene.protectedBy = varek;
    tickRoundV2(game);
    expect(selene.protectedBy).toBeUndefined();
  });
});

describe("Floresta Desperta (Sylvane) — abre mão da básica, +1 raio pra cartas de controle em área", () => {
  it("[achado corrigido] apply_status_area com radius agora expande pra área de verdade (antes só acertava quem usou a carta)", () => {
    const game = setupAlt();
    const sylvane = game.teams.B.champions.find((c) => c.defId === "sylvane")!;
    const enemy = game.teams.A.champions[0];
    const cell = { q: sylvane.pos.q + 1, r: sylvane.pos.r };
    enemy.pos = { ...cell };
    resolveCardEffectsV2(game, sylvane, cellStatusAreaCard("root", 1), cellStatusAreaCard("root", 1).ranks[0], { pos: cell });
    expect(hasStatus(enemy, "root")).toBe(true);
  });

  it("marca a básica como usada ao sacrificar", () => {
    const game = setupAlt();
    game.turn.team = "B";
    game.turn.phase = "act";
    const sylvane = game.teams.B.champions.find((c) => c.defId === "sylvane")!;
    applySacrificeV2(game, "B", sylvane.uid);
    expect(game.turn.basicUsed).toContain(sylvane.uid);
    expect(statusAmount(sylvane, "sacrifice_control_radius_bonus")).toBe(1);
  });

  it("+1 de raio só alcança status de CONTROLE em área, não um status de apoio", () => {
    const game = setupAlt();
    const sylvane = game.teams.B.champions.find((c) => c.defId === "sylvane")!;
    addStatus(sylvane, nextIdV2(game), "sacrifice_control_radius_bonus", "rounds", 1, { amount: 1 });
    const cell = { q: sylvane.pos.q + 2, r: sylvane.pos.r };
    const farEnemy = game.teams.A.champions[0];
    farEnemy.pos = { q: cell.q + 2, r: cell.r }; // a 2 do centro — raio base 1 não alcança, +1 alcança

    const controlCard = cellStatusAreaCard("root", 1);
    resolveCardEffectsV2(game, sylvane, controlCard, controlCard.ranks[0], { pos: cell });
    expect(hasStatus(farEnemy, "root")).toBe(true); // alcançado com o bônus

    const supportCard = cellStatusAreaCard("immune_to_control", 1);
    resolveCardEffectsV2(game, sylvane, supportCard, supportCard.ranks[0], { pos: cell });
    expect(hasStatus(farEnemy, "immune_to_control")).toBe(false); // bônus não vale pra status não-controle
  });
});

describe("Construção Acelerada (Dorin) — abre mão da compra, dobra paredes/estruturas", () => {
  it("só pode ser declarado na fase de compra e pula pra fase de ação", () => {
    const game = setupDefault();
    game.turn.team = "B";
    expect(game.turn.phase).toBe("draw");
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    applyActionV2(game, "B", { type: "sacrifice", champion: dorin.uid });
    expect(game.turn.phase).toBe("act");
    expect(hasStatus(dorin, "sacrifice_double_construct")).toBe(true);
  });

  it("applyCreateWall dobra o hp da parede única criada", () => {
    const game = setupDefault();
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    addStatus(dorin, nextIdV2(game), "sacrifice_double_construct", "rounds", 1, {});
    const ctx: EffectContextV2 = { game, attacker: dorin, nextId: () => nextIdV2(game), targetCell: { q: 1, r: 1 } };
    applyCreateWall(ctx, { type: "create_wall", hp: 10 });
    expect(game.walls.find((w) => w.pos.q === 1 && w.pos.r === 1)!.hp).toBe(20);
  });

  it("applyCreateWallsLine dobra a QUANTIDADE de paredes criadas", () => {
    const game = setupDefault();
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    addStatus(dorin, nextIdV2(game), "sacrifice_double_construct", "rounds", 1, {});
    const before = game.walls.length;
    const ctx: EffectContextV2 = { game, attacker: dorin, nextId: () => nextIdV2(game), targetCell: { q: 1, r: 1 }, moveDir: { q: 1, r: 0 } };
    applyCreateWallsLine(ctx, { type: "create_walls_line", count: 2, hp: 10 });
    expect(game.walls.length - before).toBe(4); // 2 * 2
  });
});

describe("Canalização Total (Aurelia) — abre mão da básica e do movimento, buffs +1 rodada e +50%", () => {
  it("marca a básica usada e o movimento gasto", () => {
    const game = setupDefault();
    game.turn.team = "B";
    game.turn.phase = "act";
    const aurelia = game.teams.B.champions.find((c) => c.defId === "aurelia")!;
    applySacrificeV2(game, "B", aurelia.uid);
    expect(game.turn.basicUsed).toContain(aurelia.uid);
    expect(game.turn.activated).toContain(aurelia.uid);
    expect(game.turn.main).not.toBe(aurelia.uid);
  });

  it("applyStatus aumenta +50% o amount e +1 rodada a duração de um BUFF (não afeta debuff)", () => {
    const game = setupDefault();
    const aurelia = game.teams.B.champions.find((c) => c.defId === "aurelia")!;
    addStatus(aurelia, nextIdV2(game), "sacrifice_buff_boost", "rounds", 1, {});
    const ally = game.teams.B.champions[0];
    const ctx: EffectContextV2 = { game, attacker: aurelia, nextId: () => nextIdV2(game) };
    applyStatus(ctx, { type: "apply_status", status: "damage_buff", amount: 2, duration: { unit: "rounds", value: 2 } }, [ally]);
    const buffEntry = ally.statuses.find((s) => s.status === "damage_buff")!;
    expect(buffEntry.amount).toBe(3); // round(2*1.5)
    expect(buffEntry.remaining).toBe(3); // 2+1

    const enemy = game.teams.A.champions[0];
    applyStatus(ctx, { type: "apply_status", status: "defense_down", amount: 2, duration: { unit: "rounds", value: 2 } }, [enemy]);
    const debuffEntry = enemy.statuses.find((s) => s.status === "defense_down")!;
    expect(debuffEntry.amount).toBe(2); // sem bônus (negativo)
    expect(debuffEntry.remaining).toBe(2);
  });
});
