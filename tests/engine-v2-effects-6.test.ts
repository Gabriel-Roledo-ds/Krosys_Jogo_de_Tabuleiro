// Testes de resurrect/death_ward (item 5 da ordem de execução) no motor
// hexagonal (roster v2) — src/engine-v2/effects.ts + death.ts. Ver KANBAN.md.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { applyResurrect, applyDeathWard, type EffectContextV2 } from "../src/engine-v2/effects";
import { killChampionV2 } from "../src/engine-v2/death";
import { hasStatus } from "../src/engine-v2/status";
import { playCardV2 } from "../src/engine-v2/cardPlay";

function ctxFor(game: ReturnType<typeof createGameV2>, attacker: ReturnType<typeof createGameV2>["teams"]["A"]["champions"][number]): EffectContextV2 {
  return { game, attacker, nextId: () => nextIdV2(game) };
}

describe("applyResurrect", () => {
  it("traz o aliado morto de volta na hora, com a % de vida do rank, e marca resurrectUsed", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const dead = game.teams.A.champions[1];
    killChampionV2(game, dead);
    expect(dead.alive).toBe(false);
    const outTurnsBefore = dead.outTurns;
    expect(outTurnsBefore).toBeGreaterThan(0);

    const ctx = ctxFor(game, owner);
    applyResurrect(ctx, { type: "resurrect", hp_percent: 50 }, [dead]);

    expect(dead.alive).toBe(true);
    expect(dead.hp).toBe(Math.round(dead.maxHp * 0.5));
    expect(dead.outTurns).toBe(0); // não espera mais, voltou na hora
    expect(dead.untargetable).toBe(true);
    expect(game.teams.A.resurrectUsed).toBe(true);
  });

  it("sem alvo (lista vazia), não faz nada", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const ctx = ctxFor(game, owner);
    expect(() => applyResurrect(ctx, { type: "resurrect", hp_percent: 100 }, [])).not.toThrow();
    expect(game.teams.A.resurrectUsed).toBe(false);
  });
});

describe("applyDeathWard + killChampionV2", () => {
  it("concede o status com dano/raio da carta", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const ctx = ctxFor(game, owner);
    applyDeathWard(ctx, { type: "death_ward", explode_damage: 8, explode_radius: 2 }, [owner]);
    expect(hasStatus(owner, "death_ward")).toBe(true);
    const status = owner.statuses.find((s) => s.status === "death_ward")!;
    expect(status.amount).toBe(8);
    expect(status.radius).toBe(2);
  });

  it("consome o status e sobrevive com 1hp, explodindo dano nos inimigos ao redor (fogo amigo incluso)", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const ally = game.teams.A.champions[1];
    const enemy = game.teams.B.champions[0];
    const farEnemy = game.teams.B.champions[1];
    ally.pos = { ...owner.pos, q: owner.pos.q + 1 };
    enemy.pos = { ...owner.pos, q: owner.pos.q + 1, r: owner.pos.r + 1 }; // hex vizinho de owner, dentro do raio 2
    farEnemy.pos = { q: owner.pos.q + 20, r: owner.pos.r };
    for (const c of [ally, enemy, farEnemy]) c.defense = 0;

    const ctx = ctxFor(game, owner);
    applyDeathWard(ctx, { type: "death_ward", explode_damage: 8, explode_radius: 2 }, [owner]);

    owner.hp = 0;
    killChampionV2(game, owner);

    expect(owner.alive).toBe(true);
    expect(owner.hp).toBe(1);
    expect(hasStatus(owner, "death_ward")).toBe(false);
    expect(ally.hp).toBe(ally.maxHp - 8); // fogo amigo
    expect(enemy.hp).toBe(enemy.maxHp - 8);
    expect(farEnemy.hp).toBe(farEnemy.maxHp); // fora do raio

    // Sem o status, a próxima morte é de verdade.
    owner.hp = 0;
    killChampionV2(game, owner);
    expect(owner.alive).toBe(false);
  });
});

describe("integração via playCardV2 — Ressurgir e Fênix Momentânea", () => {
  it("selene_ressurgir traz o aliado de volta e bloqueia um 2º uso na mesma partida", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const dead = game.teams.A.champions.find((c) => c.defId === "niara")!;
    dead.pos = { ...selene.pos, q: selene.pos.q + 1 }; // irrelevante pro alvo, mas mantém coerência
    killChampionV2(game, dead);
    game.teams.A.mana = 10;
    const card1 = { uid: "c1", cardId: "selene_ressurgir", owner: selene.uid };
    game.teams.A.hand.push(card1);

    playCardV2(game, "A", card1.uid, 3, { uid: dead.uid });
    expect(dead.alive).toBe(true);
    expect(dead.hp).toBe(dead.maxHp); // rank 3: 100%
    expect(game.teams.A.resurrectUsed).toBe(true);

    killChampionV2(game, dead);
    game.teams.A.mana = 10;
    const card2 = { uid: "c2", cardId: "selene_ressurgir", owner: selene.uid };
    game.teams.A.hand.push(card2);
    expect(() => playCardV2(game, "A", card2.uid, 3, { uid: dead.uid })).toThrow(/Ressurgir já foi usado/);
  });

  it("ignira_fenix_momentanea concede death_ward que salva a Ignira na próxima morte", () => {
    const game = createGameV2(1, { comp: { A: ["ignira", "niara", "selene"], B: ["borak", "dorin", "aurelia"] } });
    const ignira = game.teams.A.champions.find((c) => c.defId === "ignira")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.pos = { ...ignira.pos, q: ignira.pos.q + 1 };
    borak.defense = 0;
    game.teams.A.mana = 10;
    const card = { uid: "c1", cardId: "ignira_fenix_momentanea", owner: ignira.uid };
    game.teams.A.hand.push(card);

    playCardV2(game, "A", card.uid, 2, {});
    expect(hasStatus(ignira, "death_ward")).toBe(true);

    ignira.hp = 0;
    killChampionV2(game, ignira);
    expect(ignira.alive).toBe(true);
    expect(ignira.hp).toBe(1);
    expect(borak.hp).toBe(borak.maxHp - 8); // explode_damage do rank 2
  });
});
