// Visão do jogo (motor hexagonal, roster v2) para um jogador — espelha
// src/server/view.ts (MVP): só o que esse jogador pode ver (a mão do adversário e
// a ordem dos baralhos ficam no servidor) mais dicas do que ele pode fazer agora.
//
// Diferenças do MVP refletidas aqui (ver src/engine-v2/*):
// - Cada carta na mão já tem um único "dono"/lançador fixo (CardInstanceV2.owner)
//   — não existe a escolha de "caster" do MVP (cartas de besta jogáveis por
//   qualquer campeão). Em troca, cada carta tem vários RANKS (custo/alcance/
//   efeito diferentes) — as dicas de alvo são por rank, não por lançador.
// - Não há armadilhas, molas, portais, torres de vigia nem "structures" no
//   estado v2 (GameStateV2 só tem walls/ground/monsters/minions/boss) — a view
//   não inventa esses campos.

import { getCardDefV2, getChampionDefV2, basicTargetV2 } from "../engine-v2/data";
import { getChampionV2, type GameStateV2, type TeamId } from "../engine-v2/state";
import { canPayCardV2 } from "../engine-v2/mana";
import { movementBudgetV2, reachableMap } from "../engine-v2/movement";
import { rankRangeV2, resurrectBlockedV2 } from "../engine-v2/cardPlay";
import { cannotBasicV2, cannotCastV2 } from "../engine-v2/turn";
import { canSacrificeV2 } from "../engine-v2/sacrifice";
import { enumerateTargetsV2 } from "../engine-v2/targeting";
import { statusAmount } from "../engine-v2/status";
import { knownCellKeysV2, teamVisionViewV2 } from "../engine-v2/vision";
import { hexKey } from "../design/hexGrid";
import { balance } from "../engine/data";

export type AwaitingV2 =
  | { team: TeamId; kind: "boss" | "draw" | "act" | "discard" | "respond" | "over" };

export function awaitingV2(s: GameStateV2): AwaitingV2 {
  if (s.winner) return { team: s.turn.team, kind: "over" };
  if (s.pending) return { team: s.pending.priority, kind: "respond" };
  return { team: s.turn.team, kind: s.turn.phase };
}

/** Mão "de verdade" pro limite de cartas: cartas de recompensa de monstro não contam (ver turn.ts). */
const nonMonsterHandSize = (hand: { monster?: boolean }[]): number => hand.filter((c) => !c.monster).length;

export function viewForV2(s: GameStateV2, me: TeamId | null): unknown {
  const foe: TeamId | null = me === null ? null : me === "A" ? "B" : "A";
  const aw = awaitingV2(s);

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
      handLimitCount: nonMonsterHandSize(t.hand),
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
    const ranks: Record<string, number[]> = {};
    const targets: Record<string, Record<number, unknown>> = {};
    for (const c of mine.hand) {
      const def = getCardDefV2(c.cardId);
      let owner;
      try {
        owner = getChampionV2(s, c.owner);
      } catch {
        owner = null;
      }
      const okRanks: number[] = [];
      const canPlayNow = (inWindow && def.fast) || myAct;
      if (owner && owner.alive && canPlayNow && !cannotCastV2(owner)) {
        for (const rank of def.ranks) {
          if (!canPayCardV2(s, me, owner, rank.cost)) continue;
          if (resurrectBlockedV2(s, me, rank.effects)) continue;
          okRanks.push(rank.rank);
        }
      }
      ranks[c.uid] = okRanks;
      playable[c.uid] = okRanks.length > 0;
      if (owner && okRanks.length > 0) {
        targets[c.uid] = {};
        // Toxina Concentrada do Thorne (sacrifício de passiva, regras-e-decisoes.md
        // §22): -2 casas de alcance em toda carta do turno — refletido aqui pra
        // dica não mostrar um alvo que a jogada de verdade (cardPlay.ts) rejeitaria.
        const rangeBonus = -statusAmount(owner, "sacrifice_range_penalty");
        for (const rank of def.ranks) {
          if (!okRanks.includes(rank.rank)) continue;
          targets[c.uid][rank.rank] = enumerateTargetsV2(s, owner, { range: rankRangeV2(rank), target: def.target }, rangeBonus, 300);
        }
      }
    }
    hints.playable = playable;
    hints.ranks = ranks;
    hints.targets = targets;
    if (myAct) {
      const t = s.turn;
      const reach: Record<string, unknown[]> = {};
      const basics: Record<string, unknown> = {};
      for (const c of mine.champions) {
        if (!c.alive) continue;
        const active = t.main === c.uid;
        if (active || !t.activated.includes(c.uid)) {
          const budget = active ? t.movementLeft : movementBudgetV2(c, t.die);
          reach[c.uid] = budget <= 0 ? [] : [...reachableMap(s, c, budget).values()].map((r) => ({ pos: r.pos, cost: r.cost }));
        }
        if (!t.basicUsed.includes(c.uid) && !cannotBasicV2(c)) {
          const bdef = getChampionDefV2(c.defId).basic;
          const target = basicTargetV2(bdef);
          const rangeBonus = -statusAmount(c, "sacrifice_range_penalty");
          basics[c.uid] = { name: bdef.name, target, range: bdef.range, targets: enumerateTargetsV2(s, c, { range: bdef.range, target }, rangeBonus, 300) };
        }
      }
      hints.reach = reach;
      hints.basics = basics;
      hints.canStay = mine.champions.filter((c) => c.alive && t.main !== c.uid && !t.activated.includes(c.uid)).map((c) => c.uid);
      // Sacrifício de passiva (regras-e-decisoes.md §22): lista quem pode
      // declarar agora. O Varek (Último Bastião) também exige escolher um
      // aliado — não listado aqui por simplicidade (ver sacrificeAllyTargetsV2
      // em sacrifice.ts, usado por legalActionsV2 pros bots).
      hints.sacrifice = mine.champions
        .filter((c) => c.alive && getChampionDefV2(c.defId).sacrifice !== null && !canSacrificeV2(s, me, c.uid))
        .map((c) => c.uid);
    }
    hints.canSkipDraw = !s.pending && s.turn.team === me && s.turn.phase === "draw" && nonMonsterHandSize(mine.hand) >= balance.hand.max_size;
    hints.mustDiscard = !s.pending && s.turn.team === me && s.turn.phase === "discard";
    hints.handLimit = balance.hand.max_size;
  }

  // Neblina de guerra (regras-e-decisoes.md §20, vision.ts): o que a equipe de
  // quem está vendo já viu (agora ou antes) decide o que do MAPA (monstro,
  // parede, chão, estrutura, portal, dano retardado) aparece pra ela — cada um
  // é estático ou some sozinho quando destruído/expira, então "já visto"
  // continua confiável sem precisar revalidar a cada turno. O boss e os
  // campeões (dos dois times) NÃO são filtrados por visão: o boss é um marco
  // central sempre "conhecido" (decisão [PADRÃO]) e esconder posição/vida de
  // campeão inimigo é uma mudança maior de UX (modo battle royale) que fica
  // pendente de confirmação do dono do projeto — ver KANBAN.md item 39.
  const known = me ? knownCellKeysV2(s, me) : null;
  const inKnown = (h: { pos: { q: number; r: number } }) => !known || known.has(hexKey(h.pos));

  return {
    board: s.board,
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
      basicUsed: s.turn.basicUsed,
    },
    pending: s.pending && {
      priority: s.pending.priority,
      chain: s.pending.chain,
      stack: s.pending.stack,
    },
    teams,
    monsters: s.monsters.filter(inKnown),
    minions: s.minions.filter(inKnown),
    boss: { ...s.boss, deck: s.boss.deck.length, discard: s.boss.discard },
    temples: s.temples,
    walls: s.walls.filter(inKnown),
    structures: s.structures.filter(inKnown),
    portals: known ? s.portals.filter((p) => known.has(hexKey(p.a)) || known.has(hexKey(p.b))) : s.portals,
    delayedDamages: s.delayedDamages.filter(inKnown),
    ground: s.ground.filter(inKnown),
    vision: me ? teamVisionViewV2(s, me) : null,
    log: s.log.slice(-150),
    hints,
    foe,
  };
}
