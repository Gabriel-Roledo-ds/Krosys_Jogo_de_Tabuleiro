// Morte, retorno, recompensa de monstro e vitória.
// Chamado depois que toda a pilha de respostas rápidas termina.

import { balance, getBossCard, getCardDef, getChampionDef, monsterTypes } from "./data";
import { rngOf } from "./rng";
import {
  allChampions,
  log,
  type CardInstance,
  type ChampionState,
  type GameState,
  type TeamId,
} from "./state";
import { freeStartCell, isFreeCell } from "./world";
import { addPosSafe } from "./util";

export function resolveDeaths(s: GameState): void {
  let changed = true;
  while (changed) {
    changed = false;

    // Boss primeiro: quem dá o último hit vence.
    if (s.boss.alive && s.boss.hp <= 0) {
      s.boss.alive = false;
      s.boss.hp = 0;
      const winner = s.boss.lastHitBy?.team ?? s.turn.team;
      s.winner = winner;
      s.turn.phase = "over";
      s.pending = null;
      log(s, `O Boss cai! Vence a equipe ${winner}.`);
      return;
    }

    for (const c of allChampions(s)) {
      if (c.alive && c.hp <= 0) {
        killChampion(s, c);
        changed = true;
      }
    }
    for (const m of s.monsters) {
      if (m.alive && m.hp <= 0) {
        m.alive = false;
        log(s, `${monsterTypes[m.type].name} (${m.uid.slice(0, 3)}) derrotado`);
        const hit = m.lastHitBy;
        if (hit) {
          const killer = allChampions(s).find((c) => c.uid === hit.champion);
          const team = s.teams[hit.team];
          const card: CardInstance = {
            uid: `${m.uid}#${m.rewardCard}#${s.nextId++}`,
            cardId: m.rewardCard,
            owner: killer && killer.alive ? killer.uid : team.champions.find((c) => c.alive)!.uid,
            monster: true,
          };
          team.hand.push(card);
          log(s, `Equipe ${hit.team} recebe a carta ${m.rewardCard}`);
        }
        changed = true;
      }
    }
    const before = s.minions.length;
    s.minions = s.minions.filter((m) => m.hp > 0);
    if (s.minions.length !== before) changed = true;
  }
}

/** Campeão morre: sai do tabuleiro, guarda a mão dele e só volta no começo do próximo turno da equipe. */
export function killChampion(s: GameState, c: ChampionState): void {
  log(s, `${getChampionDef(c.defId).name} (${c.team}) morreu`);
  c.alive = false;
  c.outTurns = balance.death.turns_out;
  c.hp = 0;
  c.shield = 0;
  c.reflect = 0;
  c.statuses = [];
  const team = s.teams[c.team];
  // Cartas de besta são da equipe: ficam na mão. As demais cartas dele ficam guardadas.
  c.limbo = team.hand.filter((card) => card.owner === c.uid && !card.monster);
  team.hand = team.hand.filter((card) => card.owner !== c.uid || card.monster);
  // A equipe perde só uma carta de besta (a mais antiga), e só se tiver mais de uma.
  const beasts = team.hand.filter((card) => card.monster);
  if (beasts.length > balance.death.beast_cards_lost_on_champion_death) {
    const lost = beasts[0];
    team.hand = team.hand.filter((card) => card.uid !== lost.uid);
    log(s, `Equipe ${c.team} perde a carta de besta ${getCardDef(lost.cardId).name}`);
  }
  s.watches = s.watches.filter((w) => w.owner !== c.uid);
  c.pos = { x: -1, y: -1 };
}

/** Início do turno: campeões mortos voltam à largada, imunes, com vida cheia e a mão devolvida ao baralho. */
export function returnDeadChampions(s: GameState, team: TeamId): void {
  for (const c of s.teams[team].champions) {
    if (c.alive) continue;
    if (c.outTurns > 0) {
      c.outTurns -= 1;
      log(s, `${getChampionDef(c.defId).name} (${team}) ainda está fora (${c.outTurns > 0 ? c.outTurns + " turno(s)" : "volta no próximo turno"})`);
      continue;
    }
    c.alive = true;
    c.hp = c.maxHp;
    c.pos = freeStartCell(s, team);
    c.untargetable = true;
    const deck = s.teams[team].decks[c.uid];
    deck.draw = rngOf(s).shuffle([...deck.draw, ...c.limbo.map((card) => ({ ...card, monster: false }))]);
    // Carta de monstro devolvida vira carta normal do baralho dele.
    c.limbo = [];
    log(s, `${getChampionDef(c.defId).name} (${team}) volta à largada`);
  }
}

/** Ressurgir: traz o aliado de volta na hora, ao lado do Curandeiro, com a mão preservada. */
export function resurrect(s: GameState, caster: ChampionState, dead: ChampionState): boolean {
  const cell = addPosSafe(caster.pos, (p) => isFreeCell(s, p));
  if (!cell) return false;
  dead.alive = true;
  dead.hp = dead.maxHp;
  dead.pos = cell;
  s.teams[dead.team].hand.push(...dead.limbo);
  dead.limbo = [];
  log(s, `${getChampionDef(dead.defId).name} ressurge`);
  return true;
}

export { getBossCard };
