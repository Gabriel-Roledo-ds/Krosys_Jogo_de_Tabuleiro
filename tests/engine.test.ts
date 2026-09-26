import { describe, it, expect } from "vitest";
import { createRng } from "../src/engine/rng";
import { cellsInRadius, distance, inBounds, isAdjacent } from "../src/engine/board";
import { allChampions, createGame } from "../src/engine/state";
import { addMana, canPay, gainTurnMana, spendMana } from "../src/engine/mana";
import { calcMovement, moveChampion, occupantAt, reachableCells, rollMovementDie } from "../src/engine/movement";
import balance from "../data/balance.json";

const COMBO = ["enredador", "piromante", "atirador"];
const TATICO = ["arquiteto", "andarilho", "curandeiro"];
const newGame = (seed = 1) => createGame({ A: COMBO, B: TATICO }, seed);

describe("rng com seed", () => {
  it("mesma seed gera a mesma sequência", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("seeds diferentes geram sequências diferentes", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("dado de 8 lados sempre dá de 1 a 8 e usa todos os valores", () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = r.roll(8);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(8);
      seen.add(v);
    }
    expect(seen.size).toBe(8);
  });

  it("embaralhar mantém os mesmos itens e é reproduzível", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const s1 = createRng(9).shuffle(items);
    const s2 = createRng(9).shuffle(items);
    expect(s1).toEqual(s2);
    expect([...s1].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // original intacto
  });
});

describe("geometria", () => {
  it("diagonal conta como 1 casa", () => {
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(3);
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("adjacente inclui diagonais", () => {
    expect(isAdjacent({ x: 4, y: 4 }, { x: 5, y: 5 })).toBe(true);
    expect(isAdjacent({ x: 4, y: 4 }, { x: 6, y: 4 })).toBe(false);
  });

  it("raio 1 tem 9 casas e raio 2 tem 25", () => {
    expect(cellsInRadius({ x: 7, y: 7 }, 1, 15, 15)).toHaveLength(9);
    expect(cellsInRadius({ x: 7, y: 7 }, 2, 15, 15)).toHaveLength(25);
  });

  it("raio na borda é cortado pelo tabuleiro", () => {
    expect(cellsInRadius({ x: 0, y: 7 }, 1, 15, 15)).toHaveLength(4); // ponta esquerda do losango
    expect(inBounds({ x: 15, y: 0 }, 15, 15)).toBe(false);
  });

  it("o tabuleiro é um losango: só existem casas com |x-7|+|y-7| <= 7", () => {
    expect(inBounds({ x: 0, y: 7 }, 15, 15)).toBe(true);
    expect(inBounds({ x: 14, y: 7 }, 15, 15)).toBe(true);
    expect(inBounds({ x: 7, y: 0 }, 15, 15)).toBe(true);
    expect(inBounds({ x: 0, y: 0 }, 15, 15)).toBe(false);
    expect(inBounds({ x: 1, y: 1 }, 15, 15)).toBe(false);
    let n = 0;
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (inBounds({ x, y }, 15, 15)) n++;
    expect(n).toBe(113);
  });
});

describe("preparação da partida", () => {
  it("tabuleiro 15x15 com boss no centro (7,7) com 40 de vida", () => {
    const s = newGame();
    expect([s.width, s.height]).toEqual([15, 15]);
    expect(s.boss.pos).toEqual({ x: 7, y: 7 });
    expect(s.boss.hp).toBe(40);
    expect(s.boss.defense).toBe(1);
  });

  it("cada equipe tem 3 campeões com HP e defesa da ficha", () => {
    const s = newGame();
    expect(s.teams.A.champions.map((c) => c.defId)).toEqual(COMBO);
    expect(s.teams.B.champions.map((c) => c.defId)).toEqual(TATICO);
    const arq = s.teams.B.champions.find((c) => c.defId === "arquiteto")!;
    expect([arq.hp, arq.maxHp, arq.defense]).toEqual([20, 20, 2]);
  });

  it("campeões largam dentro da área da própria equipe, sem casas repetidas", () => {
    const s = newGame();
    for (const team of ["A", "B"] as const) {
      const area = balance.teams.start_areas[team].map((p) => `${p.x},${p.y}`);
      for (const c of s.teams[team].champions) expect(area).toContain(`${c.pos.x},${c.pos.y}`);
    }
    const cells = allChampions(s).map((c) => `${c.pos.x},${c.pos.y}`);
    expect(new Set(cells).size).toBe(6);
  });

  it("equipe A à esquerda e B à direita do boss", () => {
    const s = newGame();
    for (const c of s.teams.A.champions) expect(c.pos.x).toBeLessThan(s.boss.pos.x);
    for (const c of s.teams.B.champions) expect(c.pos.x).toBeGreaterThan(s.boss.pos.x);
  });

  it("10 monstros vivos e mana inicial 0", () => {
    const s = newGame();
    expect(s.monsters).toHaveLength(10);
    expect(s.monsters.every((m) => m.alive)).toBe(true);
    expect(s.teams.A.mana).toBe(0);
    expect(s.teams.B.mana).toBe(0);
  });

  it("recusa equipe com número errado de campeões", () => {
    expect(() => createGame({ A: ["atirador"], B: TATICO }, 1)).toThrow();
  });
});

describe("mana compartilhada", () => {
  it("ganha +2 por turno", () => {
    const s = newGame();
    expect(gainTurnMana(s, "A")).toBe(2);
    expect(gainTurnMana(s, "A")).toBe(4);
    expect(s.teams.B.mana).toBe(0); // outra equipe não muda
  });

  it("não passa do teto de 10", () => {
    const s = newGame();
    for (let i = 0; i < 15; i++) gainTurnMana(s, "A");
    expect(s.teams.A.mana).toBe(10);
    expect(addMana(s, "A", 5)).toBe(10);
  });

  it("gasta mana e recusa quando falta", () => {
    const s = newGame();
    addMana(s, "A", 3);
    expect(canPay(s, "A", 3)).toBe(true);
    expect(canPay(s, "A", 4)).toBe(false);
    expect(spendMana(s, "A", 2)).toBe(1);
    expect(() => spendMana(s, "A", 2)).toThrow(/insuficiente/);
    expect(s.teams.A.mana).toBe(1); // falha não gasta nada
  });
});

describe("dado e cálculo de casas", () => {
  it("rola de 1 a 8 e é reproduzível pela seed", () => {
    const rolls1 = Array.from({ length: 5 }, ((s) => () => rollMovementDie(s))(newGame(5)));
    const rolls2 = Array.from({ length: 5 }, ((s) => () => rollMovementDie(s))(newGame(5)));
    expect(rolls1).toEqual(rolls2);
    for (const r of rolls1) expect(r).toBeGreaterThanOrEqual(1);
    for (const r of rolls1) expect(r).toBeLessThanOrEqual(8);
  });

  it("soma bônus e subtrai penalidade, mínimo 0", () => {
    expect(calcMovement(5)).toBe(5);
    expect(calcMovement(5, 1)).toBe(6); // Passo Ágil +1
    expect(calcMovement(5, 3, 2)).toBe(6);
    expect(calcMovement(2, 0, 5)).toBe(0);
  });
});

describe("movimento", () => {
  it("anda em 8 direções, diagonal custa 1", () => {
    const s = newGame();
    const c = s.teams.A.champions[0];
    c.pos = { x: 5, y: 5 };
    const cells = reachableCells(s, c, 1);
    expect(cells).toHaveLength(8);
    expect(cells).toContainEqual({ x: 6, y: 6 });
  });

  it("é até o valor: alcança tudo a distância N ou menos, e nada além", () => {
    const s = newGame();
    const c = s.teams.A.champions[0];
    c.pos = { x: 5, y: 2 };
    s.monsters.forEach((m) => (m.alive = false));
    const cells = reachableCells(s, c, 3);
    expect(cells.every((p) => distance(c.pos, p) <= 3)).toBe(true);
    expect(cells).toContainEqual({ x: 5, y: 3 }); // andar menos é permitido
    expect(cells).toContainEqual({ x: 8, y: 5 });
    expect(cells).not.toContainEqual({ x: 9, y: 2 });
  });

  it("não sai do tabuleiro", () => {
    const s = newGame();
    const c = s.teams.A.champions[0];
    c.pos = { x: 0, y: 0 };
    const cells = reachableCells(s, c, 2);
    expect(cells.every((p) => inBounds(p, 15, 15))).toBe(true);
  });

  it("campeões são sólidos: não se para nem se atravessa", () => {
    const s = newGame();
    const [a1, a2] = s.teams.A.champions;
    a1.pos = { x: 5, y: 5 };
    a2.pos = { x: 6, y: 5 };
    s.monsters.forEach((m) => (m.alive = false));
    const cells = reachableCells(s, a1, 1);
    expect(cells).not.toContainEqual({ x: 6, y: 5 });
    expect(() => moveChampion(s, a1, { x: 6, y: 5 }, 3)).toThrow(/inválido/);
  });

  it("parede de sólidos bloqueia a passagem", () => {
    const s = newGame();
    const [a1, a2, a3] = s.teams.A.champions;
    const b = s.teams.B.champions[0];
    s.monsters.forEach((m) => (m.alive = false));
    a1.pos = { x: 5, y: 5 };
    // Coluna x=6 do y=4 ao y=6 ocupada (3 campeões): destino atrás dela fica inalcançável com 2 passos
    a2.pos = { x: 6, y: 4 };
    a3.pos = { x: 6, y: 5 };
    b.pos = { x: 6, y: 6 };
    const cells = reachableCells(s, a1, 2);
    // Só dá para chegar em x=7 contornando por fora da coluna, o que custa mais de 2 passos
    expect(cells.filter((p) => p.x >= 7)).toHaveLength(0);
  });

  it("monstros e boss são sólidos", () => {
    const s = newGame();
    const c = s.teams.A.champions[0];
    c.pos = { x: 7, y: 5 }; // perto do boss em (7,7)
    s.monsters.forEach((m) => (m.alive = false));
    expect(occupantAt(s, { x: 7, y: 7 })).toBe("boss");
    expect(reachableCells(s, c, 2)).not.toContainEqual({ x: 7, y: 7 });

    const m = s.monsters[0];
    m.alive = true;
    m.pos = { x: 8, y: 5 };
    expect(occupantAt(s, m.pos)).toBe("monster");
    expect(reachableCells(s, c, 1)).not.toContainEqual({ x: 8, y: 5 });
  });

  it("monstro morto libera a casa", () => {
    const s = newGame();
    const m = s.monsters[0];
    m.alive = false;
    expect(occupantAt(s, m.pos)).toBeNull();
  });

  it("passiva do Andarilho atravessa aliados, mas não para em cima deles", () => {
    const s = newGame();
    const [a1, a2] = s.teams.A.champions;
    s.monsters.forEach((m) => (m.alive = false));
    a1.pos = { x: 5, y: 5 };
    a2.pos = { x: 6, y: 5 };
    // Corredor: monstros em (6,4) e (6,6) impedem contornar o aliado em 2 passos
    s.monsters[0].alive = true;
    s.monsters[0].pos = { x: 6, y: 4 };
    s.monsters[1].alive = true;
    s.monsters[1].pos = { x: 6, y: 6 };
    const sem = reachableCells(s, a1, 2);
    const com = reachableCells(s, a1, 2, { passThroughAllies: true });
    expect(sem).not.toContainEqual({ x: 7, y: 5 });
    expect(com.length).toBeGreaterThan(sem.length);
    expect(com).not.toContainEqual({ x: 6, y: 5 });
    expect(com).toContainEqual({ x: 7, y: 5 }); // depois do aliado
  });

  it("aliado atravessável, inimigo não", () => {
    const s = newGame();
    const a1 = s.teams.A.champions[0];
    const b1 = s.teams.B.champions[0];
    s.monsters.forEach((m) => (m.alive = false));
    a1.pos = { x: 5, y: 5 };
    b1.pos = { x: 6, y: 5 };
    // Linha direta bloqueada pelo inimigo; com passThroughAllies continua bloqueada
    const cells = reachableCells(s, a1, 1, { passThroughAllies: true });
    expect(cells).not.toContainEqual({ x: 6, y: 5 });
  });

  it("andar 0 casas é permitido e andar além do valor lança erro", () => {
    const s = newGame();
    const c = s.teams.A.champions[0];
    c.pos = { x: 5, y: 2 };
    s.monsters.forEach((m) => (m.alive = false));
    moveChampion(s, c, { x: 5, y: 2 }, 0);
    expect(c.pos).toEqual({ x: 5, y: 2 });
    moveChampion(s, c, { x: 7, y: 4 }, 3);
    expect(c.pos).toEqual({ x: 7, y: 4 });
    expect(() => moveChampion(s, c, { x: 12, y: 4 }, 3)).toThrow(/inválido/);
    expect(c.pos).toEqual({ x: 7, y: 4 }); // não moveu
  });
});
