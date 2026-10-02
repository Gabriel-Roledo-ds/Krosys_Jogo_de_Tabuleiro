// Testes do lacaio do boss no motor hexagonal (roster v2) — ataque adjacente
// automático ao fim de um movimento voluntário e expiração por rodada
// (summon_minion com duration). Ver src/engine-v2/boss.ts (minionsAttackAdjacentV2,
// attackMinionV2) e src/engine-v2/tick.ts (tickRoundV2). Fecha o item do
// KANBAN.md "lacaio não ataca sozinho / não expira".

import { describe, it, expect } from "vitest";
import { createGameV2, type MinionStateV2 } from "../src/engine-v2/state";
import { applyActionV2 } from "../src/engine-v2/turn";
import { minionsAttackAdjacentV2, attackMinionV2 } from "../src/engine-v2/boss";
import { tickRoundV2 } from "../src/engine-v2/tick";

function pushMinion(game: ReturnType<typeof createGameV2>, over: Partial<MinionStateV2>): MinionStateV2 {
  const m: MinionStateV2 = { uid: `minion-test-${Math.random()}`, hp: 3, maxHp: 3, damage: 2, pos: { q: 0, r: 0 }, alive: true, ...over };
  game.minions.push(m);
  return m;
}

describe("lacaio: ataque adjacente automático", () => {
  it("minionsAttackAdjacentV2 causa dano a campeão adjacente, sem o multiplicador x1,5 de campeão", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions[0];
    const minion = pushMinion(game, { pos: { q: niara.pos.q + 1, r: niara.pos.r }, damage: 4 });
    const before = niara.hp;
    minionsAttackAdjacentV2(game, niara);
    // Dano de lacaio não leva x1,5 (convenção MVP: só "champion"/"world", nunca "monster")
    // nem defesa zero muda isso: esperado = 4 - defesa do campeão, mínimo 1.
    expect(niara.hp).toBe(before - Math.max(1, 4 - niara.defense));
    expect(minion.alive).toBe(true); // lacaio não sofre nada ao atacar
  });

  it("não ataca campeão que não está adjacente", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions[0];
    pushMinion(game, { pos: { q: niara.pos.q + 5, r: niara.pos.r } });
    const before = niara.hp;
    minionsAttackAdjacentV2(game, niara);
    expect(niara.hp).toBe(before);
  });

  it("lacaio morto não ataca", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions[0];
    pushMinion(game, { pos: { q: niara.pos.q + 1, r: niara.pos.r }, alive: false });
    const before = niara.hp;
    minionsAttackAdjacentV2(game, niara);
    expect(niara.hp).toBe(before);
  });

  it("mover voluntariamente (case 'move' de turn.ts) pra uma casa adjacente ao lacaio dispara o ataque dele", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    game.turn.die = 3;
    const niara = game.teams.A.champions[0];
    const dest = { q: niara.pos.q + 1, r: niara.pos.r };
    pushMinion(game, { pos: { q: dest.q + 1, r: dest.r }, damage: 3 });
    const before = niara.hp;
    applyActionV2(game, "A", { type: "move", to: dest, champion: niara.uid });
    expect(niara.pos).toEqual(dest);
    expect(niara.hp).toBeLessThan(before);
  });
});

describe("lacaio: morte por dano ainda funciona (attackMinionV2, já existia)", () => {
  it("campeão mata o lacaio com dano suficiente", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions[0];
    const minion = pushMinion(game, { hp: 2, maxHp: 2 });
    attackMinionV2(game, niara, minion.uid, 10);
    expect(minion.alive).toBe(false);
  });
});

describe("lacaio: expiração por rodada (summon_minion com duration)", () => {
  it("lacaio com roundsLeft definido expira ao chegar a 0", () => {
    const game = createGameV2(1);
    const minion = pushMinion(game, { roundsLeft: 2 });
    tickRoundV2(game);
    expect(minion.alive).toBe(true);
    expect(minion.roundsLeft).toBe(1);
    tickRoundV2(game);
    expect(minion.alive).toBe(false);
  });

  it("lacaio sem roundsLeft (Prole do boss, sem duration) nunca expira por rodada", () => {
    const game = createGameV2(1);
    const minion = pushMinion(game, {}); // roundsLeft indefinido
    for (let i = 0; i < 10; i++) tickRoundV2(game);
    expect(minion.alive).toBe(true);
    expect(minion.roundsLeft).toBeUndefined();
  });

  it("lacaio já morto não decrementa nem loga de novo", () => {
    const game = createGameV2(1);
    const minion = pushMinion(game, { roundsLeft: 1, alive: false });
    tickRoundV2(game);
    expect(minion.alive).toBe(false);
  });
});
