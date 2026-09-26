// Fases 4 a 6 do turno: dado, cálculo das casas e movimento.
// Movimento em 8 direções, diagonal custa 1, "até o valor" (pode andar menos).
// Campeões, monstros, boss, lacaios, paredes e estruturas são sólidos.
// Casas lentas (Teia) custam 2 para entrar.

import { balance, getChampionDef } from "./data";
import { DIRECTIONS, inBounds, isAdjacent, posKey, samePos, type Pos } from "./board";
import { rngOf } from "./rng";
import { allChampions, type ChampionState, type GameState, type Unit } from "./state";
import { hasStatus, statusAmount } from "./status";
import { isFreeCell, occupantAt, structureAt, unitAt, wallAt } from "./world";

export { occupantAt };

/** Fase 4: joga o dado de movimento (d8 por padrão). */
export function rollMovementDie(state: GameState): number {
  return rngOf(state).roll(balance.dice.sides);
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
  /** Ignora casas lentas (passiva do Andarilho). */
  ignoreSlow?: boolean;
  /** Atravessa campeões (inclusive inimigos) e paredes fracas (Atalho). */
  phasing?: boolean;
  /** Atravessa paredes desta equipe (passiva do Arquiteto). */
  passOwnWalls?: boolean;
}

/** Opções de movimento de um campeão: passivas e efeitos do turno. */
export function moveOptionsFor(s: GameState, c: ChampionState): MoveOptions {
  const effects = getChampionDef(c.defId).passive.effects;
  const has = (t: string) => effects.some((e) => e.type === t);
  return {
    passThroughAllies: has("pass_through_allies"),
    ignoreSlow: has("ignore_slow_cells"),
    passOwnWalls: has("pass_through_own_walls"),
    phasing: s.turn.phasing && s.turn.main === c.uid,
  };
}

function canPass(s: GameState, mover: ChampionState, p: Pos, opts: MoveOptions): boolean {
  const u = unitAt(s, p);
  if (u) {
    if (u.kind !== "champion") return false;
    if (opts.phasing) return true;
    return !!opts.passThroughAllies && u.team === mover.team;
  }
  const w = wallAt(s, p);
  if (w) {
    if (opts.passOwnWalls && w.team === mover.team) return true;
    if (opts.phasing && w.kind === "weak") return true;
    return false;
  }
  return !structureAt(s, p);
}

const stepCost = (s: GameState, p: Pos, opts: MoveOptions): number =>
  !opts.ignoreSlow && s.ground.some((g) => g.kind === "slow" && samePos(g.pos, p)) ? 2 : 1;

interface Search {
  cost: Map<string, number>;
  prev: Map<string, string>;
  stops: Map<string, Pos>;
}

function search(s: GameState, mover: ChampionState, budget: number, opts: MoveOptions): Search {
  const cost = new Map<string, number>([[posKey(mover.pos), 0]]);
  const prev = new Map<string, string>();
  const stops = new Map<string, Pos>();
  const frontier: { pos: Pos; cost: number }[] = [{ pos: mover.pos, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    if (cur.cost > (cost.get(posKey(cur.pos)) ?? Infinity)) continue;
    for (const dir of DIRECTIONS) {
      const next = { x: cur.pos.x + dir.x, y: cur.pos.y + dir.y };
      if (!inBounds(next, s.width, s.height) || !canPass(s, mover, next, opts)) continue;
      const c = cur.cost + stepCost(s, next, opts);
      const k = posKey(next);
      if (c > budget || c >= (cost.get(k) ?? Infinity)) continue;
      cost.set(k, c);
      prev.set(k, posKey(cur.pos));
      frontier.push({ pos: next, cost: c });
    }
  }
  for (const [k, c] of cost) {
    if (k === posKey(mover.pos)) continue;
    const [x, y] = k.split(",").map(Number);
    if (isFreeCell(s, { x, y }) && c <= budget) stops.set(k, { x, y });
  }
  return { cost, prev, stops };
}

/** Casas alcançáveis (com custo) para parar, dado um orçamento de movimento. */
export function reachableMap(s: GameState, mover: ChampionState, budget: number, opts: MoveOptions = {}): Map<string, { pos: Pos; cost: number }> {
  const r = search(s, mover, budget, opts);
  const out = new Map<string, { pos: Pos; cost: number }>();
  for (const [k, pos] of r.stops) out.set(k, { pos, cost: r.cost.get(k)! });
  return out;
}

/** Casas onde o campeão pode terminar o movimento com `steps` casas de movimento. */
export function reachableCells(s: GameState, mover: ChampionState, steps: number, opts: MoveOptions = {}): Pos[] {
  return [...reachableMap(s, mover, steps, opts).values()].map((v) => v.pos);
}

/** Caminho (casas visitadas, sem a de partida) até `dest`, ou null se inalcançável. */
export function movePath(s: GameState, mover: ChampionState, dest: Pos, budget: number, opts: MoveOptions = {}): Pos[] | null {
  const r = search(s, mover, budget, opts);
  const dk = posKey(dest);
  if (!r.stops.has(dk)) return null;
  const path: Pos[] = [];
  let k: string | undefined = dk;
  while (k && k !== posKey(mover.pos)) {
    const [x, y] = k.split(",").map(Number);
    path.unshift({ x, y });
    k = r.prev.get(k);
  }
  return path;
}

/**
 * Fase 6: anda o campeão até `dest`, se ela estiver ao alcance de `steps`.
 * Lança erro se o destino não for alcançável. Devolve o custo gasto.
 */
export function moveChampion(s: GameState, mover: ChampionState, dest: Pos, steps: number, opts: MoveOptions = {}): number {
  if (samePos(mover.pos, dest)) return 0; // andar 0 casas é permitido
  const hit = reachableMap(s, mover, steps, opts).get(posKey(dest));
  if (!hit) throw new Error(`Movimento inválido para (${dest.x},${dest.y}) com ${steps} casas`);
  mover.pos = { ...dest };
  return hit.cost;
}

/**
 * Casas de movimento do turno: dado + bônus - penalidades (lentidão, Presença
 * Sufocante, aura do monstro forte). Imobilizado = 0.
 */
export function movementBudget(s: GameState, c: ChampionState, die: number, bonus = 0): number {
  if (hasStatus(c, "immobilized")) return 0;
  let penalty = statusAmount(c, "move_penalty");
  for (const other of allChampions(s)) {
    if (!other.alive || other.team === c.team || !isAdjacent(other.pos, c.pos)) continue;
    for (const e of getChampionDef(other.defId).passive.effects) {
      if (e.type === "aura_adjacent_enemies_move_penalty") penalty += e.amount;
    }
  }
  return calcMovement(die, bonus, penalty);
}

/**
 * Movimento forçado (empurrar, puxar, lançar): anda até `dist` casas na direção
 * `dir` e para antes de um sólido. Devolve quantas casas andou.
 */
export function forcedMove(s: GameState, unit: Unit, dir: Pos, dist: number): number {
  if (unit.kind !== "champion" && unit.kind !== "minion") return 0;
  let moved = 0;
  while (moved < dist) {
    const next = { x: unit.pos.x + dir.x, y: unit.pos.y + dir.y };
    if (!isFreeCell(s, next)) break;
    unit.pos = next;
    moved++;
  }
  return moved;
}

/** Move o campeão para uma casa livre (teletransporte). */
export function teleport(s: GameState, c: ChampionState, dest: Pos): boolean {
  if (!isFreeCell(s, dest)) return false;
  c.pos = { ...dest };
  return true;
}
