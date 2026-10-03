// Testes de visão limitada por campeão e neblina de guerra (roster v2) —
// liga src/design/fieldOfVision.ts ao motor de verdade. Ver KANBAN.md item 39
// e regras-e-decisoes.md §20.

import { describe, it, expect } from "vitest";
import { balance } from "../src/engine/data";
import { createGameV2 } from "../src/engine-v2/state";
import { startGameV2 } from "../src/engine-v2/turn";
import { knownCellKeysV2, teamVisibleHexesV2, teamVisionViewV2, updateVisionMemoryV2, visionRadiusV2, visibleHexesFromV2 } from "../src/engine-v2/vision";
import { hexDistance, hexKey } from "../src/design/hexGrid";
import { viewForV2 } from "../src/server/view-v2";

describe("visionRadiusV2", () => {
  it("vem de balance.vision_v2.default_radius, não fixo no código", () => {
    expect(visionRadiusV2()).toBe(balance.vision_v2.default_radius);
  });
});

describe("visibleHexesFromV2", () => {
  it("só vê até o raio, e não vê nada fora do tabuleiro", () => {
    const game = createGameV2(1);
    const hexes = visibleHexesFromV2(game, { q: 0, r: 0 }, 4);
    expect(hexes.every((h) => hexDistance(h, { q: 0, r: 0 }) <= 4)).toBe(true);
    expect(hexes.every((h) => h.q >= 0 && h.r >= 0)).toBe(true);
  });

  it("parede bloqueia o que está atrás dela na mesma linha, mas a própria casa da parede é visível", () => {
    const game = createGameV2(1);
    game.walls.push({ id: 1, pos: { q: 2, r: 0 }, hp: 2, team: "A", remaining: null });
    const hexes = visibleHexesFromV2(game, { q: 0, r: 0 }, 4);
    const keys = new Set(hexes.map(hexKey));
    expect(keys.has("2,0")).toBe(true); // a parede em si
    expect(keys.has("3,0")).toBe(false); // bloqueado atrás dela
  });

  it("campeão e monstro NÃO bloqueiam visão (mesma regra de linha de visão de carta)", () => {
    const game = createGameV2(1);
    const blocker = game.teams.B.champions[0];
    blocker.pos = { q: 2, r: 0 };
    const hexes = visibleHexesFromV2(game, { q: 0, r: 0 }, 4);
    expect(hexes.some((h) => h.q === 3 && h.r === 0)).toBe(true);
  });
});

describe("teamVisibleHexesV2", () => {
  it("é a união da visão de todos os campeões vivos da equipe", () => {
    const game = createGameV2(1);
    const visible = teamVisibleHexesV2(game, "A");
    const keys = new Set(visible.map(hexKey));
    for (const c of game.teams.A.champions) expect(keys.has(hexKey(c.pos))).toBe(true);
  });

  it("campeão morto não contribui com visão", () => {
    const game = createGameV2(1);
    for (const c of game.teams.A.champions) c.alive = false;
    expect(teamVisibleHexesV2(game, "A")).toHaveLength(0);
  });
});

describe("updateVisionMemoryV2 / teamVisionViewV2 (neblina de guerra)", () => {
  it("acumula o que já foi visto, mesmo depois do campeão ir embora", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    c.pos = { q: 5, r: 5 };
    updateVisionMemoryV2(game);
    const seenKey = hexKey(c.pos);
    expect(game.exploredByTeam.A).toContain(seenKey);

    c.pos = { q: 0, r: 0 }; // vai embora
    updateVisionMemoryV2(game);
    const view = teamVisionViewV2(game, "A");
    expect(view.visible.some((h) => hexKey(h) === seenKey)).toBe(false); // não vê mais agora
    expect(view.explored.some((h) => hexKey(h) === seenKey)).toBe(true); // mas lembra
  });

  it("não mistura a memória das duas equipes", () => {
    const game = createGameV2(1);
    updateVisionMemoryV2(game);
    const aKeys = new Set(game.exploredByTeam.A);
    const bKeys = new Set(game.exploredByTeam.B);
    // os dois times começam em pontas opostas do rombo — nenhuma visão deveria se sobrepor com raio padrão
    for (const k of aKeys) expect(bKeys.has(k)).toBe(false);
  });

  it("startGameV2 já semeia a memória com a área de largada", () => {
    const game = createGameV2(1);
    expect(game.exploredByTeam.A).toHaveLength(0);
    startGameV2(game);
    expect(game.exploredByTeam.A.length).toBeGreaterThan(0);
    expect(game.exploredByTeam.B.length).toBeGreaterThan(0);
  });
});

describe("knownCellKeysV2", () => {
  it("inclui visível agora e explorado antes, nada mais", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    c.pos = { q: 2, r: 2 };
    updateVisionMemoryV2(game);
    const farKey = hexKey({ q: 2, r: 2 });
    c.pos = { q: 0, r: 0 };
    const known = knownCellKeysV2(game, "A");
    expect(known.has(farKey)).toBe(true); // explorado
    expect(known.has(hexKey(c.pos))).toBe(true); // visível agora
    expect(known.has(hexKey(game.boss.pos))).toBe(false); // boss está longe, nunca visto
  });
});

describe("viewForV2 — neblina de guerra na visão do jogador", () => {
  it("esconde monstro/parede/chão fora do conhecido da equipe, mas não esconde boss nem campeões", () => {
    const game = createGameV2(7, { comp: { A: ["niara", "varek", "selene"], B: ["borak", "dorin", "aurelia"] } });
    startGameV2(game);
    // Garante ao menos um monstro bem longe de qualquer campeão de A.
    const far = { q: game.boss.pos.q, r: game.boss.pos.r };
    game.monsters[0].pos = far;
    game.walls.push({ id: 99, pos: far, hp: 2, team: "A", remaining: null });
    game.ground.push({ id: 98, kind: "fire", pos: far, radius: 0, team: "A", remaining: 2, damagePerRound: 1 });

    const v: any = viewForV2(game, "A");
    expect(v.monsters.some((m: any) => m.pos.q === far.q && m.pos.r === far.r)).toBe(false);
    expect(v.walls.some((w: any) => w.pos.q === far.q && w.pos.r === far.r)).toBe(false);
    expect(v.ground.some((g: any) => g.pos.q === far.q && g.pos.r === far.r)).toBe(false);
    expect(typeof v.boss.deck).toBe("number"); // boss sempre presente
    expect(v.teams.B.champions.length).toBe(3); // campeões inimigos não são escondidos (pendente — item 39)
    expect(v.vision.radius).toBe(visionRadiusV2());
  });

  it("espectador (me = null) vê o mapa sem filtro de neblina", () => {
    const game = createGameV2(7, { comp: { A: ["niara", "varek", "selene"], B: ["borak", "dorin", "aurelia"] } });
    startGameV2(game);
    game.monsters[0].pos = { ...game.boss.pos };
    const v: any = viewForV2(game, null);
    expect(v.monsters.length).toBe(game.monsters.length);
    expect(v.vision).toBeNull();
  });

  it("depois de avistar um monstro ele continua aparecendo mesmo se a equipe for embora (monstro é estático)", () => {
    const game = createGameV2(7, { comp: { A: ["niara", "varek", "selene"], B: ["borak", "dorin", "aurelia"] } });
    startGameV2(game);
    const c = game.teams.A.champions[0];
    const monsterPos = { q: 5, r: 5 };
    game.monsters[0].pos = { ...monsterPos };
    c.pos = { ...monsterPos };
    updateVisionMemoryV2(game);
    expect((viewForV2(game, "A") as any).monsters.some((m: any) => m.pos.q === monsterPos.q && m.pos.r === monsterPos.r)).toBe(true);

    c.pos = { q: 0, r: 0 }; // volta pra largada, sem chamar updateVisionMemoryV2 de novo
    const v: any = viewForV2(game, "A");
    expect(v.monsters.some((m: any) => m.pos.q === monsterPos.q && m.pos.r === monsterPos.r)).toBe(true);
  });
});
