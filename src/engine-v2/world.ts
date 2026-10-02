// Consultas sobre o campo do motor hexagonal (roster v2) — equivalente a
// src/engine/world.ts, só a parte de paredes por enquanto (sem monstros/boss
// no motor novo ainda, ver KANBAN.md).

import { hexLine, sameHex, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, type GameStateV2, type WallV2 } from "./state";

export const wallAtV2 = (s: GameStateV2, p: Hex): WallV2 | null => s.walls.find((w) => sameHex(w.pos, p)) ?? null;

/** A casa do boss (vivo) também é sólida, igual a campeão vivo e parede. */
export const isBossCellV2 = (s: GameStateV2, p: Hex): boolean => s.boss.alive && sameHex(s.boss.pos, p);

/** A casa de um monstro vivo também é sólida (ver monsters.ts, item 7 do KANBAN). */
export const monsterAtV2 = (s: GameStateV2, p: Hex) => s.monsters.find((m) => m.alive && sameHex(m.pos, p)) ?? null;
export const isMonsterCellV2 = (s: GameStateV2, p: Hex): boolean => monsterAtV2(s, p) !== null;

/** Casa livre: dentro do tabuleiro, sem campeão vivo, parede, boss nem monstro. */
export function isFreeCellV2(s: GameStateV2, p: Hex): boolean {
  return (
    inHexBoard(p, s.board) &&
    !allChampionsV2(s).some((c) => c.alive && sameHex(c.pos, p)) &&
    !wallAtV2(s, p) &&
    !isBossCellV2(s, p) &&
    !isMonsterCellV2(s, p)
  );
}

/** Linha de visão: parede entre as duas casas bloqueia (a própria casa de origem/destino não conta). */
export function hasLineOfSightV2(s: GameStateV2, from: Hex, to: Hex): boolean {
  const between = hexLine(from, to).slice(0, -1); // hexLine inclui o destino; LOS olha só o que está ENTRE as duas casas
  return between.every((cell) => !wallAtV2(s, cell));
}
