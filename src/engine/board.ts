// Geometria do tabuleiro. Distância de Chebyshev: diagonal conta como 1 casa.

export interface Pos {
  x: number;
  y: number;
}

export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;

export const posKey = (p: Pos): string => `${p.x},${p.y}`;

/** Distância em casas, contando diagonal como 1. */
export function distance(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Adjacente = distância 1 (inclui diagonais). */
export const isAdjacent = (a: Pos, b: Pos): boolean => distance(a, b) === 1;

export const inBounds = (p: Pos, width: number, height: number): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;

/** As 8 direções de movimento. */
export const DIRECTIONS: readonly Pos[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

/** Todas as casas a distância `radius` ou menos do centro, dentro do tabuleiro. Raio 1 = 3x3. */
export function cellsInRadius(center: Pos, radius: number, width: number, height: number): Pos[] {
  const cells: Pos[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const p = { x: center.x + dx, y: center.y + dy };
      if (inBounds(p, width, height)) cells.push(p);
    }
  }
  return cells;
}
