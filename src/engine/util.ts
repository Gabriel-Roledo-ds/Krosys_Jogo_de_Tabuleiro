import { DIRECTIONS, type Pos } from "./board";

/** Primeira casa adjacente a `center` que satisfaz `ok`, ou null. */
export function addPosSafe(center: Pos, ok: (p: Pos) => boolean): Pos | null {
  for (const d of DIRECTIONS) {
    const p = { x: center.x + d.x, y: center.y + d.y };
    if (ok(p)) return p;
  }
  return null;
}
