// Testes do formato do tabuleiro hexagonal (src/design/hexBoard.ts) — design-only,
// ver regras-e-decisoes.md §20: rombo alongado, duas pontas agudas (largada) e
// duas obtusas (cantos reservados pros templos de bênção, fora do caminho
// principal).

import { describe, it, expect } from "vitest";
import { hexDistance, hexKey } from "../src/design/hexGrid";
import {
  allBoardHexes,
  cornerPocketCells,
  hexBoard,
  inHexBoard,
  mainDiagonal,
  startAreaCells,
  tipToTipDistance,
} from "../src/design/hexBoard";

describe("forma do rombo", () => {
  it("o recorte axial tem exatamente q_size * r_size casas, todas distintas", () => {
    const cells = allBoardHexes();
    expect(cells).toHaveLength(hexBoard.q_size * hexBoard.r_size);
    expect(new Set(cells.map(hexKey)).size).toBe(cells.length);
  });

  it("é mais comprido no eixo das pontas agudas do que no outro (alongado)", () => {
    expect(hexBoard.q_size).toBeGreaterThan(hexBoard.r_size);
  });

  it("inHexBoard aceita só o que está dentro do retângulo axial", () => {
    expect(inHexBoard({ q: 0, r: 0 })).toBe(true);
    expect(inHexBoard({ q: hexBoard.q_size - 1, r: hexBoard.r_size - 1 })).toBe(true);
    expect(inHexBoard({ q: hexBoard.q_size, r: 0 })).toBe(false);
    expect(inHexBoard({ q: 0, r: -1 })).toBe(false);
  });
});

describe("boss no centro", () => {
  it("o boss está dentro do tabuleiro", () => {
    expect(inHexBoard(hexBoard.boss)).toBe(true);
  });

  it("o boss fica à mesma distância das duas pontas agudas (simétrico)", () => {
    const [tipA, tipB] = Object.values(hexBoard.start_areas).map((a) => a.tip);
    expect(hexDistance(hexBoard.boss, tipA)).toBe(hexDistance(hexBoard.boss, tipB));
  });
});

describe("áreas de largada (pontas agudas)", () => {
  it("existem exatamente 2 equipes com área de largada", () => {
    expect(Object.keys(hexBoard.start_areas)).toHaveLength(2);
  });

  it("as duas áreas têm o mesmo raio (simetria de regras) e ficam em cantos opostos do rombo", () => {
    const areas = Object.values(hexBoard.start_areas);
    expect(areas[0].radius).toBe(areas[1].radius);
    // cantos opostos do retângulo axial: (0,0) e (q_size-1, r_size-1)
    const tips = areas.map((a) => a.tip).sort((a, b) => a.q - b.q);
    expect(tips[0]).toEqual({ q: 0, r: 0 });
    expect(tips[1]).toEqual({ q: hexBoard.q_size - 1, r: hexBoard.r_size - 1 });
  });

  it("as células de largada das duas equipes têm a mesma quantidade (justo pro battle royale)", () => {
    const [keyA, keyB] = Object.keys(hexBoard.start_areas);
    expect(startAreaCells(keyA)).toHaveLength(startAreaCells(keyB).length);
  });
});

describe("cantos reservados (pontas obtusas) — futuros templos de bênção", () => {
  it("existem exatamente 2 cantos, com o mesmo raio", () => {
    expect(hexBoard.corner_pockets).toHaveLength(2);
    const [p1, p2] = hexBoard.corner_pockets;
    expect(p1.radius).toBe(p2.radius);
  });

  it("os dois cantos ficam à mesma distância do boss (simétricos)", () => {
    const [p1, p2] = hexBoard.corner_pockets;
    expect(hexDistance(hexBoard.boss, p1.center)).toBe(hexDistance(hexBoard.boss, p2.center));
  });

  it("os cantos ficam nos outros dois vértices do retângulo axial (as pontas obtusas)", () => {
    const centers = hexBoard.corner_pockets.map((p) => p.center).sort((a, b) => a.q - b.q);
    expect(centers[0]).toEqual({ q: 0, r: hexBoard.r_size - 1 });
    expect(centers[1]).toEqual({ q: hexBoard.q_size - 1, r: 0 });
  });

  it("células dos cantos não se misturam com as células de largada (áreas distintas)", () => {
    const [keyA, keyB] = Object.keys(hexBoard.start_areas);
    const startKeys = new Set([...startAreaCells(keyA), ...startAreaCells(keyB)].map(hexKey));
    for (const pocket of hexBoard.corner_pockets) {
      for (const cell of cornerPocketCells(pocket.name)) {
        expect(startKeys.has(hexKey(cell)), `${pocket.name} ${hexKey(cell)}`).toBe(false);
      }
    }
  });

  it("nenhuma célula de canto está na diagonal principal entre as duas largadas", () => {
    const pathKeys = new Set(mainDiagonal().map(hexKey));
    for (const pocket of hexBoard.corner_pockets) {
      for (const cell of cornerPocketCells(pocket.name)) {
        expect(pathKeys.has(hexKey(cell)), `${pocket.name} ${hexKey(cell)}`).toBe(false);
      }
    }
  });
});

describe("diagonal principal", () => {
  it("vai de ponta a ponta e passa perto do boss (distância <= raio de largada + 1)", () => {
    const path = mainDiagonal();
    // mainDiagonal inclui as duas pontas, então tem 1 casa a mais que a distância entre elas.
    expect(path.length).toBe(tipToTipDistance() + 1);
    const closest = Math.min(...path.map((h) => hexDistance(h, hexBoard.boss)));
    expect(closest).toBeLessThanOrEqual(1);
  });
});
