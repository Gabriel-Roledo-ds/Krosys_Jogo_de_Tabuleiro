// Validação e listagem de alvos de cartas e habilidades básicas.

import type { Effect } from "./data";
import { DIRECTIONS, distance, inBounds, isAdjacent, isInLine, samePos, type Pos } from "./board";
import { getChampion, type ChampionState, type GameState, type Target } from "./state";
import { moveOptionsFor, reachableMap } from "./movement";
import { getUnit, inRange, isAllyOf, isEnemyOf, isUntargetable, liveUnits, structureAt, wallAt } from "./world";

export interface Targetable {
  range: number | "self";
  target: string;
  effects: Effect[];
}

export const rangeOf = (def: Targetable, bonus = 0): number => (def.range === "self" ? 0 : def.range + bonus);

const nonZero = (d?: Pos): boolean => !!d && (d.x !== 0 || d.y !== 0) && Math.abs(d.x) <= 1 && Math.abs(d.y) <= 1;

/** Devolve null se o alvo é válido, ou o motivo se não for. */
export function validateTarget(s: GameState, owner: ChampionState, def: Targetable, t: Target, rangeBonus = 0): string | null {
  const range = rangeOf(def, rangeBonus);
  const inR = (p: Pos) => inBounds(p, s.width, s.height) && inRange(s, owner.pos, p, range);

  const enemyUnit = (uid?: string) => {
    const u = uid ? getUnit(s, uid) : null;
    if (!u) return "alvo inexistente";
    if (isUntargetable(u)) return "alvo intocável";
    if (!isEnemyOf(u, owner.team)) return "alvo não é inimigo";
    if (!inR(u.pos)) return "fora de alcance";
    return null;
  };
  const champion = (uid: string | undefined, allyOnly: boolean, allowSelf: boolean) => {
    const u = uid ? getUnit(s, uid) : null;
    if (!u || u.kind !== "champion") return "alvo inválido";
    if (isUntargetable(u)) return "alvo intocável";
    if (allyOnly && !isAllyOf(u, owner.team)) return "alvo não é aliado";
    if (!allowSelf && u.uid === owner.uid) return "não pode ser o próprio campeão";
    if (!inR(u.pos)) return "fora de alcance";
    return null;
  };

  let err: string | null = null;
  switch (def.target) {
    case "self":
    case "random_enemies":
      break;
    case "enemy":
      err = enemyUnit(t.uid);
      break;
    case "ally":
      err = champion(t.uid, true, true);
      break;
    case "champion":
      err = champion(t.uid, false, false);
      break;
    case "champion_in_line": {
      err = champion(t.uid, false, false);
      if (!err && !isInLine(owner.pos, getUnit(s, t.uid!)!.pos)) err = "fora de linha";
      break;
    }
    case "cell":
      if (!t.pos || !inR(t.pos)) err = "casa fora de alcance";
      break;
    case "line":
      if (!t.pos || !inR(t.pos)) err = "casa fora de alcance";
      else if (!nonZero(t.dir)) err = "direção inválida";
      break;
    case "direction":
      if (!nonZero(t.dir)) err = "direção inválida";
      break;
    case "two_enemies":
      err = enemyUnit(t.uid) ?? enemyUnit(t.uid2);
      if (!err && t.uid === t.uid2) err = "os alvos precisam ser diferentes";
      break;
    case "wall":
      if (!t.pos || !inR(t.pos) || !(wallAt(s, t.pos) || structureAt(s, t.pos))) err = "não há parede ali";
      break;
    case "two_cells":
      if (!t.pos || !t.pos2 || !inR(t.pos) || !inR(t.pos2)) err = "casas fora de alcance";
      else if (samePos(t.pos, t.pos2)) err = "as casas precisam ser diferentes";
      break;
    case "dead_ally": {
      const u = t.uid ? getChampion(s, t.uid) : null;
      if (!u || u.team !== owner.team || u.alive) err = "não há aliado morto";
      break;
    }
    default:
      err = `tipo de alvo desconhecido: ${def.target}`;
  }
  if (err) return err;

  // Exigências extras de alguns efeitos.
  for (const e of def.effects) {
    if (e.type === "move_target" || e.type === "move_self_with_adjacent_ally") {
      if (!t.pos || !inBounds(t.pos, s.width, s.height)) return "destino inválido";
      if (e.type === "move_self_with_adjacent_ally") {
        const ally = t.uid2 ? getUnit(s, t.uid2) : null;
        if (!ally || ally.kind !== "champion" || ally.team !== owner.team || !isAdjacent(ally.pos, owner.pos)) return "precisa de um aliado adjacente";
      }
    }
    if (e.type === "teleport_self" && (!t.pos || distance(owner.pos, t.pos) > e.max_distance)) return "destino fora de alcance";
    if (["spring", "create_walls_line", "create_walls_shape", "fire_wall"].includes(e.type) && !nonZero(t.dir)) return "direção inválida";
  }
  return null;
}

/** Alvos candidatos, para bots e para a interface destacar casas. Lista limitada. */
export function enumerateTargets(s: GameState, owner: ChampionState, def: Targetable, rangeBonus = 0, cap = 40): Target[] {
  const out: Target[] = [];
  const push = (t: Target) => {
    if (out.length < cap && validateTarget(s, owner, def, t, rangeBonus) === null) out.push(t);
  };
  const units = liveUnits(s);
  const range = rangeOf(def, rangeBonus);
  const enemies = units.filter((u) => isEnemyOf(u, owner.team) && !isUntargetable(u));
  const champs = units.filter((u) => u.kind === "champion" && !isUntargetable(u));
  const cellsNear = (): Pos[] => {
    const cells: Pos[] = [];
    for (const u of units) cells.push(u.pos);
    for (let dy = -range; dy <= range; dy += 1) {
      for (let dx = -range; dx <= range; dx += 1) {
        const p = { x: owner.pos.x + dx, y: owner.pos.y + dy };
        if ((dx + dy) % 3 === 0) cells.push(p);
      }
    }
    return cells;
  };

  switch (def.target) {
    case "self":
    case "random_enemies": {
      const drag = def.effects.find((e) => e.type === "move_self_with_adjacent_ally");
      if (drag) {
        const cells = [...reachableMap(s, owner, drag.distance, moveOptionsFor(s, owner)).values()];
        for (const ally of champs) {
          if (ally.uid === owner.uid || !isAllyOf(ally, owner.team)) continue;
          for (const c of cells.filter((_, i) => i % 4 === 0)) push({ uid2: ally.uid, pos: c.pos });
        }
      } else push({});
      break;
    }
    case "enemy":
      for (const u of enemies) push(withExtras(s, owner, def, { uid: u.uid }));
      break;
    case "ally": {
      const mv = def.effects.find((e) => e.type === "move_target");
      for (const u of champs) {
        if (!isAllyOf(u, owner.team)) continue;
        if (mv && u.kind === "champion") {
          const cells = [...reachableMap(s, u, mv.distance, moveOptionsFor(s, u)).values()];
          for (const c of cells.filter((_, i) => i % 4 === 0)) push({ uid: u.uid, pos: c.pos });
        } else push(withExtras(s, owner, def, { uid: u.uid }));
      }
      break;
    }
    case "champion":
    case "champion_in_line":
      for (const u of champs) if (u.uid !== owner.uid) push({ uid: u.uid });
      break;
    case "cell": {
      const tp = def.effects.find((e) => e.type === "teleport_self");
      if (tp) {
        for (let dy = -tp.max_distance; dy <= tp.max_distance; dy += 2) {
          for (let dx = -tp.max_distance; dx <= tp.max_distance; dx += 2) push({ pos: { x: owner.pos.x + dx, y: owner.pos.y + dy } });
        }
        break;
      }
      for (const p of cellsNear()) push(withExtras(s, owner, def, { pos: p }));
      break;
    }
    case "line":
      for (const p of cellsNear().slice(0, 6)) for (const d of DIRECTIONS) push({ pos: p, dir: d });
      break;
    case "direction":
      for (const d of DIRECTIONS) push({ dir: d });
      break;
    case "two_enemies":
      for (const a of enemies) for (const b of enemies) if (a.uid < b.uid) push({ uid: a.uid, uid2: b.uid });
      break;
    case "wall":
      for (const w of s.walls) push({ pos: w.pos });
      for (const w of s.structures) push({ pos: w.pos });
      break;
    case "two_cells": {
      const cells = cellsNear();
      for (let i = 0; i < cells.length && out.length < cap; i++) for (let j = i + 1; j < cells.length; j++) push({ pos: cells[i], pos2: cells[j] });
      break;
    }
    case "dead_ally":
      for (const c of s.teams[owner.team].champions) if (!c.alive) push({ uid: c.uid });
      break;
  }
  return out;
}

/** Completa alvos com dados extras que algumas cartas exigem (destino, direção). */
function withExtras(s: GameState, owner: ChampionState, def: Targetable, t: Target): Target {
  for (const e of def.effects) {
    if (e.type === "move_target" && t.uid) {
      const ally = getUnit(s, t.uid);
      if (ally) t = { ...t, pos: { x: ally.pos.x + (owner.pos.x < ally.pos.x ? 1 : -1), y: ally.pos.y } };
    }
    if (["spring", "create_walls_line", "create_walls_shape", "fire_wall"].includes(e.type) && !t.dir) t = { ...t, dir: { x: 1, y: 0 } };
  }
  return t;
}

export type { Pos };
export { getChampion };
