// Tabuleiro compacto para os testes de mecânica: as regras (cartas, turno, pilha, boss) não
// dependem do tamanho do mapa, e os testes usam coordenadas fixas perto do boss em (7,7).
// O dado de verdade (21x21, 20 monstros, multiplicador de dano) é conferido em real.test.ts
// e nas simulações, que chamam useRealData().

import { readFileSync } from "node:fs";
import { balance, monsterPlacements } from "../src/engine/data";

const real = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

const COMPACT_A = [[1, 6], [1, 7], [1, 8], [0, 7], [2, 6], [2, 7], [2, 8], [3, 6], [3, 8]];
const COMPACT_MONSTERS = [
  ["m01_weak", "weak", 3, 4], ["m02_weak", "weak", 3, 10], ["m03_weak", "weak", 11, 4], ["m04_weak", "weak", 11, 10],
  ["m05_medium", "medium", 5, 2], ["m06_medium", "medium", 9, 2], ["m07_medium", "medium", 5, 12], ["m08_medium", "medium", 9, 12],
  ["m09_strong", "strong", 7, 3], ["m10_strong", "strong", 7, 11],
] as const;

export function useCompactBoard(): void {
  balance.board.width = 15;
  balance.board.height = 15;
  balance.board.boss_position = { x: 7, y: 7 };
  balance.teams.start_areas = {
    A: COMPACT_A.map(([x, y]) => ({ x, y })),
    B: COMPACT_A.map(([x, y]) => ({ x: 14 - x, y })),
  };
  balance.damage.champion_damage_multiplier = 1;
  monsterPlacements.splice(0, monsterPlacements.length, ...COMPACT_MONSTERS.map(([id, type, x, y]) => ({ id, type, ring: "test", position: { x, y } })));
}

export function useRealData(): void {
  const b = real("balance.json");
  balance.board = b.board;
  balance.teams.start_areas = b.teams.start_areas;
  balance.damage.champion_damage_multiplier = b.damage.champion_damage_multiplier;
  monsterPlacements.splice(0, monsterPlacements.length, ...real("monsters.json").placements);
}
