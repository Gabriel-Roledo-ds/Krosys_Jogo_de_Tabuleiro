// Fases 4 a 6 do turno: dado, cálculo das casas e movimento.
// Movimento em 8 direções, diagonal custa 1, "até o valor" (pode andar menos).
// Campeões, monstros e o boss são sólidos.

import { balance } from "./data";
import { DIRECTIONS, inBounds, posKey, samePos, type Pos } from "./board";
import { allChampions, type ChampionState, type GameState } from "./state";

/** Fase 4: joga o dado de movimento (d8 por padrão). */
export function rollMovementDie(state: GameState): number {
  return state.rng.roll(balance.dice.sides);
}

/**
 * Fase 5: casas de movimento = dado + bônus - penalidades, mínimo 0.
 * Bônus e penalidades (Passo Ágil, lentidão etc.) entram como números prontos.
 */
export function calcMovement(die: number, bonus = 0, penalty = 0): number {
  return Math.max(0, die + bonus - penalty);
}

export interface MoveOptions {
  /** Atravessa campeões aliados (passiva do Andarilho). */
  passThroughAllies?: boolean;
}

/** Quem ocupa a casa: campeão vivo, monstro vivo ou boss. Null se estiver livre. */
export function occupantAt(state: GameState, p: Pos): "champion" | "monster" | "boss" | null {
  if (samePos(state.boss.pos, p)) return "boss";
  if (state.monsters.some((m) => m.alive && samePos(m.pos, p))) return "monster";
  if (allChampions(state).some((c) => c.alive && samePos(c.pos, p))) return "champion";
  return null;
}

function isBlocked(state: GameState, mover: ChampionState, p: Pos, opts: MoveOptions): boolean {
  const who = occupantAt(state, p);
  if (who === null) return false;
  if (who === "champion" && opts.passThroughAllies) {
    const other = allChampions(state).find((c) => c.alive && samePos(c.pos, p));
    if (other && other.team === mover.team) return false;
  }
  return true;
}

/**
 * Casas onde o campeão pode terminar o movimento com `steps` casas de movimento.
 * Busca em largura: cada passo custa 1, incluindo diagonal. Casas ocupadas não
 * podem ser atravessadas; com `passThroughAllies` dá para atravessar aliados,
 * mas não parar em cima deles.
 */
export function reachableCells(state: GameState, mover: ChampionState, steps: number, opts: MoveOptions = {}): Pos[] {
  const dist = new Map<string, number>([[posKey(mover.pos), 0]]);
  const queue: Pos[] = [mover.pos];
  const result: Pos[] = [];

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(posKey(cur))!;
    if (d === steps) continue;
    for (const dir of DIRECTIONS) {
      const next = { x: cur.x + dir.x, y: cur.y + dir.y };
      const key = posKey(next);
      if (dist.has(key) || !inBounds(next, state.width, state.height)) continue;
      if (isBlocked(state, mover, next, opts)) continue;
      dist.set(key, d + 1);
      queue.push(next);
      if (occupantAt(state, next) === null) result.push(next);
    }
  }
  return result;
}

/**
 * Fase 6: anda o campeão até `dest`, se ela estiver ao alcance de `steps`.
 * Lança erro se o destino não for alcançável.
 */
export function moveChampion(state: GameState, mover: ChampionState, dest: Pos, steps: number, opts: MoveOptions = {}): void {
  if (samePos(mover.pos, dest)) return; // andar 0 casas é permitido
  const ok = reachableCells(state, mover, steps, opts).some((p) => samePos(p, dest));
  if (!ok) throw new Error(`Movimento inválido para (${dest.x},${dest.y}) com ${steps} casas`);
  mover.pos = { ...dest };
}
