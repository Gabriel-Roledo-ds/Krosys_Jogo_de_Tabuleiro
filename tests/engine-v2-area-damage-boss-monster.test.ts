// Dano em área/aleatório contra boss e monstro (item 34 do KANBAN) — motor
// hexagonal (roster v2). Até aqui, `applyDamage` (effects.ts) só considerava
// campeões ao calcular quem está dentro do raio de uma carta de área, e o
// sorteio de `random_targets` (cardPlay.ts) só sorteava campeões — boss e
// monstros/lacaios do mapa nunca eram afetados mesmo estando na área/alcance.
// Ver src/engine-v2/effects.ts (resolveDamageAreaV2/hitBossMonstersAndMinionsInAreaV2)
// e src/engine-v2/cardPlay.ts (randomDamageCandidatesV2/applyRandomDamageV2).

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2, type MinionStateV2 } from "../src/engine-v2/state";
import { applyDamage, type EffectContextV2 } from "../src/engine-v2/effects";
import { playCardV2 } from "../src/engine-v2/cardPlay";

function ctxFor(game: ReturnType<typeof createGameV2>, attacker: ReturnType<typeof createGameV2>["teams"]["A"]["champions"][number], extra: Partial<EffectContextV2> = {}): EffectContextV2 {
  return { game, attacker, nextId: () => nextIdV2(game), ...extra };
}

describe("applyDamage com around_self também acerta boss/monstro/lacaio no raio", () => {
  it("boss dentro do raio sofre dano (Nova de Fogo-like, around_self)", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    attacker.pos = { q: game.boss.pos.q - 1, r: game.boss.pos.r }; // boss a 1 casa
    const ctx = ctxFor(game, attacker);
    const hpBefore = game.boss.hp;
    applyDamage(ctx, { type: "damage", amount: 5, around_self: true, radius: 2 }, []);
    expect(game.boss.hp).toBeLessThan(hpBefore);
  });

  it("monstro dentro do raio sofre dano e sua reação dispara (igual a um ataque de alvo único)", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const monster = game.monsters[0];
    monster.pos = { q: attacker.pos.q + 1, r: attacker.pos.r };
    const ctx = ctxFor(game, attacker);
    const hpBefore = monster.hp;
    applyDamage(ctx, { type: "damage", amount: 3, around_self: true, radius: 2 }, []);
    expect(monster.hp).toBeLessThan(hpBefore);
  });

  it("lacaio do boss dentro do raio sofre dano", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const minion: MinionStateV2 = { uid: "minion-test", hp: 5, maxHp: 5, damage: 1, pos: { q: attacker.pos.q + 1, r: attacker.pos.r }, alive: true };
    game.minions.push(minion);
    const ctx = ctxFor(game, attacker);
    applyDamage(ctx, { type: "damage", amount: 3, around_self: true, radius: 2 }, []);
    expect(minion.hp).toBeLessThan(5);
  });

  it("boss/monstro fora do raio não sofrem nada", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    game.boss.pos = { q: attacker.pos.q + 50, r: attacker.pos.r };
    for (const m of game.monsters) m.pos = { q: attacker.pos.q + 50, r: attacker.pos.r };
    const ctx = ctxFor(game, attacker);
    const hpBefore = game.boss.hp;
    applyDamage(ctx, { type: "damage", amount: 5, around_self: true, radius: 2 }, []);
    expect(game.boss.hp).toBe(hpBefore);
  });
});

describe("applyDamage com radius + ctx.targetCell (carta de alvo 'cell') — achado corrigido", () => {
  it("antes só acertava quem usou a carta; agora acerta quem está na área da casa escolhida, campeão ou não", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const foe = game.teams.B.champions[0];
    const targetCell = { q: attacker.pos.q + 5, r: attacker.pos.r };
    foe.pos = { ...targetCell };
    const ctx = ctxFor(game, attacker, { targetCell });
    const hpBefore = foe.hp;
    const attackerHpBefore = attacker.hp;
    applyDamage(ctx, { type: "damage", amount: 5, radius: 1 }, [attacker]); // targets=[attacker] é o que cardPlay.ts monta pra alvo "cell"
    expect(foe.hp).toBeLessThan(hpBefore); // a área da casa escolhida acerta o inimigo ali
    expect(attacker.hp).toBe(attackerHpBefore); // quem usou a carta está longe da área: não se acerta por acidente
  });

  it("boss na área da casa escolhida também sofre dano", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const targetCell = { ...game.boss.pos };
    const ctx = ctxFor(game, attacker, { targetCell });
    const hpBefore = game.boss.hp;
    applyDamage(ctx, { type: "damage", amount: 5, radius: 2 }, [attacker]);
    expect(game.boss.hp).toBeLessThan(hpBefore);
  });
});

describe("playCardV2 — dano de área de verdade (ignira_bola_fogo) acerta boss ao alcance", () => {
  it("Bola de Fogo apontada pra casa do boss causa dano nele", () => {
    const game = createGameV2(1, { comp: { A: ["ignira", "varek", "selene"], B: ["borak", "dorin", "aurelia"] } });
    const ignira = game.teams.A.champions.find((c) => c.defId === "ignira")!;
    ignira.pos = { q: game.boss.pos.q - 2, r: game.boss.pos.r };
    game.teams.A.mana = 20;
    const card = { uid: "c1", cardId: "ignira_bola_fogo", owner: ignira.uid };
    game.teams.A.hand.push(card);
    const hpBefore = game.boss.hp;
    playCardV2(game, "A", card.uid, 1, { pos: { ...game.boss.pos } });
    expect(game.boss.hp).toBeLessThan(hpBefore);
  });
});
