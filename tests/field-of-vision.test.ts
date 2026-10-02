// Testes da visão limitada por obstáculo (src/design/fieldOfVision.ts) — design-only,
// ver regras-e-decisoes.md §20: "sem obstáculos o campo de visão pode ser bem
// amplo", mas obstáculos bloqueiam o que está atrás deles.

import { describe, it, expect } from "vitest";
import { hexCountInRadius, hexDistance, hexKey, type Hex } from "../src/design/hexGrid";
import { computeVisibleHexes, mergeVisionMemory, type VisionContext } from "../src/design/fieldOfVision";

const openBoard = (origin: Hex, radius: number): VisionContext => ({
  origin,
  radius,
  inBounds: () => true,
  isSolid: () => false,
});

describe("sem obstáculos: campo de visão amplo = raio inteiro", () => {
  it("vê todas as casas dentro do raio quando nada bloqueia", () => {
    const origin = { q: 0, r: 0 };
    const radius = 5;
    const visible = computeVisibleHexes(openBoard(origin, radius));
    expect(visible).toHaveLength(hexCountInRadius(radius));
  });

  it("a própria casa de origem sempre está visível", () => {
    const origin = { q: 2, r: -2 };
    const visible = computeVisibleHexes(openBoard(origin, 3));
    expect(visible.some((h) => h.q === origin.q && h.r === origin.r)).toBe(true);
  });

  it("casas fora do raio não aparecem", () => {
    const origin = { q: 0, r: 0 };
    const visible = computeVisibleHexes(openBoard(origin, 2));
    for (const h of visible) {
      expect(hexDistance(origin, h)).toBeLessThanOrEqual(2);
    }
  });
});

describe("com obstáculo: bloqueia o que está atrás, mas o obstáculo em si é visível", () => {
  it("parede numa direção esconde as casas atrás dela nessa linha, sem afetar outras direções", () => {
    const origin = { q: 0, r: 0 };
    const wall: Hex = { q: 1, r: 0 }; // vizinho a leste
    const behindWall: Hex = { q: 2, r: 0 }; // mesma linha, atrás da parede
    const ctx: VisionContext = {
      origin,
      radius: 4,
      inBounds: () => true,
      isSolid: (h) => h.q === wall.q && h.r === wall.r,
    };
    const visible = computeVisibleHexes(ctx);
    const keys = new Set(visible.map(hexKey));

    expect(keys.has(hexKey(wall))).toBe(true); // a parede em si é vista
    expect(keys.has(hexKey(behindWall))).toBe(false); // o que está atrás, não

    // outra direção, sem obstáculo no caminho, continua visível normalmente
    const otherDirection: Hex = { q: 0, r: -2 };
    expect(keys.has(hexKey(otherDirection))).toBe(true);
  });

  it("casas fora de bounds nunca entram no resultado, mesmo dentro do raio", () => {
    const origin = { q: 0, r: 0 };
    const ctx: VisionContext = {
      origin,
      radius: 3,
      inBounds: (h) => h.q >= 0, // metade do mapa "não existe"
      isSolid: () => false,
    };
    const visible = computeVisibleHexes(ctx);
    expect(visible.every((h) => h.q >= 0)).toBe(true);
    expect(visible.some((h) => h.q < 0)).toBe(false);
  });
});

describe("mergeVisionMemory (neblina de guerra)", () => {
  it("casa visível agora não aparece na lista de 'já exploradas'", () => {
    const visibleNow: Hex[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
    const previouslyExplored = new Set(["1,0", "5,5"]);
    const { visible, explored } = mergeVisionMemory(visibleNow, previouslyExplored);
    expect(visible).toEqual(visibleNow);
    expect(explored).toEqual([{ q: 5, r: 5 }]);
  });

  it("sem memória anterior, não há casas exploradas-mas-não-visíveis", () => {
    const { explored } = mergeVisionMemory([{ q: 0, r: 0 }], new Set());
    expect(explored).toEqual([]);
  });
});
