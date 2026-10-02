// Posicionamento dos monstros do mapa (roster v2) no tabuleiro hexagonal.
// Design-only — não ligado ao motor ainda. Ver regras-e-decisoes.md §19/§20.
//
// Pedido do dono do projeto (02/10/2026): os monstros de uma zona se posicionam
// aleatoriamente dentro dela em cada partida (não é posição fixa) — "uma
// proporção adequada", ainda não final. A ideia aqui: em vez de cravar uma
// densidade numérica, cada monstro sorteia uma casa livre dentro da zona dele,
// excluindo o boss, as áreas de largada e os cantos reservados (futuros
// templos). Isso escala sozinho com o tamanho do tabuleiro — não precisa
// reajustar a "proporção" à mão se q_size/r_size mudarem depois.
//
// Qual zona cada casa pertence: o rombo é dividido pela diagonal principal
// (a reta entre as duas pontas agudas, onde fica o boss) — um lado é Vale
// Selvagem, o outro é Terra Petrificada. Por construção, isso deixa um canto
// reservado (futuro templo) de cada lado, um por zona.

import { rngOf, type Rng, type RngHolder } from "../engine/rng";
import { hexKey, type Hex } from "./hexGrid";
import {
  allBoardHexes,
  cornerPocketCells,
  hexBoard,
  startAreaCells,
  type HexBoardConfig,
} from "./hexBoard";
import { monsterTypes, type MonsterType } from "./monsterReaction";

export type ZoneSide = "vale_selvagem" | "terra_petrificada";

/**
 * De que lado da diagonal principal (entre as duas pontas agudas) uma casa
 * está — decide a qual zona ela pertence. `cross` é o produto vetorial 2D do
 * vetor da diagonal com o vetor até a casa, em coordenadas axiais: o sinal diz
 * o lado. Não é uma distância real em hexágonos, só um critério de partição
 * determinístico e estável pra esse formato de rombo.
 */
export function zoneSide(h: Hex, config: HexBoardConfig = hexBoard): ZoneSide {
  const tips = Object.values(config.start_areas).map((a) => a.tip);
  const [a, b] = tips;
  const cross = (b.q - a.q) * (h.r - a.r) - (b.r - a.r) * (h.q - a.q);
  return cross >= 0 ? "vale_selvagem" : "terra_petrificada";
}

/** Casas que nenhum monstro de zona pode ocupar: boss, largadas e cantos reservados. */
export function reservedCellKeys(config: HexBoardConfig = hexBoard): Set<string> {
  const keys = new Set<string>();
  keys.add(hexKey(config.boss));
  for (const teamKey of Object.keys(config.start_areas)) {
    for (const h of startAreaCells(teamKey, config)) keys.add(hexKey(h));
  }
  for (const pocket of config.corner_pockets) {
    for (const h of cornerPocketCells(pocket.name, config)) keys.add(hexKey(h));
  }
  return keys;
}

/** Casas livres de cada zona (sem as reservadas), pra sortear os monstros. */
export function zoneCandidates(config: HexBoardConfig = hexBoard): Record<ZoneSide, Hex[]> {
  const reserved = reservedCellKeys(config);
  const result: Record<ZoneSide, Hex[]> = { vale_selvagem: [], terra_petrificada: [] };
  for (const h of allBoardHexes(config)) {
    if (reserved.has(hexKey(h))) continue;
    result[zoneSide(h, config)].push(h);
  }
  return result;
}

export interface PlacedMonster {
  typeId: string;
  position: Hex;
}

/**
 * Sorteia a posição de todos os monstros de `types` dentro da zona de cada um,
 * usando `rng` — mesma seed gera o mesmo mapa, seeds diferentes geram partidas
 * diferentes (mesma convenção de reprodutibilidade das seções 14/17). Lança
 * erro se a zona não tiver casas livres suficientes pra todas as cópias
 * (sinal de que o tabuleiro ficou pequeno demais pra quantidade de monstros).
 */
export function placeMonsters(
  types: Record<string, MonsterType> = monsterTypes,
  config: HexBoardConfig = hexBoard,
  rng: Rng,
): PlacedMonster[] {
  const candidates = zoneCandidates(config);
  const shuffled: Record<ZoneSide, Hex[]> = {
    vale_selvagem: rng.shuffle(candidates.vale_selvagem),
    terra_petrificada: rng.shuffle(candidates.terra_petrificada),
  };
  const cursor: Record<ZoneSide, number> = { vale_selvagem: 0, terra_petrificada: 0 };
  const placements: PlacedMonster[] = [];

  for (const [typeId, type] of Object.entries(types)) {
    const zone = type.zone as ZoneSide;
    const pool = shuffled[zone];
    if (!pool) throw new Error(`Zona desconhecida em ${typeId}: ${type.zone}`);
    for (let i = 0; i < type.copies; i++) {
      const idx = cursor[zone]++;
      if (idx >= pool.length) {
        throw new Error(
          `Não há casas livres suficientes na zona ${zone} pra posicionar todas as cópias de ${typeId}`,
        );
      }
      placements.push({ typeId, position: pool[idx] });
    }
  }
  return placements;
}

/** Atalho: cria o gerador a partir de uma seed numérica simples. */
export function placeMonstersWithSeed(
  seed: number,
  types: Record<string, MonsterType> = monsterTypes,
  config: HexBoardConfig = hexBoard,
): PlacedMonster[] {
  const holder: RngHolder = { rngState: seed >>> 0 };
  return placeMonsters(types, config, rngOf(holder));
}
