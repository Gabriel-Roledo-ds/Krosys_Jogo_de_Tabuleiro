// Visão limitada por campeão e neblina de guerra (roster v2) — liga
// src/design/fieldOfVision.ts (design-only, geometria pura) ao estado real do
// motor hexagonal. Ver regras-e-decisoes.md §20.
//
// Raio: balance.vision_v2.default_radius (dado, não fixo no código — ajustável
// em data/balance.json sem mexer aqui). Bloqueio: só parede (mesma regra de
// linha de visão de carta, glossario.md "Linha de visão" — campeão/monstro/
// estrutura NÃO bloqueiam visão, só bloqueiam movimento; [PADRÃO] escolhido por
// consistência com a regra que já existia pra alcance de carta, em vez de
// inventar uma segunda noção de "sólido" só pra visão).
//
// Memória de neblina: cada equipe acumula, em `game.exploredByTeam[team]`, toda
// casa que algum campeão vivo dela já viu em qualquer momento da partida —
// nunca esquece (decisão [PADRÃO]: sem "re-escurecer" uma área já explorada).
// `updateVisionMemoryV2` precisa ser chamada depois de qualquer ação que possa
// mudar quem vê o quê (turn.ts chama no fim de `applyActionV2` e no começo de
// `startGameV2`, pra já nascer com a área de largada explorada).

import { balance } from "../engine/data";
import { computeVisibleHexes, mergeVisionMemory } from "../design/fieldOfVision";
import { hexKey, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { wallAtV2 } from "./world";
import { allChampionsV2, type GameStateV2, type TeamId } from "./state";

/** Raio de visão padrão (ainda sem cartas que o alterem — "Olhos de Gato" é só referência, carta não existe hoje). */
export function visionRadiusV2(): number {
  return balance.vision_v2.default_radius;
}

/** Casas visíveis a partir de um campeão (raio padrão, bloqueado só por parede). */
export function visibleHexesFromV2(game: GameStateV2, origin: Hex, radius = visionRadiusV2()): Hex[] {
  return computeVisibleHexes({
    origin,
    radius,
    inBounds: (h) => inHexBoard(h, game.board),
    isSolid: (h) => wallAtV2(game, h) !== null,
  });
}

/** União do que todos os campeões vivos de uma equipe veem agora (sem memória). */
export function teamVisibleHexesV2(game: GameStateV2, team: TeamId): Hex[] {
  const seen = new Map<string, Hex>();
  for (const c of allChampionsV2(game)) {
    if (!c.alive || c.team !== team) continue;
    for (const h of visibleHexesFromV2(game, c.pos)) seen.set(hexKey(h), h);
  }
  return [...seen.values()];
}

/** Atualiza a memória de neblina das duas equipes com o que é visível agora. Chamar após qualquer ação que mova campeão. */
export function updateVisionMemoryV2(game: GameStateV2): void {
  for (const team of ["A", "B"] as TeamId[]) {
    const visibleNow = teamVisibleHexesV2(game, team);
    const prev = new Set(game.exploredByTeam[team]);
    for (const h of visibleNow) prev.add(hexKey(h));
    game.exploredByTeam[team] = [...prev];
  }
}

/** O que a equipe vê agora e o que já explorou antes (neblina) — pra mandar pro cliente dela. */
export function teamVisionViewV2(game: GameStateV2, team: TeamId): { radius: number; visible: Hex[]; explored: Hex[] } {
  const visible = teamVisibleHexesV2(game, team);
  const { explored } = mergeVisionMemory(visible, new Set(game.exploredByTeam[team]));
  return { radius: visionRadiusV2(), visible, explored };
}

/** Conjunto de chaves (visível + explorado) de uma equipe — base pra view-v2 filtrar o que ela já conhece do mapa (monstros/paredes/chão/etc), sem recalcular visão por item. */
export function knownCellKeysV2(game: GameStateV2, team: TeamId): Set<string> {
  const { visible, explored } = teamVisionViewV2(game, team);
  const keys = new Set<string>();
  for (const h of visible) keys.add(hexKey(h));
  for (const h of explored) keys.add(hexKey(h));
  return keys;
}
