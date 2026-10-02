// Baralhos do motor hexagonal (roster v2) — igual a src/engine/deck.ts: cartas
// usadas vão pro descarte do baralho do campeão dono, e quando o monte de
// compra acaba, o descarte é embaralhado de volta na hora.

import { rngOf } from "../engine/rng";
import { getChampionV2, logV2, type CardInstanceV2, type GameStateV2 } from "./state";

/** Se o monte de compra do campeão acabou e há descarte, embaralha o descarte de volta. */
export function refillIfEmptyV2(s: GameStateV2, championUid: string): void {
  const c = getChampionV2(s, championUid);
  const deck = s.teams[c.team].decks[championUid];
  if (deck.draw.length === 0 && deck.discard.length > 0) {
    deck.draw = rngOf(s).shuffle(deck.discard);
    deck.discard = [];
    logV2(s, `O baralho de ${c.defId} (${c.team}) foi embaralhado de novo`);
  }
}

/** Manda a carta pro descarte do baralho do campeão dono. */
export function discardCardV2(s: GameStateV2, card: CardInstanceV2): void {
  const c = getChampionV2(s, card.owner);
  s.teams[c.team].decks[card.owner].discard.push(card);
  refillIfEmptyV2(s, card.owner);
}

/** Compra `n` cartas do baralho do campeão pra mão da equipe. Devolve quantas foram compradas de fato. */
export function drawFromV2(s: GameStateV2, championUid: string, n: number): number {
  const c = getChampionV2(s, championUid);
  const t = s.teams[c.team];
  const deck = t.decks[championUid];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (deck.draw.length === 0) refillIfEmptyV2(s, championUid);
    const card = deck.draw.shift();
    if (!card) break;
    t.hand.push(card);
    drawn++;
  }
  refillIfEmptyV2(s, championUid);
  return drawn;
}

/** Tamanho total do baralho (compra + descarte) de um campeão. */
export function deckSizeV2(s: GameStateV2, championUid: string): number {
  const c = getChampionV2(s, championUid);
  const d = s.teams[c.team].decks[championUid];
  return d.draw.length + d.discard.length;
}
