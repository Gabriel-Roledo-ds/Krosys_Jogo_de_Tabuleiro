// Movimento no tabuleiro hexagonal (roster v2) — equivalente a src/engine/movement.ts,
// mas em coordenadas axiais: 6 direções, cada passo custa 1 (sem diagonal
// especial — é assim que grid hexagonal funciona). "Até o valor": pode andar
// menos. Dado de movimento é o mesmo d6 do MVP (balance.json "dice").
//
// Escopo atual: só bloqueio por outro campeão vivo (campeões são sólidos —
// regras-e-decisoes.md §5). Paredes/estruturas/casas lentas do roster v2 ainda
// não existem no estado (ver KANBAN.md) — entram quando o resto do motor
// (efeitos de construção) for ligado.

import { balance } from "../engine/data";
import { rngOf } from "../engine/rng";
import { hexKey, hexNeighbors, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, type ChampionStateV2, type GameStateV2 } from "./state";

/** Joga o dado de movimento (d6 por padrão, mesma regra do MVP). */
export function rollMovementDie(s: GameStateV2): number {
  return rngOf(s).roll(balance.dice.sides);
}

/** Casas de movimento = dado + bônus - penalidades, mínimo 0. */
export function calcMovement(die: number, bonus = 0, penalty = 0): number {
  return Math.max(0, die + bonus - penalty);
}

function isOccupiedByAliveChampion(s: GameStateV2, h: Hex, excludeUid: string): boolean {
  return allChampionsV2(s).some((c) => c.alive && c.uid !== excludeUid && c.pos.q === h.q && c.pos.r === h.r);
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
      if (isOccupiedByAliveChampion(s, next, mover.uid)) continue;
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
