// Testes do posicionamento dos monstros no tabuleiro hexagonal
// (src/design/monsterPlacement.ts) — design-only, ver regras-e-decisoes.md
// §19/§20: posição aleatória dentro da zona a cada partida, proporção ainda
// não final.

import { describe, it, expect } from "vitest";
import { createRng } from "../src/engine/rng";
import { hexKey } from "../src/design/hexGrid";
import { hexBoard } from "../src/design/hexBoard";
import { monsterTypes } from "../src/design/monsterReaction";
import {
  placeMonsters,
  placeMonstersWithSeed,
  reservedCellKeys,
  zoneCandidates,
  zoneSide,
} from "../src/design/monsterPlacement";

describe("divisão em zonas", () => {
  it("as duas pontas agudas (largadas) não entram em nenhuma zona de monstro (são reservadas)", () => {
    const reserved = reservedCellKeys();
    const tips = Object.values(hexBoard.start_areas).map((a) => a.tip);
    for (const tip of tips) {
      expect(reserved.has(hexKey(tip))).toBe(true);
    }
  });

  it("cada canto reservado cai numa zona diferente (um templo por zona)", () => {
    const sides = hexBoard.corner_pockets.map((p) => zoneSide(p.center));
    expect(new Set(sides).size).toBe(2);
  });

  it("as duas zonas têm casas livres disponíveis", () => {
    const candidates = zoneCandidates();
    expect(candidates.vale_selvagem.length).toBeGreaterThan(0);
    expect(candidates.terra_petrificada.length).toBeGreaterThan(0);
  });

  it("há casas livres suficientes nas duas zonas pra todas as cópias de cada tipo (proporção viável pro tamanho atual)", () => {
    const candidates = zoneCandidates();
    const needed: Record<string, number> = { vale_selvagem: 0, terra_petrificada: 0 };
    for (const type of Object.values(monsterTypes)) {
      needed[type.zone] = (needed[type.zone] ?? 0) + type.copies;
    }
    expect(candidates.vale_selvagem.length).toBeGreaterThanOrEqual(needed.vale_selvagem);
    expect(candidates.terra_petrificada.length).toBeGreaterThanOrEqual(needed.terra_petrificada);
  });
});

describe("placeMonsters", () => {
  it("posiciona todas as 40 cópias (2 por tipo, 20 tipos)", () => {
    const placements = placeMonsters(monsterTypes, hexBoard, createRng(1));
    expect(placements).toHaveLength(40);
  });

  it("nenhum monstro cai na mesma casa que outro", () => {
    const placements = placeMonsters(monsterTypes, hexBoard, createRng(1));
    const keys = placements.map((p) => hexKey(p.position));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("nenhum monstro cai em casa reservada (boss, largada ou canto de templo)", () => {
    const placements = placeMonsters(monsterTypes, hexBoard, createRng(1));
    const reserved = reservedCellKeys();
    for (const p of placements) {
      expect(reserved.has(hexKey(p.position)), `${p.typeId} em ${hexKey(p.position)}`).toBe(false);
    }
  });

  it("cada monstro é posicionado dentro da zona do próprio tipo", () => {
    const placements = placeMonsters(monsterTypes, hexBoard, createRng(1));
    for (const p of placements) {
      const type = monsterTypes[p.typeId];
      expect(zoneSide(p.position), `${p.typeId} em ${hexKey(p.position)}`).toBe(type.zone);
    }
  });

  it("mesma seed gera o mesmo posicionamento (reproduzível)", () => {
    const a = placeMonstersWithSeed(42);
    const b = placeMonstersWithSeed(42);
    expect(a).toEqual(b);
  });

  it("seeds diferentes tendem a gerar posicionamentos diferentes (aleatório por partida)", () => {
    const a = placeMonstersWithSeed(1);
    const b = placeMonstersWithSeed(2);
    expect(a).not.toEqual(b);
  });
});
