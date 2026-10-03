// Bot guloso do motor hexagonal (roster v2) — mesma ideia de src/bots/greedy.ts (MVP):
// simula cada jogada legal numa cópia do jogo e escolhe a que mais melhora o placar
// (evaluate). Vai primeiro aos monstros mais próximos de cada campeão, depois ao boss
// ou aos campeões inimigos. Não usa cartas de parede com inteligência (o valor delas
// é difícil de medir aqui, igual ao MVP).

import { hexDistance, type Hex } from "../design/hexGrid";
import { createRng, type Rng } from "../engine/rng";
import { getCardDefV2, getCardRankV2, getChampionDefV2 } from "../engine-v2/data";
import { applyActionV2, fastPlaysV2, legalActionsV2, type ActionV2 } from "../engine-v2/turn";
import { getChampionV2, otherTeam, type ChampionStateV2, type GameStateV2, type StatusV2, type TeamId } from "../engine-v2/state";

export interface GreedyOptionsV2 {
  /** 0 a 1: quanto o bot valoriza ferir campeões inimigos em vez de ir ao boss/monstro. */
  aggression?: number;
}

/** Placar do ponto de vista de `team`. Quanto maior, melhor. */
export function evaluateV2(s: GameStateV2, team: TeamId, aggression = 0.6): number {
  const foe = otherTeam(team);
  if (s.winner) return s.winner === team ? 100000 : -100000;
  let v = 0;
  for (const c of s.teams[foe].champions) {
    v += (c.alive ? c.maxHp - c.hp : c.maxHp + 15) * aggression;
    v += statusesValue(c.statuses.filter((st) => st.negative));
    // Achado (03/10/2026): sem isto, buff que a Aurelia põe NUM INIMIGO (não
    // existe hoje, mas por simetria) e, mais importante, qualquer buff que o
    // próprio inimigo já tenha não pesava nada — o bot não enxergava motivo
    // pra correr atrás de quebrar um inimigo buffado antes que ele conecte.
    v -= statusesValue(c.statuses.filter((st) => !st.negative));
  }
  for (const c of s.teams[team].champions) {
    v -= c.alive ? (c.maxHp - c.hp) * 1.0 : c.maxHp * 1.0 + 20;
    v += c.shield * 0.4;
    v -= statusesValue(c.statuses.filter((st) => st.negative));
    // Achado (03/10/2026): buff em aliado (Fervor/Presteza/Égide/Hino de
    // Guerra da Aurelia etc.) não valia NADA antes — o bot guloso (lookahead
    // de 1 passo, só vê HP/mana/escudo na hora) nunca tinha motivo pra gastar
    // mana num buff, então o kit inteiro da Aurelia (quase só isso) nunca era
    // jogado numa simulação de 50 partidas (ver KANBAN.md item 40).
    v += statusesValue(c.statuses.filter((st) => !st.negative));
  }
  v += s.boss.alive ? (s.boss.maxHp - s.boss.hp) * 1.2 : 150;
  // Peso de dano em monstro alto o bastante pra compensar a reação (contra-ataque) do
  // próprio monstro — do contrário o bot guloso (lookahead de 1 passo) nunca ataca
  // monstro nenhum, porque o contra-ataque imediato sempre "parece" pior que o dano
  // causado, e a recompensa real (carta/bônus permanente) só vem no abate final.
  for (const m of s.monsters) v += (m.maxHp - Math.max(0, m.hp)) * 1.1 + (m.alive ? 0 : 10);
  // Lacaio do boss (Prole): obstáculo/ameaça pro time, não pro bando que o criou (igual ao MVP, src/bots/greedy.ts).
  for (const m of s.minions) if (m.alive) v -= m.hp * 0.2;
  v += s.teams[team].mana * 0.35;
  return v;
}

/** Soma o valor dos efeitos, contando cada tipo uma vez (o maior), para o bot não acumular efeitos iguais. */
function statusesValue(list: StatusV2[]): number {
  const best = new Map<string, number>();
  for (const st of list) best.set(st.status, Math.max(best.get(st.status) ?? 0, statusValue(st.status, st.amount ?? 1)));
  let sum = 0;
  for (const value of best.values()) sum += value;
  return sum;
}

function statusValue(status: string, amount: number): number {
  switch (status) {
    case "mark":
      return 2;
    case "move_penalty":
    case "movement_reduced":
      return amount * 0.5;
    case "immobilized":
    case "root":
      return 2;
    case "stunned":
      return 3;
    case "silenced":
      return 2;
    case "link":
      return 1.5;
    case "poison":
      return amount * 1.2;
    // Buff/debuff de atributo (achado 03/10/2026, ver KANBAN.md item 40): mesmo
    // peso nos dois sentidos — "damage_down"/"defense_down" num inimigo (Aurelia,
    // Sylvane) valem o mesmo que "damage_buff"/"defense_buff" num aliado, porque é
    // o mesmo tipo de vantagem olhando pra lados opostos. Sem isto, nenhuma carta
    // de buff/debuff de atributo tinha valor nenhum pro bot guloso (Aurelia/Dorin
    // nunca eram jogados numa simulação de 50 partidas). **Valor baixo e FIXO de
    // propósito** (não escala com `amount`): um valor alto o bastante pra competir
    // com o ganho de uma andada em direção ao alvo (`(gapNow-gap)*1.5` abaixo)
    // fazia o bot preferir reaplicar buff pra sempre (a cada vez que a duração
    // expirava, recastar "parecia" lucro de novo) em vez de terminar o combate —
    // partida de seed 5 nunca convergia (1942 rodadas, sem vencedor) com valor
    // escalado por `amount`. Baixo o bastante, só desempata entre duas opções
    // já equivalentes, sem nunca vencer uma andada ou um ataque de verdade.
    case "damage_buff":
    case "damage_down":
    case "defense_buff":
    case "defense_down":
      return 0.5;
    case "movement_buff":
      return 0.3;
    case "block_ranged_attacks":
    case "protective_dome":
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Casa que `champion` deve perseguir: monstro vivo mais próximo primeiro (só
 * nas primeiras rodadas — "fase de coleta", igual ao bot guloso do MVP),
 * depois o boss, senão o inimigo mais próximo. Sem o corte por rodada, o bot
 * nunca abandona os monstros (sempre sobra algum dos 40) e a partida não
 * converge — farming de monstro sozinho nunca elimina os 3 campeões
 * inimigos ao mesmo tempo (condição de vitória, seção 18).
 */
export function objectiveV2(s: GameStateV2, team: TeamId, champion: ChampionStateV2): Hex {
  const foe = otherTeam(team);
  const aliveMonsters = s.monsters.filter((m) => m.alive);
  if (aliveMonsters.length > 0 && s.round <= 15) {
    aliveMonsters.sort((a, b) => hexDistance(champion.pos, a.pos) - hexDistance(champion.pos, b.pos));
    return aliveMonsters[0].pos;
  }
  const foes = s.teams[foe].champions.filter((c) => c.alive);
  if (foes.length > 0 && (s.round > 25 || !s.boss.alive)) {
    foes.sort((a, b) => hexDistance(champion.pos, a.pos) - hexDistance(champion.pos, b.pos));
    return foes[0].pos;
  }
  if (s.boss.alive) return s.boss.pos;
  if (foes.length > 0) return foes.sort((a, b) => hexDistance(champion.pos, a.pos) - hexDistance(champion.pos, b.pos))[0].pos;
  return champion.pos;
}

/** Distância ideal ao alvo: o alcance da melhor ação de ataque do campeão (básica). */
function desiredRange(c: ChampionStateV2): number {
  const b = getChampionDefV2(c.defId).basic;
  if (b.range === "self") return 3;
  return Math.max(1, b.range - 1);
}

const WALL_ONLY_EFFECTS = new Set(["create_wall", "reinforce_wall", "destroy_wall", "create_wall_ring"]);

export function greedyBotV2(opts: GreedyOptionsV2 = {}, rng: Rng = createRng(1)) {
  const aggression = opts.aggression ?? 0.6;
  let turnKey = "";
  let actionsThisTurn = 0;

  const simulate = (s: GameStateV2, team: TeamId, a: ActionV2): number | null => {
    const sim = structuredClone(s) as GameStateV2;
    try {
      applyActionV2(sim, team, a);
      let guard = 0;
      while (sim.pending && guard++ < 6) applyActionV2(sim, sim.pending.priority, { type: "pass" });
    } catch {
      return null;
    }
    return evaluateV2(sim, team, aggression);
  };

  return function choose(s: GameStateV2, team: TeamId): ActionV2 {
    const actions = legalActionsV2(s, team);
    if (actions.length === 0) throw new Error(`Sem ações legais para ${team} (fase ${s.turn.phase})`);

    // ---- responder a uma carta/básica/ativação do boss já empilhada ----
    if (s.pending) {
      const top = s.pending.stack[s.pending.stack.length - 1];
      const targetUid = top.target.uid;
      let best: ActionV2 | null = null;
      let bestVal = 0.5;
      for (const p of fastPlaysV2(s, team)) {
        const def = getCardDefV2(p.card.cardId);
        const rank = getCardRankV2(def, p.rank);
        const protective = rank.effects.some((e) => ["shield", "heal", "remove_negative_effects"].includes(e.type));
        if (!protective) continue;
        let ally: ChampionStateV2 | null = null;
        try {
          ally = p.target.uid ? getChampionV2(s, p.target.uid) : null;
        } catch {
          ally = null;
        }
        if (!ally || ally.team !== team) continue;
        const threatened = ally.uid === targetUid || ally.hp <= ally.maxHp * 0.5;
        if (!threatened) continue;
        const cur = evaluateV2(s, team, aggression);
        const play: ActionV2 = { type: "play", card: p.card.uid, rank: p.rank, target: p.target };
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

    switch (s.turn.phase) {
      case "draw": {
        const skip = actions.find((a) => a.type === "skipDraw");
        if (skip) return skip;
        const counts = (uid: string) => s.teams[team].hand.filter((c) => c.owner === uid).length;
        const drawable = actions.filter((a): a is Extract<ActionV2, { type: "draw" }> => a.type === "draw");
        drawable.sort((a, b) => counts(a.champion) - counts(b.champion));
        return drawable[0];
      }
      case "discard": {
        const list = actions.filter((a) => a.type === "discard");
        return rng.pick(list);
      }
      case "act": {
        const base = evaluateV2(s, team, aggression);
        let best: ActionV2 | null = null;
        let bestVal = 0.05;

        // Ataques e cartas: mede o ganho numa cópia do jogo.
        for (const a of actions) {
          if (a.type !== "play" && a.type !== "basic") continue;
          if (a.type === "play") {
            const inst = s.teams[team].hand.find((c) => c.uid === a.card)!;
            const def = getCardDefV2(inst.cardId);
            const rank = getCardRankV2(def, a.rank);
            if (rank.effects.every((e) => WALL_ONLY_EFFECTS.has(e.type))) continue;
          }
          const val = simulate(s, team, a);
          if (val !== null && val - base > bestVal) {
            bestVal = val - base;
            best = a;
          }
        }

        // Movimento: cada campeão se aproxima do próprio alvo até a distância ideal.
        for (const a of actions) {
          if (a.type !== "move" || !a.champion) continue;
          const c = getChampionV2(s, a.champion);
          const want = desiredRange(c);
          const goal = objectiveV2(s, team, c);
          const gapNow = Math.max(0, hexDistance(c.pos, goal) - want);
          const gap = Math.max(0, hexDistance(a.to, goal) - want);
          let val = (gapNow - gap) * 1.5;
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
