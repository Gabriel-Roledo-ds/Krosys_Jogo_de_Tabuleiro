// Testes da geometria hexagonal (src/design/hexGrid.ts) — design-only, ver
// regras-e-decisoes.md §20.

import { describe, it, expect } from "vitest";
import {
  addHex,
  hexAdjacent,
  hexCountInRadius,
  hexDistance,
  hexesInRadius,
  hexKey,
  hexLine,
  hexNeighbors,
  sameHex,
  HEX_DIRECTIONS,
} from "../src/design/hexGrid";

describe("coordenadas básicas", () => {
  it("sameHex e hexKey", () => {
    expect(sameHex({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
    expect(sameHex({ q: 1, r: 2 }, { q: 1, r: 3 })).toBe(false);
    expect(hexKey({ q: -1, r: 2 })).toBe("-1,2");
  });

  it("addHex soma componente a componente", () => {
    expect(addHex({ q: 1, r: 1 }, { q: -2, r: 3 })).toEqual({ q: -1, r: 4 });
  });

  it("toda casa tem exatamente 6 vizinhas, todas a distância 1", () => {
    expect(HEX_DIRECTIONS).toHaveLength(6);
    const center = { q: 3, r: -2 };
    const neighbors = hexNeighbors(center);
    expect(neighbors).toHaveLength(6);
    expect(new Set(neighbors.map(hexKey)).size).toBe(6); // todas distintas
    for (const n of neighbors) {
      expect(hexDistance(center, n)).toBe(1);
      expect(hexAdjacent(center, n)).toBe(true);
    }
  });
});

describe("distância", () => {
  it("distância da casa a ela mesma é 0", () => {
    expect(hexDistance({ q: 5, r: -5 }, { q: 5, r: -5 })).toBe(0);
  });

  it("distância é simétrica", () => {
    const a = { q: 0, r: 0 };
    const b = { q: 4, r: -2 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });

  it("casos conhecidos", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2);
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 2 })).toBe(2);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -2 })).toBe(2);
    expect(hexDistance({ q: 0, r: 0 }, { q: -3, r: 1 })).toBe(3);
  });
});

describe("hexesInRadius / hexCountInRadius", () => {
  it("raio 0 é só o centro", () => {
    const cells = hexesInRadius({ q: 0, r: 0 }, 0);
    expect(cells).toEqual([{ q: 0, r: 0 }]);
  });

  it("contagem bate com a fórmula fechada (1 + 3r(r+1)) para raios 1 a 5", () => {
    for (let r = 1; r <= 5; r++) {
      const cells = hexesInRadius({ q: 0, r: 0 }, r);
      expect(cells, `raio ${r}`).toHaveLength(hexCountInRadius(r));
    }
  });

  it("toda casa retornada está de fato dentro do raio", () => {
    const center = { q: 2, r: -1 };
    const radius = 4;
    const cells = hexesInRadius(center, radius);
    for (const c of cells) {
      expect(hexDistance(center, c)).toBeLessThanOrEqual(radius);
    }
  });
});

describe("hexLine (linha de visão)", () => {
  it("linha da casa pra ela mesma é vazia", () => {
    expect(hexLine({ q: 1, r: 1 }, { q: 1, r: 1 })).toEqual([]);
  });

  it("linha reta na direção de um vizinho tem 1 casa (ele mesmo)", () => {
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    expect(hexLine(a, b)).toEqual([b]);
  });

  it("tamanho da linha é igual à distância, e o último elemento é sempre o destino", () => {
    const a = { q: -2, r: 3 };
    const b = { q: 4, r: -1 };
    const line = hexLine(a, b);
    expect(line).toHaveLength(hexDistance(a, b));
    expect(line[line.length - 1]).toEqual(b);
  });

  it("cada passo da linha é adjacente ao anterior (linha contígua, sem pulos)", () => {
    const a = { q: 0, r: 0 };
    const b = { q: 5, r: -3 };
    const line = [a, ...hexLine(a, b)];
    for (let i = 1; i < line.length; i++) {
      expect(hexAdjacent(line[i - 1], line[i]), `passo ${i}`).toBe(true);
    }
  });
});
