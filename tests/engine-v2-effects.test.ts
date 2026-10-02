// Testes de execução de efeitos do motor hexagonal (roster v2) —
// src/engine-v2/effects.ts. Cobre os 5 tipos mais usados em cards_v2.json
// (damage, apply_status, apply_status_area, heal, shield). Ver KANBAN.md.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import {
  applyEffectV2,
  applyDamage,
  applyHeal,
  applyShield,
  applyRemoveNegativeEffects,
  applyRemovePositiveEffects,
  applyPersonalMana,
  applyLink,
  type EffectContextV2,
} from "../src/engine-v2/effects";
import { addStatus, hasStatus, statusAmount } from "../src/engine-v2/status";

function setup() {
  const game = createGameV2(1);
  const attacker = game.teams.A.champions[0];
  const target = game.teams.B.champions[0];
  const ctx: EffectContextV2 = { game, attacker, nextId: () => nextIdV2(game) };
  return { game, attacker, target, ctx };
}

describe("applyDamage", () => {
  it("causa dano respeitando defesa", () => {
    const { target, ctx } = setup();
    target.defense = 2;
    const out = applyDamage(ctx, { type: "damage", amount: 10 }, [target]);
    expect(out[target.uid]).toBe(8);
    expect(target.hp).toBe(target.maxHp - 8);
  });

  it("ignore_defense/ignore_shield funcionam via effect", () => {
    const { target, ctx } = setup();
    target.defense = 5;
    target.shield = 100;
    const out = applyDamage(ctx, { type: "damage", amount: 10, ignore_defense: true, ignore_shield: true }, [target]);
    expect(out[target.uid]).toBe(10);
    expect(target.shield).toBe(100); // não foi tocado
  });

  it("aplica em múltiplos alvos de uma vez", () => {
    const { game, ctx } = setup();
    const targets = game.teams.B.champions;
    const out = applyDamage(ctx, { type: "damage", amount: 3, ignore_defense: true }, targets);
    for (const t of targets) expect(out[t.uid]).toBe(3);
  });
});

describe("applyEffectV2 — apply_status / apply_status_area", () => {
  it("aplica status com duração e amount no(s) alvo(s)", () => {
    const { target, ctx } = setup();
    applyEffectV2(ctx, { type: "apply_status", status: "damage_buff", amount: 3, duration: { unit: "rounds", value: 2 } }, [target]);
    expect(hasStatus(target, "damage_buff")).toBe(true);
    expect(statusAmount(target, "damage_buff")).toBe(3);
  });

  it("marca status conhecidos como negativos (defense_down, stun, etc.)", () => {
    const { target, ctx } = setup();
    applyEffectV2(ctx, { type: "apply_status", status: "stun", duration: { unit: "champion_turns", value: 1 } }, [target]);
    expect(target.statuses[0].negative).toBe(true);
  });

  it("apply_status_area aplica em todos os alvos passados", () => {
    const { game, ctx } = setup();
    const targets = game.teams.B.champions;
    applyEffectV2(ctx, { type: "apply_status_area", status: "root", duration: { unit: "champion_turns", value: 1 } }, targets);
    for (const t of targets) expect(hasStatus(t, "root")).toBe(true);
  });
});

describe("applyHeal", () => {
  it("cura sem passar do hp máximo", () => {
    const { target, ctx } = setup();
    target.hp = target.maxHp - 2;
    const out = applyHeal(ctx, { type: "heal", amount: 10 }, [target]);
    expect(out[target.uid]).toBe(2); // só curou o que faltava
    expect(target.hp).toBe(target.maxHp);
  });

  it("não cura quem não está vivo", () => {
    const { target, ctx } = setup();
    target.alive = false;
    target.hp = 0;
    const out = applyHeal(ctx, { type: "heal", amount: 10 }, [target]);
    expect(out[target.uid]).toBe(0);
    expect(target.hp).toBe(0);
  });

  it("propaga uma fração da cura ao parceiro de Elo de cura (Corrente de Vida)", () => {
    const { game, attacker, target, ctx } = setup();
    const partner = game.teams.B.champions[1];
    applyLink(ctx, { type: "link", share_heal_percent: 50, duration: { unit: "rounds", value: 2 } }, [partner]);
    target.hp = target.maxHp; // já no máximo, só o parceiro deve se curar
    partner.hp = partner.maxHp - 10;
    applyHeal(ctx, { type: "heal", amount: 6 }, [attacker]);
    expect(partner.hp).toBe(partner.maxHp - 10); // ninguém curou o attacker ainda, então nada propagou
  });

  it("de fato propaga quando quem recebeu a cura tem o Elo", () => {
    const { attacker, target, ctx } = setup();
    applyLink(ctx, { type: "link", share_heal_percent: 50, duration: { unit: "rounds", value: 2 } }, [target]);
    attacker.hp = attacker.maxHp; // attacker tá cheio, não é ele quem recebe a cura aqui
    target.hp = target.maxHp - 10;
    applyHeal(ctx, { type: "heal", amount: 10 }, [attacker]); // cura 0 no attacker (já cheio) -> nada propaga
    expect(target.hp).toBe(target.maxHp - 10);

    attacker.hp = attacker.maxHp - 10;
    applyHeal(ctx, { type: "heal", amount: 6 }, [attacker]); // cura 6 no attacker -> propaga 3 (50%) pro target
    expect(attacker.hp).toBe(attacker.maxHp - 4);
    expect(target.hp).toBe(target.maxHp - 7);
  });
});

describe("applyShield", () => {
  it("soma escudo em vez de substituir", () => {
    const { target } = setup();
    target.shield = 2;
    applyShield({ type: "shield", amount: 5 }, [target]);
    expect(target.shield).toBe(7);
  });

  it("reflect_amount define o reflexo do campeão", () => {
    const { target } = setup();
    applyShield({ type: "shield", amount: 5, reflect_amount: 2 }, [target]);
    expect(target.reflect).toBe(2);
  });
});

describe("remove_negative_effects / remove_positive_effects", () => {
  it("remove só os negativos quando all=true", () => {
    const { target, ctx } = setup();
    addStatus(target, ctx.nextId(), "stun", "champion_turns", 1, { negative: true });
    addStatus(target, ctx.nextId(), "damage_buff", "rounds", 2, { amount: 1, negative: false });
    applyRemoveNegativeEffects({ type: "remove_negative_effects", all: true }, [target]);
    expect(hasStatus(target, "stun")).toBe(false);
    expect(hasStatus(target, "damage_buff")).toBe(true);
  });

  it("remove só os positivos (Dissonância da Aurelia)", () => {
    const { target, ctx } = setup();
    addStatus(target, ctx.nextId(), "damage_buff", "rounds", 2, { amount: 1, negative: false });
    addStatus(target, ctx.nextId(), "stun", "champion_turns", 1, { negative: true });
    applyRemovePositiveEffects({ type: "remove_positive_effects", all: true }, [target]);
    expect(hasStatus(target, "damage_buff")).toBe(false);
    expect(hasStatus(target, "stun")).toBe(true);
  });
});

describe("grant_personal_mana / drain_personal_mana", () => {
  it("soma e subtrai mana pessoal, sem passar de 0", () => {
    const { target } = setup();
    applyPersonalMana({ type: "grant_personal_mana", amount: 5 }, [target], 1);
    expect(target.personalMana).toBe(5);
    applyPersonalMana({ type: "drain_personal_mana", amount: 20 }, [target], -1);
    expect(target.personalMana).toBe(0);
  });
});

describe("applyEffectV2 — tipo desconhecido", () => {
  it("lança erro claro pra um tipo ainda não implementado", () => {
    const { target, ctx } = setup();
    expect(() => applyEffectV2(ctx, { type: "venom_zone", radius: 2 }, [target])).toThrow(/não implementado/);
  });
});
