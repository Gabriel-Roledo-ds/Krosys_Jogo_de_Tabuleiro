// Formato do tabuleiro hexagonal (roster v2, pós-MVP): rombo alongado com duas
// pontas agudas (largadas) e duas pontas obtusas (cantos reservados pros futuros
// templos de bênção). Design-only, lê data/hex_board.json — ver
// regras-e-decisoes.md §20. Não ligado ao motor (que ainda roda o losango
// quadrado de src/engine/board.ts + data/balance.json).
//
// A escolha de usar uma seleção retangular em coordenadas axiais (0<=q<q_size,
// 0<=r<r_size) não é arbitrária: esse recorte É um losango/rombo quando
// desenhado num grid hexagonal (é assim que coordenadas axiais funcionam), com
// duas pontas de 60° (os cantos (0,0) e (q_size-1,r_size-1)) e duas de 120° (os
// outros dois cantos). q_size > r_size alonga o rombo no eixo das pontas agudas.

import hexBoardJson from "../../data/hex_board.json";
import { hexDistance, hexesInRadius, hexLine, type Hex } from "./hexGrid";

export interface StartArea {
  tip: Hex;
  radius: number;
}

export interface CornerPocket {
  name: string;
  center: Hex;
  radius: number;
}

export interface HexBoardConfig {
  shape: string;
  q_size: number;
  r_size: number;
  boss: Hex;
  start_areas: Record<string, StartArea>;
  corner_pockets: CornerPocket[];
}

export const hexBoard = hexBoardJson as unknown as HexBoardConfig;

/** Casa existe no tabuleiro: dentro do retângulo axial que forma o rombo. */
export function inHexBoard(h: Hex, config: HexBoardConfig = hexBoard): boolean {
  return h.q >= 0 && h.q < config.q_size && h.r >= 0 && h.r < config.r_size;
}

/** Todas as casas do tabuleiro (q_size * r_size, por construção). */
export function allBoardHexes(config: HexBoardConfig = hexBoard): Hex[] {
  const cells: Hex[] = [];
  for (let q = 0; q < config.q_size; q++) {
    for (let r = 0; r < config.r_size; r++) cells.push({ q, r });
  }
  return cells;
}

/** Casas da área de largada de uma equipe (raio ao redor da ponta aguda dela). */
export function startAreaCells(teamKey: string, config: HexBoardConfig = hexBoard): Hex[] {
  const area = config.start_areas[teamKey];
  if (!area) throw new Error(`Área de largada desconhecida: ${teamKey}`);
  return hexesInRadius(area.tip, area.radius).filter((h) => inHexBoard(h, config));
}

/** Casas de um canto reservado (ponta obtusa), pelo nome em corner_pockets. */
export function cornerPocketCells(name: string, config: HexBoardConfig = hexBoard): Hex[] {
  const pocket = config.corner_pockets.find((p) => p.name === name);
  if (!pocket) throw new Error(`Canto desconhecido: ${name}`);
  return hexesInRadius(pocket.center, pocket.radius).filter((h) => inHexBoard(h, config));
}

/** Linha reta entre as duas pontas agudas (ponta a ponta) — referência do "caminho principal". */
export function mainDiagonal(config: HexBoardConfig = hexBoard): Hex[] {
  const tips = Object.values(config.start_areas).map((a) => a.tip);
  if (tips.length !== 2) return [];
  const [a, b] = tips;
  return [a, ...hexLine(a, b)];
}

/** Distância (em casas) entre as duas pontas agudas. */
export function tipToTipDistance(config: HexBoardConfig = hexBoard): number {
  const tips = Object.values(config.start_areas).map((a) => a.tip);
  if (tips.length !== 2) return 0;
  return hexDistance(tips[0], tips[1]);
}
