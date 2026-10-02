// Validação de alvos de cartas/habilidades no motor hexagonal (roster v2).
// Equivalente a src/engine/targeting.ts, mas em coordenadas axiais e só para
// os tipos de `target` que já existem sem depender de paredes/mortos/boss
// ainda não modelados no motor novo (ver KANBAN.md): "wall" e "dead_ally"
// devolvem "ainda não implementado" por enquanto.

import { hexAdjacent, hexDistance, HEX_DIRECTIONS, isHexInLine, sameHex, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, getChampionV2, type ChampionStateV2, type GameStateV2 } from "./state";

export interface TargetableV2 {
  range: number | "self";
  target: string;
}

export const rangeOfV2 = (def: TargetableV2, bonus = 0): number => (def.range === "self" ? 0 : def.range + bonus);

export interface TargetV2 {
  uid?: string;
  pos?: Hex;
  pos2?: Hex;
  dir?: Hex;
}

const inRange = (s: GameStateV2, from: Hex, to: Hex, range: number): boolean =>
  inHexBoard(to, s.board) && hexDistance(from, to) <= range;

const isDirection = (d?: Hex): boolean => !!d && HEX_DIRECTIONS.some((v) => v.q === d.q && v.r === d.r);

function findChampion(s: GameStateV2, uid?: string): ChampionStateV2 | null {
  if (!uid) return null;
  try {
    return getChampionV2(s, uid);
  } catch {
    return null;
  }
}

/** Devolve null se o alvo é válido, ou o motivo (em português) se não for. */
export function validateTargetV2(s: GameStateV2, owner: ChampionStateV2, def: TargetableV2, t: TargetV2, rangeBonus = 0): string | null {
  const range = rangeOfV2(def, rangeBonus);

  const enemyAt = (uid?: string): string | null => {
    const u = findChampion(s, uid);
    if (!u) return "alvo inexistente";
    if (!u.alive) return "alvo não está em campo";
    if (u.team === owner.team) return "alvo não é inimigo";
    if (!inRange(s, owner.pos, u.pos, range)) return "fora de alcance";
    return null;
  };

  const championAt = (uid: string | undefined, allyOnly: boolean, allowSelf: boolean): string | null => {
    const u = findChampion(s, uid);
    if (!u) return "alvo inválido";
    if (!u.alive) return "alvo não está em campo";
    if (allyOnly && u.team !== owner.team) return "alvo não é aliado";
    if (!allowSelf && u.uid === owner.uid) return "não pode ser o próprio campeão";
    if (!inRange(s, owner.pos, u.pos, range)) return "fora de alcance";
    return null;
  };

  switch (def.target) {
    case "self":
      return null;
    case "random_enemies":
      return allChampionsV2(s).some((c) => c.alive && c.team !== owner.team && inRange(s, owner.pos, c.pos, range))
        ? null
        : "nenhum inimigo ao alcance";
    case "enemy":
      return enemyAt(t.uid);
    case "ally":
      return championAt(t.uid, true, true);
    case "champion":
      return championAt(t.uid, false, true);
    case "champion_in_line": {
      const err = championAt(t.uid, false, false);
      if (err) return err;
      const u = findChampion(s, t.uid)!;
      return isHexInLine(owner.pos, u.pos) ? null : "fora de linha";
    }
    case "direction":
      return isDirection(t.dir) ? null : "direção inválida";
    case "cell":
      if (!t.pos) return "alvo inválido";
      return inRange(s, owner.pos, t.pos, range) ? null : "fora de alcance";
    case "two_cells": {
      if (!t.pos || !t.pos2) return "alvo inválido";
      if (!inRange(s, owner.pos, t.pos, range)) return "primeira casa fora de alcance";
      if (!inRange(s, owner.pos, t.pos2, range)) return "segunda casa fora de alcance";
      if (sameHex(t.pos, t.pos2)) return "as duas casas precisam ser diferentes";
      return null;
    }
    case "line":
      if (!t.pos) return "alvo inválido";
      if (!inRange(s, owner.pos, t.pos, range)) return "fora de alcance";
      return isHexInLine(owner.pos, t.pos) ? null : "fora de linha";
    case "wall":
    case "dead_ally":
      return `alvo "${def.target}" ainda não implementado no motor v2`;
    default:
      return `tipo de alvo desconhecido: ${def.target}`;
  }
}

/** Lista de inimigos vivos ao alcance — usada por random_enemies/two_enemies. */
export function enemiesInRange(s: GameStateV2, owner: ChampionStateV2, def: TargetableV2, rangeBonus = 0): ChampionStateV2[] {
  const range = rangeOfV2(def, rangeBonus);
  return allChampionsV2(s).filter((c) => c.alive && c.team !== owner.team && inRange(s, owner.pos, c.pos, range));
}

/** `true` se `pos` está ao alcance de `owner` e dentro do tabuleiro. */
export function inRangeOf(s: GameStateV2, owner: ChampionStateV2, pos: Hex, def: TargetableV2, rangeBonus = 0): boolean {
  return inRange(s, owner.pos, pos, rangeOfV2(def, rangeBonus));
}

export { hexAdjacent };
