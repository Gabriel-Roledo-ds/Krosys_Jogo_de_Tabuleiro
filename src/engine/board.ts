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

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Direção unitária (8 direções) que vai de `from` para `to`. (0,0) se forem a mesma casa. */
export function directionTo(from: Pos, to: Pos): Pos {
  return { x: sign(to.x - from.x), y: sign(to.y - from.y) };
}

/** Verdadeiro se `to` está em linha reta (horizontal, vertical ou diagonal) a partir de `from`. */
export function isInLine(from: Pos, to: Pos): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx === 0 || dy === 0 || dx === dy;
}

/**
 * Casas que a reta entre `a` e `b` atravessa, sem incluir as pontas (Bresenham).
 * Usada para a linha de visão.
 */
export function lineBetween(a: Pos, b: Pos): Pos[] {
  const cells: Pos[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  while (!(x === b.x && y === b.y)) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (!(x === b.x && y === b.y)) cells.push({ x, y });
  }
  return cells;
}

/** Gira uma direção 90 graus (usada no formato em L). */
export const rotate90 = (d: Pos): Pos => ({ x: -d.y, y: d.x });

export const addPos = (a: Pos, b: Pos): Pos => ({ x: a.x + b.x, y: a.y + b.y });
