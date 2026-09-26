// Bot guloso: simula cada jogada legal numa cópia do jogo e escolhe a que mais melhora
// o placar. Coleta monstros perto de casa primeiro, depois vai ao boss e ataca inimigos
// que estiverem ao alcance. Não usa cartas de construção com inteligência (paredes,
// armadilhas): o valor delas é difícil de medir, então ele as ignora.

import { distance, type Pos } from "../engine/board";
import { balance, getChampionDef } from "../engine/data";
import { applyAction, fastPlays, legalActions, type Action } from "../engine/turn";
import { allChampions, getChampion, otherTeam, type ChampionState, type GameState, type TeamId } from "../engine/state";
import { createRng, type Rng } from "../engine/rng";
import { monsterZonesAt } from "../engine/world";
import { getCardDef } from "../engine/data";

export interface GreedyOptions {
  /** 0 a 1: quanto o bot valoriza ferir campeões inimigos em vez de ir ao boss. */
  aggression?: number;
}

/** Placar do ponto de vista de `team`. Quanto maior, melhor. */
export function evaluate(s: GameState, team: TeamId, aggression = 0.6): number {
  const foe = otherTeam(team);
  if (s.winner) return s.winner === team ? 100000 : -100000;
  let v = 0;
  for (const c of s.teams[foe].champions) {
    v += (c.alive ? c.maxHp - c.hp : c.maxHp + 15) * aggression;
    for (const st of c.statuses) v += statusValue(st.kind, st.amount ?? 1);
  }
  for (const c of s.teams[team].champions) {
    v -= c.alive ? (c.maxHp - c.hp) * 1.3 : c.maxHp * 1.3 + 20;
    v += c.shield * 0.4;
    for (const st of c.statuses) if (st.negative) v -= statusValue(st.kind, st.amount ?? 1);
  }
  v += (s.boss.maxHp - s.boss.hp) * 1.2;
  v += s.monsters.filter((m) => !m.alive).length * 0;
  for (const m of s.monsters) v += (m.maxHp - Math.max(0, m.hp)) * 0.5 + (m.alive ? 0 : 6);
  for (const m of s.minions) v -= m.hp * 0.2;
  for (const g of s.ground) {
    if (g.kind !== "fire" || g.team !== team) continue;
    const onEnemy = allChampions(s).some((c) => c.alive && c.team === foe && distance(c.pos, g.pos) === 0);
    if (onEnemy) v += g.damage * g.remaining * 0.8;
  }
  // Mão e mana valem algo: gastar precisa compensar.
  v += s.teams[team].mana * 0.35;
  return v;
}

function statusValue(kind: string, amount: number): number {
  switch (kind) {
    case "mark":
      return 2;
    case "move_penalty":
      return amount * 0.5;
    case "immobilized":
      return 2;
    case "stunned":
      return 3;
    case "silenced":
      return 2;
    case "link":
      return 1.5;
    default:
      return 0;
  }
}

/** Ponto que o time quer alcançar: monstros de perto para longe, depois o boss. */
export function objective(s: GameState, team: TeamId): Pos {
  const order = ["weak", "medium", "strong"];
  const start = balance.teams.start_areas[team][4];
  for (const type of order) {
    const list = s.monsters.filter((m) => m.alive && m.type === type);
    if (list.length === 0) continue;
    list.sort((a, b) => distance(a.pos, start) - distance(b.pos, start));
    return list[0].pos;
  }
  return s.boss.pos;
}

/** Distância ideal ao alvo: o alcance da melhor ação de ataque do campeão. */
function desiredRange(c: ChampionState): number {
  const b = getChampionDef(c.defId).basic;
  if (b.range === "self") return 3;
  return Math.max(1, b.range - 1);
}

export function greedyBot(opts: GreedyOptions = {}, rng: Rng = createRng(1)) {
  const aggression = opts.aggression ?? 0.6;
  let turnKey = "";
  let actionsThisTurn = 0;

  const simulate = (s: GameState, team: TeamId, a: Action): number | null => {
    const sim = structuredClone(s) as GameState;
    try {
      applyAction(sim, team, a);
      let guard = 0;
      while (sim.pending && guard++ < 6) applyAction(sim, sim.pending.priority, { type: "pass" });
    } catch {
      return null;
    }
    return evaluate(sim, team, aggression);
  };

  return function choose(s: GameState, team: TeamId): Action {
    const actions = legalActions(s, team);
    if (actions.length === 0) throw new Error(`Sem ações legais para ${team} (fase ${s.turn.phase})`);

    // ---- responder a uma carta ou ao boss ----
    if (s.pending) {
      const top = s.pending.stack[s.pending.stack.length - 1];
      const targetUid = top.target.uid;
      let best: Action | null = null;
      let bestVal = 0.5;
      for (const p of fastPlays(s, team)) {
        const def = getCardDef(p.card.cardId);
        const protective = def.effects.some((e) => ["shield", "heal", "remove_negative_effects"].includes(e.type));
        if (!protective) continue;
        const ally = p.target.uid ? getChampion(s, p.target.uid) : null;
        if (!ally || ally.team !== team) continue;
        const threatened = ally.uid === targetUid || ally.hp <= ally.maxHp * 0.5;
        if (!threatened) continue;
        const cur = evaluate(s, team, aggression);
        const play: Action = { type: "play", card: p.card.uid, target: p.target, caster: p.caster };
        const val = simulate(s, team, play);
        if (val !== null && val - cur > bestVal) {
          bestVal = val - cur;
          best = play;
        }
      }
      return best ?? { type: "pass" };
    }

    const key = `${s.round}-${s.turn.team}`;
    if (key !== turnKey) {
      turnKey = key;
      actionsThisTurn = 0;
    }
    actionsThisTurn++;

    const goal = objective(s, team);

    switch (s.turn.phase) {
      case "draw": {
        // Mão cheia: melhor não comprar do que descartar depois.
        const skip = actions.find((a) => a.type === "skipDraw");
        if (skip) return skip;
        // Compra do campeão com menos cartas na mão.
        const counts = (uid: string) => s.teams[team].hand.filter((c) => c.owner === uid).length;
        const drawable = actions.filter((a): a is Extract<Action, { type: "draw" }> => a.type === "draw");
        drawable.sort((a, b) => counts(a.champion) - counts(b.champion));
        return drawable[0];
      }
      case "discard": {
        const list = actions.filter((a) => a.type === "discard");
        return rng.pick(list);
      }
      case "act": {
        const base = evaluate(s, team, aggression);
        let best: Action | null = null;
        let bestVal = 0.05;

        // Ataques e cartas: mede o ganho numa cópia do jogo.
        for (const a of actions) {
          if (a.type !== "play" && a.type !== "basic") continue;
          if (a.type === "play") {
            const def = getCardDef(s.teams[team].hand.find((c) => c.uid === a.card)!.cardId);
            if (def.effects.every((e) => ["create_wall", "create_walls_line", "create_walls_shape", "create_walls_around_target", "hidden_trap", "spring", "create_portal_pair", "create_structure", "reinforce_wall", "destroy_wall"].includes(e.type))) continue;
          }
          const val = simulate(s, team, a);
          if (val !== null && val - base > bestVal) {
            bestVal = val - base;
            best = a;
          }
        }

        // Movimento: cada campeão se aproxima do alvo até a distância ideal, sem parar à toa ao alcance de monstros.
        for (const a of actions) {
          if (a.type !== "move" || !a.champion) continue;
          const c = getChampion(s, a.champion);
          const want = desiredRange(c);
          const gapNow = Math.max(0, distance(c.pos, goal) - want);
          const gap = Math.max(0, distance(a.to, goal) - want);
          let val = (gapNow - gap) * 1.5;
          // Evita parar dentro de um raio que aumenta o dano recebido (a menos que seja o objetivo).
          for (const z of monsterZonesAt(s, a.to)) {
            if (z.passive.type === "aura_damage_taken_multiplier" && z.passive.multiplier > 1 && distance(z.monster.pos, goal) > 0) val -= 2;
          }
          val -= gap * 0.01;
          if (val > bestVal && val > 0.05) {
            bestVal = val;
            best = a;
          }
        }
        if (best && actionsThisTurn < 90) return best;
        return { type: "end" };
      }
      default:
        return actions[0];
    }
  };
}
