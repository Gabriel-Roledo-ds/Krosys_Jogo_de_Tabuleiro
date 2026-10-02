// Testes de alcance e validação de alvo no motor hexagonal (roster v2) —
// src/engine-v2/targeting.ts. Ver KANBAN.md ("Construir motor hexagonal").

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { validateTargetV2, enemiesInRange, inRangeOf, championsInRadius } from "../src/engine-v2/targeting";
import { isHexInLine, hexDistance } from "../src/design/hexGrid";

describe("isHexInLine", () => {
  it("duas casas na mesma das 6 direções estão em linha", () => {
    expect(isHexInLine({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(true);
    expect(isHexInLine({ q: 0, r: 0 }, { q: 0, r: 3 })).toBe(true);
    expect(isHexInLine({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(true);
  });

  it("casas fora de qualquer um dos 6 eixos não estão em linha", () => {
    expect(isHexInLine({ q: 0, r: 0 }, { q: 2, r: 1 })).toBe(false);
  });

  it("a mesma casa conta como em linha", () => {
    expect(isHexInLine({ q: 2, r: 3 }, { q: 2, r: 3 })).toBe(true);
  });
});

describe("validateTargetV2", () => {
  it("self não tem restrição", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    expect(validateTargetV2(game, owner, { range: "self", target: "self" }, {})).toBeNull();
  });

  it("enemy aceita um inimigo vivo ao alcance", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const enemy = game.teams.B.champions[0];
    enemy.pos = { ...owner.pos, q: owner.pos.q + 2 };
    expect(validateTargetV2(game, owner, { range: 3, target: "enemy" }, { uid: enemy.uid })).toBeNull();
  });

  it("enemy rejeita aliado", () => {
    const game = createGameV2(1);
    const [owner, ally] = game.teams.A.champions;
    expect(validateTargetV2(game, owner, { range: 3, target: "enemy" }, { uid: ally.uid })).toMatch(/inimigo/);
  });

  it("enemy rejeita fora de alcance", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const enemy = game.teams.B.champions[0];
    enemy.pos = { q: owner.pos.q + 10, r: owner.pos.r };
    expect(validateTargetV2(game, owner, { range: 3, target: "enemy" }, { uid: enemy.uid })).toMatch(/alcance/);
  });

  it("enemy rejeita alvo morto", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const enemy = game.teams.B.champions[0];
    enemy.pos = { ...owner.pos, q: owner.pos.q + 1 };
    enemy.alive = false;
    expect(validateTargetV2(game, owner, { range: 3, target: "enemy" }, { uid: enemy.uid })).toMatch(/em campo/);
  });

  it("ally aceita a si mesmo e outro aliado vivo ao alcance", () => {
    const game = createGameV2(1);
    const [owner, ally] = game.teams.A.champions;
    ally.pos = { ...owner.pos, q: owner.pos.q + 1 };
    expect(validateTargetV2(game, owner, { range: 3, target: "ally" }, { uid: owner.uid })).toBeNull();
    expect(validateTargetV2(game, owner, { range: 3, target: "ally" }, { uid: ally.uid })).toBeNull();
  });

  it("champion_in_line exige alinhamento num dos 6 eixos", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const enemy = game.teams.B.champions[0];
    enemy.pos = { q: owner.pos.q + 1, r: owner.pos.r + 1 }; // fora dos 6 eixos
    expect(validateTargetV2(game, owner, { range: 5, target: "champion_in_line" }, { uid: enemy.uid })).toMatch(/linha/);
    enemy.pos = { q: owner.pos.q + 2, r: owner.pos.r }; // na linha
    expect(validateTargetV2(game, owner, { range: 5, target: "champion_in_line" }, { uid: enemy.uid })).toBeNull();
  });

  it("direction só aceita uma das 6 direções hexagonais", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    expect(validateTargetV2(game, owner, { range: "self", target: "direction" }, { dir: { q: 1, r: 0 } })).toBeNull();
    expect(validateTargetV2(game, owner, { range: "self", target: "direction" }, { dir: { q: 2, r: 0 } })).toMatch(/direção/);
  });

  it("cell valida alcance e limites do tabuleiro", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const near = { q: owner.pos.q + 1, r: owner.pos.r };
    expect(validateTargetV2(game, owner, { range: 2, target: "cell" }, { pos: near })).toBeNull();
    const outOfBoard = { q: -5, r: -5 };
    expect(validateTargetV2(game, owner, { range: 50, target: "cell" }, { pos: outOfBoard })).toMatch(/alcance/);
  });

  it("two_cells exige as duas casas diferentes e dentro do alcance", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const a = { q: owner.pos.q + 1, r: owner.pos.r };
    const b = { q: owner.pos.q + 1, r: owner.pos.r + 1 };
    expect(validateTargetV2(game, owner, { range: 2, target: "two_cells" }, { pos: a, pos2: b })).toBeNull();
    expect(validateTargetV2(game, owner, { range: 2, target: "two_cells" }, { pos: a, pos2: a })).toMatch(/diferentes/);
  });

  it("wall e dead_ally avisam que ainda não estão implementados", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    expect(validateTargetV2(game, owner, { range: 3, target: "wall" }, {})).toMatch(/não implementado/);
    expect(validateTargetV2(game, owner, { range: 3, target: "dead_ally" }, {})).toMatch(/não implementado/);
  });
});

describe("enemiesInRange / inRangeOf", () => {
  it("enemiesInRange só lista inimigos vivos dentro do alcance", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const [e1, e2, e3] = game.teams.B.champions;
    e1.pos = { q: owner.pos.q + 1, r: owner.pos.r };
    e2.pos = { q: owner.pos.q + 10, r: owner.pos.r };
    e3.pos = { q: owner.pos.q + 1, r: owner.pos.r + 1 };
    e3.alive = false;
    const list = enemiesInRange(game, owner, { range: 3, target: "enemy" });
    expect(list.map((c) => c.uid)).toEqual([e1.uid]);
  });

  it("inRangeOf confere distância hexagonal real", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    const pos = { q: owner.pos.q + 2, r: owner.pos.r };
    expect(hexDistance(owner.pos, pos)).toBe(2);
    expect(inRangeOf(game, owner, pos, { range: 2, target: "cell" })).toBe(true);
    expect(inRangeOf(game, owner, pos, { range: 1, target: "cell" })).toBe(false);
  });
});

describe("championsInRadius", () => {
  it("lista só quem está dentro do raio, centro incluso", () => {
    const game = createGameV2(1);
    const center = { q: 5, r: 5 };
    const [inside, edge, outside] = game.teams.A.champions;
    inside.pos = { q: 5, r: 5 };
    edge.pos = { q: 7, r: 5 }; // distância 2
    outside.pos = { q: 9, r: 5 }; // distância 4
    const list = championsInRadius(game, center, 2);
    const uids = list.map((c) => c.uid);
    expect(uids).toContain(inside.uid);
    expect(uids).toContain(edge.uid);
    expect(uids).not.toContain(outside.uid);
  });

  it("ignora campeões mortos por padrão", () => {
    const game = createGameV2(1);
    const center = { q: 5, r: 5 };
    const dead = game.teams.A.champions[0];
    dead.pos = { ...center };
    dead.alive = false;
    expect(championsInRadius(game, center, 1).map((c) => c.uid)).not.toContain(dead.uid);
  });

  it("filtra por equipe e exclui um uid específico", () => {
    const game = createGameV2(1);
    const center = { q: 5, r: 5 };
    for (const c of [...game.teams.A.champions, ...game.teams.B.champions]) c.pos = { ...center };
    const onlyA = championsInRadius(game, center, 0, { team: "A" });
    expect(onlyA.every((c) => c.team === "A")).toBe(true);
    const caster = game.teams.A.champions[0];
    const withoutCaster = championsInRadius(game, center, 0, { excludeUid: caster.uid });
    expect(withoutCaster.map((c) => c.uid)).not.toContain(caster.uid);
  });
});
