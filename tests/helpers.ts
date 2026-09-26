// Ajudantes de teste: monta cenários prontos para jogar cartas sem passar pelo turno inteiro.

import { getCardDef } from "../src/engine/data";
import { createGame, getChampion, type CardInstance, type GameState, type Target, type TeamId } from "../src/engine/state";
import { applyAction, startGame } from "../src/engine/turn";

export const uid = (team: TeamId, def: string) => `${team}-${def}`;

let counter = 0;

/**
 * Partida pronta para a equipe A agir: monstros removidos, fase de ação,
 * mãos vazias, mana 10 nas duas equipes. O campeão principal é o primeiro da equipe A.
 */
export function scenario(comp: Record<TeamId, string[]>, seed = 1): GameState {
  const s = createGame(comp, seed);
  s.monsters.forEach((m) => (m.alive = false));
  startGame(s);
  applyAction(s, "A", { type: "choose", champion: uid("A", comp.A[0]) });
  s.teams.A.hand = [];
  s.teams.B.hand = [];
  s.teams.A.mana = 10;
  s.teams.B.mana = 10;
  s.turn.movementLeft = 0;
  // Todos longe do boss por padrão.
  const spots = [[1, 1], [1, 2], [1, 3], [13, 11], [13, 12], [13, 13]];
  [...s.teams.A.champions, ...s.teams.B.champions].forEach((c, i) => (c.pos = { x: spots[i][0], y: spots[i][1] }));
  return s;
}

export function place(s: GameState, championUid: string, x: number, y: number): void {
  getChampion(s, championUid).pos = { x, y };
}

/** Põe uma carta na mão da equipe. O dono é o campeão da equipe que tem essa carta no baralho. */
export function give(s: GameState, team: TeamId, cardId: string, ownerDef?: string): CardInstance {
  const def = getCardDef(cardId);
  const owner = ownerDef ?? def.owner;
  const card: CardInstance = { uid: `t${counter++}#${cardId}`, cardId, owner: uid(team, owner), monster: false };
  s.teams[team].hand.push(card);
  return card;
}

export function play(s: GameState, team: TeamId, cardId: string, target: Target = {}): void {
  const card = s.teams[team].hand.find((c) => c.cardId === cardId);
  if (!card) throw new Error(`Carta ${cardId} não está na mão de ${team}`);
  applyAction(s, team, { type: "play", card: card.uid, target });
}

export const hp = (s: GameState, championUid: string): number => getChampion(s, championUid).hp;
