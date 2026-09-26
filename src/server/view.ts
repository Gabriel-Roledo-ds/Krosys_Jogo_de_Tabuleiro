// Visão do jogo para um jogador: só o que ele pode ver (a mão do adversário, armadilhas
// e vigias dele, ordem dos baralhos ficam no servidor) mais dicas do que ele pode fazer agora.

import { cardDefs, getCardDef } from "../engine/data";
import { getChampion, type GameState, type TeamId } from "../engine/state";
import { canPay } from "../engine/mana";
import { moveOptionsFor, movementBudget, reachableMap } from "../engine/movement";
import { castersFor, handLimitCount, resurrectBlocked } from "../engine/turn";
import { balance, getChampionDef } from "../engine/data";
import { enumerateTargets } from "../engine/targeting";

export type Awaiting =
  | { team: TeamId; kind: "boss" | "draw" | "act" | "discard" | "respond" | "over" };

export function awaiting(s: GameState): Awaiting {
  if (s.winner) return { team: s.turn.team, kind: "over" };
  if (s.pending) return { team: s.pending.priority, kind: "respond" };
  return { team: s.turn.team, kind: s.turn.phase === "boss" ? "act" : (s.turn.phase as "draw" | "act" | "discard") };
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
    const casters: Record<string, string[]> = {};
    for (const c of mine.hand) {
      const def = getCardDef(c.cardId);
      const who = castersFor(s, me, c);
      casters[c.uid] = who.map((x) => x.uid);
      playable[c.uid] = ((inWindow && def.fast) || myAct) && who.length > 0 && canPay(s, me, c.monster ? 0 : def.cost) && !resurrectBlocked(s, me, def.effects);
    }
    hints.playable = playable;
    hints.casters = casters;
    // Alvos por lançador (cartas de besta podem ser lançadas por qualquer campeão).
    const targets: Record<string, Record<string, unknown>> = {};
    for (const c of mine.hand) {
      if (!playable[c.uid]) continue;
      targets[c.uid] = {};
      for (const cu of casters[c.uid]) targets[c.uid][cu] = enumerateTargets(s, getChampion(s, cu), getCardDef(c.cardId), 0, 300);
    }
    hints.targets = targets;
    if (myAct) {
      const t = s.turn;
      const reach: Record<string, unknown[]> = {};
      const basics: Record<string, unknown> = {};
      for (const c of mine.champions) {
        if (!c.alive) continue;
        const active = t.main === c.uid;
        const stuck = c.statuses.some((x) => x.kind === "immobilized" && !x.fresh);
        if (active || !t.activated.includes(c.uid)) {
          const budget = active ? t.movementLeft : movementBudget(s, c, t.die);
          const opts = active ? moveOptionsFor(s, c) : { ...moveOptionsFor(s, c), phasing: false };
          reach[c.uid] = stuck || budget <= 0 ? [] : [...reachableMap(s, c, budget, opts).values()].map((r) => ({ pos: r.pos, cost: r.cost }));
        }
        const stunned = c.statuses.some((x) => x.kind === "stunned" && !x.fresh);
        if (!t.basicUsed.includes(c.uid) && !stunned) {
          const bdef = getChampionDef(c.defId).basic;
          basics[c.uid] = { name: bdef.name, target: bdef.target, range: bdef.range, targets: enumerateTargets(s, c, bdef, 0, 300) };
        }
      }
      hints.reach = reach;
      hints.basics = basics;
      hints.canStay = mine.champions.filter((c) => c.alive && t.main !== c.uid && !t.activated.includes(c.uid)).map((c) => c.uid);
    }
    hints.canSkipDraw = !s.pending && s.turn.team === me && s.turn.phase === "draw" && handLimitCount(s, me) >= balance.hand.max_size;
    hints.mustDiscard = !s.pending && s.turn.team === me && s.turn.phase === "discard";
    hints.handLimit = balance.hand.max_size;
  }

  return {
    width: s.width,
    height: s.height,
    round: s.round,
    winner: s.winner,
    bountyTeam: s.bountyTeam,
    me,
    awaiting: aw,
    turn: {
      team: s.turn.team,
      phase: s.turn.phase,
      main: s.turn.main,
      activated: s.turn.activated,
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
    log: s.log.slice(-150),
    hints,
    foe,
    cardCount: cardDefs.length,
  };
}
