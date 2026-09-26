// Visão do jogo para um jogador: só o que ele pode ver (a mão do adversário, armadilhas
// e vigias dele, ordem dos baralhos ficam no servidor) mais dicas do que ele pode fazer agora.

import { cardDefs, getCardDef } from "../engine/data";
import { getChampion, type GameState, type TeamId } from "../engine/state";
import { canPay } from "../engine/mana";
import { moveOptionsFor, reachableMap } from "../engine/movement";
import { cannotCast, handLimitCount } from "../engine/turn";
import { balance, getChampionDef } from "../engine/data";
import { enumerateTargets } from "../engine/targeting";

export type Awaiting =
  | { team: TeamId; kind: "boss" | "draw" | "choose" | "act" | "discard" | "respond" | "over" };

export function awaiting(s: GameState): Awaiting {
  if (s.winner) return { team: s.turn.team, kind: "over" };
  if (s.pending) return { team: s.pending.priority, kind: "respond" };
  return { team: s.turn.team, kind: s.turn.phase === "boss" ? "act" : (s.turn.phase as "draw" | "choose" | "act" | "discard") };
}

export function viewFor(s: GameState, me: TeamId | null): unknown {
  const foe: TeamId | null = me === null ? null : me === "A" ? "B" : "A";
  const aw = awaiting(s);

  const teams: Record<string, unknown> = {};
  for (const id of ["A", "B"] as TeamId[]) {
    const t = s.teams[id];
    const decks: Record<string, { draw: number; discard: number }> = {};
    for (const [uid, d] of Object.entries(t.decks)) decks[uid] = { draw: d.draw.length, discard: d.discard.length };
    teams[id] = {
      id,
      mana: t.mana,
      champions: t.champions.map((c) => ({ ...c, limbo: c.limbo.length })),
      hand: id === me ? t.hand : undefined,
      handCount: t.hand.length,
      handLimitCount: handLimitCount(s, id),
      decks,
      resurrectUsed: t.resurrectUsed,
      nextCardBuff: t.nextCardBuff,
    };
  }

  // Dicas de ação para quem está vendo.
  const hints: Record<string, unknown> = {};
  if (me) {
    const mine = s.teams[me];
    const playable: Record<string, boolean> = {};
    const inWindow = !!s.pending && s.pending.priority === me;
    const myAct = !s.pending && s.turn.team === me && s.turn.phase === "act";
    for (const c of mine.hand) {
      const def = getCardDef(c.cardId);
      const owner = getChampion(s, c.owner);
      let ok = (inWindow && def.fast) || myAct;
      ok = ok && owner.alive && !cannotCast(owner) && canPay(s, me, def.cost);
      playable[c.uid] = ok;
    }
    hints.playable = playable;
    const targets: Record<string, unknown> = {};
    for (const c of mine.hand) {
      if (!playable[c.uid]) continue;
      targets[c.uid] = enumerateTargets(s, getChampion(s, c.owner), getCardDef(c.cardId), 0, 300);
    }
    hints.targets = targets;
    if (myAct && s.turn.main) {
      const main = getChampion(s, s.turn.main);
      const stuck = main.statuses.some((x) => x.kind === "immobilized" && !x.fresh);
      hints.reach = stuck || s.turn.movementLeft <= 0 ? [] : [...reachableMap(s, main, s.turn.movementLeft, moveOptionsFor(s, main)).values()];
      const bdef = getChampionDef(main.defId).basic;
      hints.basic = { name: bdef.name, target: bdef.target, range: bdef.range, targets: main.alive ? enumerateTargets(s, main, bdef, 0, 300) : [] };
      hints.canBasic = !s.turn.basicUsed && !main.statuses.some((x) => x.kind === "stunned" && !x.fresh);
    }
    hints.mustDiscard = !s.pending && s.turn.team === me && s.turn.phase === "discard";
    hints.handLimit = balance.hand.max_size;
  }

  return {
    width: s.width,
    height: s.height,
    round: s.round,
    winner: s.winner,
    me,
    awaiting: aw,
    turn: {
      team: s.turn.team,
      phase: s.turn.phase,
      main: s.turn.main,
      die: s.turn.die,
      movementLeft: s.turn.movementLeft,
      moved: s.turn.moved,
      basicUsed: s.turn.basicUsed,
    },
    pending: s.pending && {
      priority: s.pending.priority,
      chain: s.pending.chain,
      stack: s.pending.stack,
    },
    teams,
    monsters: s.monsters,
    minions: s.minions,
    boss: { ...s.boss, deck: s.boss.deck.length, discard: s.boss.discard },
    walls: s.walls,
    ground: s.ground,
    traps: s.traps.filter((t) => t.team === me),
    springs: s.springs,
    structures: s.structures,
    portals: s.portals,
    watches: s.watches.filter((w) => w.team === me),
    log: s.log.slice(-80),
    hints,
    foe,
    cardCount: cardDefs.length,
  };
}
