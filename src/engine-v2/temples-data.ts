// Dados de data/temples.json + a montagem dos 2 TempleStateV2 iniciais —
// separado de temples.ts (lógica de combate/reivindicação) só pra evitar
// import circular com state.ts: createGameV2 (state.ts) precisa montar os
// templos na criação da partida, e temples.ts (lógica) precisa importar TIPOS
// de state.ts (GameStateV2, ChampionStateV2, TempleStateV2) — então state.ts
// não pode importar de temples.ts. Este arquivo só depende de hexBoard
// (design, sem volta pra state.ts), então os dois lados podem importar dele
// sem ciclo.

import templesJson from "../../data/temples.json";
import { hexBoard } from "../design/hexBoard";
import type { Hex } from "../design/hexGrid";

export interface TempleGod {
  id: string;
  name: string;
  status: string;
  amount: number;
  flavor: string;
}

export interface TemplesDef {
  guardian: { hp: number; defense: number; counter_damage: number };
  gods_by_corner: Record<string, TempleGod>;
}

const templesDef = templesJson as unknown as TemplesDef;
export default templesDef;

/** Molde de um templo recém-criado (sem os campos que só existem depois de ligado ao GameStateV2 — nenhum, na verdade; TempleStateV2 inteiro já cabe aqui). */
export interface TempleSeedV2 {
  uid: string;
  name: string;
  pos: Hex;
  hp: number;
  maxHp: number;
  defense: number;
  counterDamage: number;
  alive: true;
  claimedBy: null;
  godId: string;
  godName: string;
}

/** Monta os 2 templos (um por canto obtuso de data/hex_board.json) a partir de data/temples.json. Chamado por createGameV2 (state.ts). */
export function buildTemplesV2(): TempleSeedV2[] {
  return hexBoard.corner_pockets.map((corner) => {
    const god = templesDef.gods_by_corner[corner.name];
    if (!god) throw new Error(`Nenhum deus configurado pro canto "${corner.name}" (data/temples.json)`);
    return {
      uid: `temple-${corner.name}`,
      name: corner.name,
      pos: { ...corner.center },
      hp: templesDef.guardian.hp,
      maxHp: templesDef.guardian.hp,
      defense: templesDef.guardian.defense,
      counterDamage: templesDef.guardian.counter_damage,
      alive: true,
      claimedBy: null,
      godId: god.id,
      godName: god.name,
    };
  });
}
