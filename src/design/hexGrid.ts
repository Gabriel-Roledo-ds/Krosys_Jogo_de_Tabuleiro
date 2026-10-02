// Geometria do tabuleiro hexagonal (roster v2, pós-MVP). Design-only — não ligado
// ao motor ainda (que continua rodando o losango de src/engine/board.ts). Serve pra
// testar a matemática de coordenadas e a visão limitada antes do tabuleiro de
// verdade existir — ver regras-e-decisoes.md §19/§20.
//
// Coordenadas axiais (q, r), convenção "pointy-top" padrão (Red Blob Games). A
// coordenada cúbica implícita é s = -q - r, usada só internamente pros cálculos
// de distância e interpolação de linha.

export interface Hex {
  q: number;
  r: number;
}

export const sameHex = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

export const addHex = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });

/** As 6 direções vizinhas, em ordem horária a partir do leste. */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => addHex(h, d));
}

const thirdCoord = (h: Hex): number => -h.q - h.r;

/** Distância em casas (equivalente ao Chebyshev do losango, mas em coordenada cúbica). */
export function hexDistance(a: Hex, b: Hex): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(thirdCoord(a) - thirdCoord(b)));
}

export const hexAdjacent = (a: Hex, b: Hex): boolean => hexDistance(a, b) === 1;

/**
 * `a` e `b` estão alinhados por um dos 6 eixos principais do hex (equivalente
 * hexagonal de "mesma linha/coluna/diagonal" no tabuleiro quadrado). Cada uma
 * das 6 direções mantém uma das três coordenadas cúbicas constante, então basta
 * checar se a diferença em q, r ou s é 0. `a` e `b` iguais contam como alinhados.
 */
export function isHexInLine(a: Hex, b: Hex): boolean {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  const ds = -dq - dr;
  return dq === 0 || dr === 0 || ds === 0;
}

/** Todas as casas a distância `radius` ou menos do centro (sem checar limites do tabuleiro). */
export function hexesInRadius(center: Hex, radius: number): Hex[] {
  const cells: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const rMin = Math.max(-radius, -dq - radius);
    const rMax = Math.min(radius, -dq + radius);
    for (let dr = rMin; dr <= rMax; dr++) {
      cells.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return cells;
}

/** Quantas casas existem num hexágono de raio `radius` (fórmula fechada, sem gerar a lista). */
export const hexCountInRadius = (radius: number): number => 1 + 3 * radius * (radius + 1);

interface Cube {
  x: number;
  y: number;
  z: number;
}

const toCube = (h: Hex): Cube => ({ x: h.q, y: thirdCoord(h), z: h.r });
const fromCube = (c: Cube): Hex => ({ q: c.x, r: c.z });

function cubeRound(c: Cube): Cube {
  let rx = Math.round(c.x);
  let ry = Math.round(c.y);
  let rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x);
  const dy = Math.abs(ry - c.y);
  const dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

const cubeLerp = (a: Cube, b: Cube, t: number): Cube => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/**
 * Casas que a reta entre `a` e `b` atravessa, sem incluir `a`, incluindo `b`.
 * Usada pra linha de visão (equivalente hexagonal do Bresenham usado no losango).
 */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [];
  const ca = toCube(a);
  const cb = toCube(b);
  const cells: Hex[] = [];
  for (let i = 1; i <= n; i++) {
    cells.push(fromCube(cubeRound(cubeLerp(ca, cb, i / n))));
  }
  return cells;
}
