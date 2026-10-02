// Testes de status e dano do motor hexagonal (roster v2) — src/engine-v2/status.ts
// e src/engine-v2/damage.ts. Ver KANBAN.md ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import {
  addStatus,
  hasStatus,
  statusAmount,
  removeStatus,
  removeNegativeStatuses,
  removePositiveStatuses,
  tickStatuses,
} from "../src/engine-v2/status";
import { computeDamageV2, dealDamageV2 } from "../src/engine-v2/damage";

function freshChampion() {
  return createGameV2(1).teams.A.champions[0];
}

describe("status", () => {
  it("addStatus registra o status e statusAmount soma os amounts", () => {
    const c = freshChampion();
    addStatus(c, 1, "damage_buff", "rounds", 2, { amount: 3 });
    addStatus(c, 2, "damage_buff", "rounds", 1, { amount: 2 });
    expect(hasStatus(c, "damage_buff")).toBe(true);
    expect(statusAmount(c, "damage_buff")).toBe(5);
    expect(statusAmount(c, "stun")).toBe(0);
  });

  it("removeStatus remove todas as entradas daquele nome", () => {
    const c = freshChampion();
    addStatus(c, 1, "stun", "champion_turns", 1);
    addStatus(c, 2, "stun", "champion_turns", 2);
    expect(removeStatus(c, "stun")).toBe(2);
    expect(hasStatus(c, "stun")).toBe(false);
  });

  it("removeNegativeStatuses só afeta status marcados como negativos", () => {
    const c = freshChampion();
    addStatus(c, 1, "damage_buff", "rounds", 2, { amount: 2, negative: false });
    addStatus(c, 2, "stun", "champion_turns", 1, { negative: true });
    expect(removeNegativeStatuses(c, { all: true })).toBe(1);
    expect(hasStatus(c, "stun")).toBe(false);
    expect(hasStatus(c, "damage_buff")).toBe(true);
  });

  it("removePositiveStatuses só afeta status que não são negativos", () => {
    const c = freshChampion();
    addStatus(c, 1, "damage_buff", "rounds", 2, { amount: 2 });
    addStatus(c, 2, "stun", "champion_turns", 1, { negative: true });
    expect(removePositiveStatuses(c, { all: true })).toBe(1);
    expect(hasStatus(c, "damage_buff")).toBe(false);
    expect(hasStatus(c, "stun")).toBe(true);
  });

  it("tickStatuses reduz remaining e remove quando chega a 0", () => {
    const c = freshChampion();
    addStatus(c, 1, "stun", "champion_turns", 1);
    addStatus(c, 2, "damage_buff", "rounds", 2, { amount: 1 });
    tickStatuses(c, "champion_turns");
    expect(hasStatus(c, "stun")).toBe(false); // 1 -> 0, removido
    expect(hasStatus(c, "damage_buff")).toBe(true); // outra unidade, intacto
    tickStatuses(c, "rounds");
    expect(statusAmount(c, "damage_buff")).toBe(1); // 2 -> 1, ainda ativo
  });
});

describe("computeDamageV2 / dealDamageV2", () => {
  it("base 0 não causa dano", () => {
    const target = freshChampion();
    expect(computeDamageV2(null, target, 0)).toBe(0);
  });

  it("subtrai a defesa do alvo, com mínimo 1 se a base for >= 1", () => {
    const target = freshChampion();
    target.defense = 10;
    expect(computeDamageV2(null, target, 3)).toBe(1); // nunca cai a 0 com base >= 1
  });

  it("ignoreDefense ignora a defesa do alvo", () => {
    const target = freshChampion();
    target.defense = 3;
    expect(computeDamageV2(null, target, 5, { ignoreDefense: true })).toBe(5);
  });

  it("damage_buff do atacante e defense_buff do alvo entram na conta certa", () => {
    const attacker = freshChampion();
    const target = createGameV2(1).teams.B.champions[0];
    target.defense = 2;
    addStatus(attacker, 1, "damage_buff", "rounds", 2, { amount: 3 });
    addStatus(target, 1, "defense_buff", "rounds", 2, { amount: 1 });
    // base 5 + buff 3 - (defesa 2 + defense_buff 1) = 5
    expect(computeDamageV2(attacker, target, 5)).toBe(5);
  });

  it("dealDamageV2 reduz hp e não passa de 0 de dano quando computeDamageV2 é 0", () => {
    const target = freshChampion();
    const before = target.hp;
    const result = dealDamageV2(null, target, 0);
    expect(result.final).toBe(0);
    expect(target.hp).toBe(before);
  });

  it("escudo absorve antes da vida, e o excedente vai pra vida", () => {
    const target = freshChampion();
    target.shield = 3;
    const before = target.hp;
    const result = dealDamageV2(null, target, 5, { ignoreDefense: true });
    expect(result.absorbedByShield).toBe(3);
    expect(target.shield).toBe(0);
    expect(target.hp).toBe(before - 2);
  });

  it("ignoreShield ignora o escudo por completo", () => {
    const target = freshChampion();
    target.shield = 10;
    const before = target.hp;
    const result = dealDamageV2(null, target, 5, { ignoreDefense: true, ignoreShield: true });
    expect(result.absorbedByShield).toBe(0);
    expect(target.shield).toBe(10);
    expect(target.hp).toBe(before - 5);
  });

  it("escudo com reflect_amount devolve dano só quando absorve de verdade", () => {
    const target = freshChampion();
    target.shield = 5;
    target.reflect = 2;
    const result = dealDamageV2(null, target, 3, { ignoreDefense: true });
    expect(result.absorbedByShield).toBe(3);
    expect(result.reflectToAttacker).toBe(2);
  });

  it("marca lastHitBy quando há atacante", () => {
    const attacker = freshChampion();
    const target = createGameV2(1).teams.B.champions[0];
    dealDamageV2(attacker, target, 5, { ignoreDefense: true });
    expect(target.lastHitBy).toEqual({ team: attacker.team, champion: attacker.uid });
  });
});
