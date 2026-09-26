// Consultas sobre o campo: quem está onde, casas sólidas, alcance e linha de visão.

import { balance } from "./data";
import { distance, inBounds, lineBetween, samePos, type Pos } from "./board";
import { allChampions, type ChampionState, type GameState, type TeamId, type Unit } from "./state";

/** Todas as unidades vivas em campo: campeões, monstros, lacaios e o boss. */
export function liveUnits(s: GameState): Unit[] {
  const out: Unit[] = allChampions(s).filter((c) => c.alive);
  out.push(...s.monsters.filter((m) => m.alive));
  out.push(...s.minions.filter((m) => m.alive));
  if (s.boss.alive) out.push(s.boss);
  return out;
}

export function getUnit(s: GameState, uid: string): Unit | null {
  return liveUnits(s).find((u) => u.uid === uid) ?? null;
}

export function unitAt(s: GameState, p: Pos): Unit | null {
  return liveUnits(s).find((u) => samePos(u.pos, p)) ?? null;
}

export const wallAt = (s: GameState, p: Pos) => s.walls.find((w) => samePos(w.pos, p)) ?? null;
export const structureAt = (s: GameState, p: Pos) => s.structures.find((w) => samePos(w.pos, p)) ?? null;

/** Casa livre: dentro do tabuleiro, sem unidade, parede ou estrutura. */
export function isFreeCell(s: GameState, p: Pos): boolean {
  return inBounds(p, s.width, s.height) && !unitAt(s, p) && !wallAt(s, p) && !structureAt(s, p);
}

/** Quem ocupa a casa. Paredes e estruturas contam como "wall". */
export function occupantAt(s: GameState, p: Pos): "champion" | "monster" | "boss" | "minion" | "wall" | null {
  const u = unitAt(s, p);
  if (u) return u.kind;
  if (wallAt(s, p) || structureAt(s, p)) return "wall";
  return null;
}

/** Linha de visão: parede (exceto baixa) entre as duas casas bloqueia. */
export function hasLineOfSight(s: GameState, from: Pos, to: Pos): boolean {
  if (!balance.range.walls_block_range) return true;
  for (const cell of lineBetween(from, to)) {
    const w = wallAt(s, cell);
    if (w && w.kind !== "low") return false;
  }
  return true;
}

/** Alcance em casas (Chebyshev) com linha de visão. */
export function inRange(s: GameState, from: Pos, to: Pos, range: number): boolean {
  return distance(from, to) <= range && hasLineOfSight(s, from, to);
}

/** Inimigo de `team`? Monstros, lacaios e boss são inimigos de todos. */
export function isEnemyOf(u: Unit, team: TeamId): boolean {
  return u.kind === "champion" ? u.team !== team : true;
}

export function isAllyOf(u: Unit, team: TeamId): boolean {
  return u.kind === "champion" && u.team === team;
}

/** Não pode ser alvo nem atingido por áreas: campeão recém-voltado da morte. */
export const isUntargetable = (u: Unit): boolean => u.kind === "champion" && u.untargetable;

export function unitsInRadius(s: GameState, center: Pos, radius: number): Unit[] {
  return liveUnits(s).filter((u) => distance(center, u.pos) <= radius && !isUntargetable(u));
}

/** Em chamas: sobre chão em chamas. */
export function isBurning(s: GameState, u: Unit): boolean {
  return s.ground.some((g) => (g.kind === "fire" || g.kind === "fire_wall") && samePos(g.pos, u.pos));
}

/** Primeira casa livre da área de largada da equipe, ou a mais próxima livre. */
export function freeStartCell(s: GameState, team: TeamId): Pos {
  const area = balance.teams.start_areas[team];
  const free = area.find((p) => isFreeCell(s, p));
  if (free) return { ...free };
  // Área lotada: procura a casa livre mais próxima do centro da área.
  const center = area[0];
  let best: Pos | null = null;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const p = { x, y };
      if (isFreeCell(s, p) && (!best || distance(center, p) < distance(center, best))) best = p;
    }
  }
  if (!best) throw new Error("Sem casa livre para voltar");
  return best;
}

export const championsOf = (s: GameState, team: TeamId): ChampionState[] => s.teams[team].champions;
