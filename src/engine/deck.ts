// Baralhos: descarte e reembaralhamento. Quando o monte de compra de um campeão acaba,
// o descarte é embaralhado de volta na hora e o baralho recomeça do começo.

import { getChampionDef } from "./data";
import { rngOf } from "./rng";
import { getChampion, log, type CardInstance, type GameState } from "./state";

/** Se o monte de compra do campeão acabou e há descarte, embaralha o descarte de volta. */
export function refillIfEmpty(s: GameState, championUid: string): void {
  const c = getChampion(s, championUid);
  const deck = s.teams[c.team].decks[championUid];
  if (deck.draw.length === 0 && deck.discard.length > 0) {
    deck.draw = rngOf(s).shuffle(deck.discard);
    deck.discard = [];
    log(s, `O baralho de ${getChampionDef(c.defId).name} (${c.team}) foi embaralhado de novo`);
  }
}

/** Manda a carta para o descarte do baralho do campeão dono (cartas de besta não voltam). */
export function discardCard(s: GameState, card: CardInstance): void {
  if (card.monster) return;
  const c = getChampion(s, card.owner);
  s.teams[c.team].decks[card.owner].discard.push(card);
  refillIfEmpty(s, card.owner);
}
