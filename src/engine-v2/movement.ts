// Movimento no tabuleiro hexagonal (roster v2) — equivalente a src/engine/movement.ts,
// mas em coordenadas axiais: 6 direções, cada passo custa 1 (sem diagonal
// especial — é assim que grid hexagonal funciona). "Até o valor": pode andar
// menos. Dado de movimento é o mesmo d6 do MVP (balance.json "dice").
//
// Bloqueio por outro campeão vivo (campeões são sólidos — regras-e-decisoes.md
// §5) e por parede (src/engine-v2/world.ts, ver KANBAN.md "paredes/estruturas").
// Estruturas/armadilhas/portais/molas do roster v2 ainda não existem no
// estado — entram num incremento seguinte.

import { balance } from "../engine/data";
import { rngOf } from "../engine/rng";
import { addHex, hexDirectionTo, hexDistance, hexKey, hexNeighbors, sameHex, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, type ChampionStateV2, type GameStateV2 } from "./state";
import { hasStatus, statusAmount } from "./status";
import { isBossCellV2, wallAtV2 } from "./world";

/** Joga o dado de movimento (d6 por padrão, mesma regra do MVP). */
export function rollMovementDie(s: GameStateV2): number {
  return rngOf(s).roll(balance.dice.sides);
}

/** Casas de movimento = dado + bônus - penalidades, mínimo 0. */
export function calcMovement(die: number, bonus = 0, penalty = 0): number {
  return Math.max(0, die + bonus - penalty);
}

/** Orçamento de movimento de um campeão no turno: 0 se imobilizado, senão dado + bônus - pilhas de `move_penalty`. Usado por turn.ts. */
export function movementBudgetV2(c: ChampionStateV2, die: number, bonus = 0): number {
  if (hasStatus(c, "immobilized")) return 0;
  return calcMovement(die, bonus, statusAmount(c, "move_penalty"));
}

function isOccupiedByAliveChampion(s: GameStateV2, h: Hex, excludeUid: string): boolean {
  return allChampionsV2(s).some((c) => c.alive && c.uid !== excludeUid && c.pos.q === h.q && c.pos.r === h.r);
}

/** Casa sólida (campeão vivo, parede ou o boss) — não pode ser atravessada nem ocupada. */
function isSolid(s: GameStateV2, h: Hex, excludeUid: string): boolean {
  return isOccupiedByAliveChampion(s, h, excludeUid) || wallAtV2(s, h) !== null || isBossCellV2(s, h);
}

interface Search {
  cost: Map<string, number>;
  prev: Map<string, string>;
  stops: Map<string, Hex>;
}

function search(s: GameStateV2, mover: ChampionStateV2, budget: number): Search {
  const cost = new Map<string, number>([[hexKey(mover.pos), 0]]);
  const prev = new Map<string, string>();
  const stops = new Map<string, Hex>();
  const frontier: { pos: Hex; cost: number }[] = [{ pos: mover.pos, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    if (cur.cost > (cost.get(hexKey(cur.pos)) ?? Infinity)) continue;
    for (const next of hexNeighbors(cur.pos)) {
      if (!inHexBoard(next, s.board)) continue;
      if (isSolid(s, next, mover.uid)) continue;
      const c = cur.cost + 1;
      const k = hexKey(next);
      if (c > budget || c >= (cost.get(k) ?? Infinity)) continue;
      cost.set(k, c);
      prev.set(k, hexKey(cur.pos));
      frontier.push({ pos: next, cost: c });
    }
  }
  for (const k of cost.keys()) {
    if (k === hexKey(mover.pos)) continue;
    stops.set(k, hexFromKey(k));
  }
  return { cost, prev, stops };
}

function hexFromKey(k: string): Hex {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

/** Casas alcançáveis (com custo) para parar, dado um orçamento de movimento. */
export function reachableMap(s: GameStateV2, mover: ChampionStateV2, budget: number): Map<string, { pos: Hex; cost: number }> {
  const r = search(s, mover, budget);
  const out = new Map<string, { pos: Hex; cost: number }>();
  for (const [k, pos] of r.stops) out.set(k, { pos, cost: r.cost.get(k)! });
  return out;
}

/** Casas onde o campeão pode terminar o movimento com `steps` casas de movimento. */
export function reachableCells(s: GameStateV2, mover: ChampionStateV2, steps: number): Hex[] {
  return [...reachableMap(s, mover, steps).values()].map((v) => v.pos);
}

/** Caminho (casas visitadas, sem a de partida) até `dest`, ou null se inalcançável. */
export function movePath(s: GameStateV2, mover: ChampionStateV2, dest: Hex, budget: number): Hex[] | null {
  const r = search(s, mover, budget);
  const dk = hexKey(dest);
  if (!r.stops.has(dk)) return null;
  const path: Hex[] = [];
  let k: string | undefined = dk;
  while (k && k !== hexKey(mover.pos)) {
    path.unshift(hexFromKey(k));
    k = r.prev.get(k);
  }
  return path;
}

/**
 * Anda o campeão até `dest`, se ela estiver ao alcance de `steps`. Lança erro
 * se o destino não for alcançável. Devolve o custo gasto (casas andadas).
 */
export function moveChampion(s: GameStateV2, mover: ChampionStateV2, dest: Hex, steps: number): number {
  if (mover.pos.q === dest.q && mover.pos.r === dest.r) return 0; // andar 0 casas é permitido
  const hit = reachableMap(s, mover, steps).get(hexKey(dest));
  if (!hit) throw new Error(`Movimento inválido para (${dest.q},${dest.r}) com ${steps} casas`);
  mover.pos = { ...dest };
  return hit.cost;
}

/**
 * `move_self` / `teleport_self`: reposicionamento instantâneo do próprio
 * campeão, sem gastar o orçamento de movimento do turno e sem checar o
 * caminho (é um salto, não uma caminhada) — só o destino precisa ser válido:
 * dentro do tabuleiro, livre e a no máximo `maxDistance` casas de distância.
 */
export function teleportChampion(s: GameStateV2, mover: ChampionStateV2, dest: Hex, maxDistance: number): void {
  if (sameHex(mover.pos, dest)) return;
  if (!inHexBoard(dest, s.board)) throw new Error(`Destino fora do tabuleiro: (${dest.q},${dest.r})`);
  if (hexDistance(mover.pos, dest) > maxDistance) throw new Error(`Destino além do alcance de teleporte (${maxDistance})`);
  if (isSolid(s, dest, mover.uid)) throw new Error("Destino ocupado");
  mover.pos = { ...dest };
}

/**
 * Move `target` por até `steps` casas numa única direção, parando antes de
 * saltar do tabuleiro ou entrar numa casa ocupada por outro campeão vivo. Sem
 * dano de colisão (regras-e-decisoes.md §7). Devolve quantas casas de fato andou.
 */
export function forcedMove(s: GameStateV2, target: ChampionStateV2, dir: Hex, steps: number): number {
  let moved = 0;
  let pos = target.pos;
  for (let i = 0; i < steps; i++) {
    const next = addHex(pos, dir);
    if (!inHexBoard(next, s.board) || isSolid(s, next, target.uid)) break;
    pos = next;
    moved += 1;
  }
  if (moved > 0) target.pos = pos;
  return moved;
}

/** `push`: afasta `target` de `origin` por até `distance` casas, em linha reta. */
export function pushChampion(s: GameStateV2, target: ChampionStateV2, origin: Hex, distance: number): number {
  const dir = hexDirectionTo(origin, target.pos);
  if (dir.q === 0 && dir.r === 0) return 0;
  return forcedMove(s, target, dir, distance);
}

/** `pull`: aproxima `target` de `origin` por até `distance` casas, sem sobrepor `origin`. */
export function pullChampion(s: GameStateV2, target: ChampionStateV2, origin: Hex, distance: number): number {
  const dir = hexDirectionTo(target.pos, origin);
  if (dir.q === 0 && dir.r === 0) return 0;
  const maxSteps = Math.max(0, hexDistance(target.pos, origin) - 1);
  return forcedMove(s, target, dir, Math.min(distance, maxSteps));
}
