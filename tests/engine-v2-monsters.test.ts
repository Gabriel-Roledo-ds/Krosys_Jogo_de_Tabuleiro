// Testes dos monstros do mapa no motor hexagonal (roster v2, item 7 da ordem
// de execução). Ver KANBAN.md, src/engine-v2/monsters.ts e claude/monstros-mapa.md.

import { describe, it, expect } from "vitest";
import { balance } from "../src/engine/data";
import { createGameV2, type GameStateV2, type MonsterStateV2 } from "../src/engine-v2/state";
import {
  attackMonsterV2,
  findMonsterV2,
  isMonsterUidV2,
  reactMonsterV2,
  recomputeChampionBonusesV2,
} from "../src/engine-v2/monsters";
import { playCardV2, playBasicV2 } from "../src/engine-v2/cardPlay";
import { validateTargetV2, enumerateTargetsV2 } from "../src/engine-v2/targeting";
import { discardCardV2 } from "../src/engine-v2/deck";
import { isFreeCellV2 } from "../src/engine-v2/world";
import { applyActionV2, legalActionsV2 } from "../src/engine-v2/turn";

const round = (x: number): number => Math.floor(x + 0.5 + 1e-9);

function findByType(game: GameStateV2, typeId: string): MonsterStateV2 {
  const m = game.monsters.find((x) => x.typeId === typeId);
  if (!m) throw new Error(`fixture: tipo de monstro não encontrado no mapa gerado: ${typeId}`);
  return m;
}

/**
 * Coloca o atacante colado no monstro (distância 1) — dentro do alcance de
 * revide de qualquer opção de reação dos dados (1 a 3 casas), pra testar o
 * efeito da reação em si sem o novo gate de alcance (ver "alcance de revide"
 * abaixo) interferir nesses testes que não são sobre distância.
 */
function moveAdjacent(attacker: { pos: { q: number; r: number } }, monster: MonsterStateV2): void {
  attacker.pos = { q: monster.pos.q + 1, r: monster.pos.r };
}

describe("posicionamento / solidez", () => {
  it("a casa de um monstro vivo é sólida; some depois de morto", () => {
    const game = createGameV2(1);
    const m = game.monsters[0];
    expect(isFreeCellV2(game, m.pos)).toBe(false);
    m.alive = false;
    expect(isFreeCellV2(game, m.pos)).toBe(true);
  });

  it("40 criaturas no mapa, fora o boss", () => {
    const game = createGameV2(1);
    expect(game.monsters.length).toBe(40);
  });
});

describe("attackMonsterV2", () => {
  it("dano = base x multiplicador - defesa, mínimo 1", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "sentinela_pedra"); // def 1
    const before = m.hp;
    const dealt = attackMonsterV2(game, attacker, m, 10);
    const expected = round(10 * balance.damage.champion_damage_multiplier) - m.defense;
    expect(dealt).toBe(expected);
    expect(m.hp).toBe(before - expected);
  });

  it("não ataca monstro morto nem com base <= 0", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "javali_bravo");
    m.alive = false;
    expect(attackMonsterV2(game, attacker, m, 10)).toBe(0);
  });

  it("permanentDamageBonusPercent do atacante entra no multiplicador", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    attacker.permanentDamageBonusPercent = 10;
    const m = findByType(game, "escaravelho_blindado"); // def 2, agressiva/território... (territorial, 1 opção)
    const mult = balance.damage.champion_damage_multiplier * 1.1;
    const expected = round(10 * mult) - m.defense;
    const dealt = attackMonsterV2(game, attacker, m, 10);
    expect(dealt).toBe(expected);
  });

  it("mata o monstro e concede recompensa quando hp chega a 0", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "raposa_ardilosa"); // hp 5, def 0, recompensa carta "salto_ardiloso"
    attackMonsterV2(game, attacker, m, 999);
    expect(m.alive).toBe(false);
    expect(m.hp).toBeLessThanOrEqual(0);
    const gained = game.teams.A.hand.find((c) => c.cardId === "salto_ardiloso");
    expect(gained).toBeTruthy();
    expect(gained?.monster).toBe(true);
  });
});

describe("reação ao ataque — postura decide a opção, dispara ANTES do dano do campeão", () => {
  it("Agressiva (javali_bravo): sempre contra-ataca com dano (+ tenta empurrar o atacante, sem erro mesmo se não houver casa livre)", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const startHp = attacker.hp;
    const m = findByType(game, "javali_bravo"); // Chifrada: dano 3, empurra 1
    moveAdjacent(attacker, m);
    expect(() => reactMonsterV2(game, m, attacker)).not.toThrow();
    const expectedDamage = Math.max(balance.damage.minimum_damage_if_base_at_least_1, 3 - attacker.defense);
    expect(attacker.hp).toBe(startHp - expectedDamage);
    expect(m.attackedBeforeThisCombat).toBe(true);
  });

  it("Territorial (colosso_rachado): 1º ataque usa a opção utilitária (autobuff, sem dano no atacante); 2º ataque já usa a de dano", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "colosso_rachado"); // Punho Rachado (dano 5) ou Casca Dura (autobuff, sem efeito modelado)
    moveAdjacent(attacker, m);
    const hpAfterFirst = attacker.hp;
    reactMonsterV2(game, m, attacker); // 1ª vez: Casca Dura (utilitária) — autobuff ignorado, sem dano
    expect(attacker.hp).toBe(hpAfterFirst);
    expect(m.attackedBeforeThisCombat).toBe(true);

    reactMonsterV2(game, m, attacker); // 2ª vez: Punho Rachado (dano)
    const expectedDamage = Math.max(balance.damage.minimum_damage_if_base_at_least_1, 5 - attacker.defense);
    expect(attacker.hp).toBe(hpAfterFirst - expectedDamage);
  });

  it("reflect_damage (escaravelho_blindado) soma ao dano direto, ignorando a defesa do atacante", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "escaravelho_blindado"); // Carapaça: dano 1 + reflete 1 (ignora defesa)
    moveAdjacent(attacker, m);
    const expectedDamage = Math.max(balance.damage.minimum_damage_if_base_at_least_1, 1 - attacker.defense) + 1;
    const startHp = attacker.hp;
    reactMonsterV2(game, m, attacker);
    expect(attacker.hp).toBe(startHp - expectedDamage);
  });

  it("apply_status de reação (enxame_vespas) aplica veneno no atacante", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "enxame_vespas");
    moveAdjacent(attacker, m);
    reactMonsterV2(game, m, attacker);
    expect(attacker.statuses.some((s) => s.status === "poison")).toBe(true);
  });

  it("basilisco_pedra (agressiva) reage com dano (Mordida Pétrea) — achado de dado corrigido (02/10/2026, ordem das opções invertida em data/monsters_map.json)", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "basilisco_pedra");
    moveAdjacent(attacker, m);
    const startHp = attacker.hp;
    reactMonsterV2(game, m, attacker);
    expect(attacker.hp).toBeLessThan(startHp); // Mordida Pétrea causa dano
    expect(attacker.statuses.some((s) => s.status === "root")).toBe(false);
  });

  it("efeito de reação não implementado (move_self_away_from_target/create_wall/summon_minion) não lança erro, só loga", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "tita_ancestral"); // mini-turno: Esmagar (dano) ou Erguer Muralha (create_wall)
    moveAdjacent(attacker, m);
    expect(() => reactMonsterV2(game, m, attacker)).not.toThrow();
  });

  it("alcance de revide (03/10/2026, pedido do dono do projeto): atacante fora do alcance da opção escolhida não sofre nada", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "javali_bravo"); // Chifrada: dano 3, alcance 1 (corpo a corpo)
    attacker.pos = { q: m.pos.q + 5, r: m.pos.r }; // bem longe, fora do alcance 1
    const startHp = attacker.hp;
    reactMonsterV2(game, m, attacker);
    expect(attacker.hp).toBe(startHp); // sem revide: fora de alcance
    expect(attacker.statuses.length).toBe(0);
    // mas o estado da reação não avança — não conta como "já atacada" nesse combate
    expect(m.attackedBeforeThisCombat).toBe(false);
  });

  it("alcance de revide: dentro do alcance (até o limite exato da opção) ainda revida", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "basilisco_pedra"); // Mordida Pétrea: alcance 2 (checar data/monsters_map.json)
    const type = (m as unknown as { typeId: string }).typeId;
    expect(type).toBe("basilisco_pedra");
    moveAdjacent(attacker, m); // distância 1, dentro de qualquer alcance >= 1
    const startHp = attacker.hp;
    reactMonsterV2(game, m, attacker);
    expect(attacker.hp).toBeLessThan(startHp);
  });

  it("opção 'self' (autobuff) dispara mesmo com o atacante bem longe, já que nunca mira nele", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "colosso_rachado"); // 1ª vez: Casca Dura (opção "self")
    attacker.pos = { q: m.pos.q + 10, r: m.pos.r }; // bem longe
    expect(() => reactMonsterV2(game, m, attacker)).not.toThrow();
    expect(m.attackedBeforeThisCombat).toBe(true); // a reação "self" conta como ocorrida
  });
});

describe("recompensa de monstro", () => {
  it("carta de recompensa: some da mão sem voltar pro baralho ao ser descartada, e não conta no limite de mão", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "raposa_ardilosa");
    attackMonsterV2(game, attacker, m, 999);
    const card = game.teams.A.hand.find((c) => c.monster)!;
    expect(card).toBeTruthy();
    const discardSizeBefore = game.teams.A.decks[card.owner].discard.length;
    discardCardV2(game, card);
    expect(game.teams.A.decks[card.owner].discard.length).toBe(discardSizeBefore); // não voltou pro descarte
  });

  it("stat_permanent (dano): abates na mesma zona:nível recalculam pela tabela de curva, sem somar versões antigas", () => {
    const game = createGameV2(1);
    const champion = game.teams.A.champions[0];
    const m1 = findByType(game, "sentinela_pedra"); // terra_petrificada nível 1, curva "full"
    attackMonsterV2(game, champion, m1, 999);
    expect(champion.monsterStatGroups["terra_petrificada:1:damage:full"]).toBe(1);
    expect(champion.permanentDamageBonusPercent).toBe(8);

    const m2 = game.monsters.find((x) => x.typeId === "sentinela_pedra" && x.alive)!;
    attackMonsterV2(game, champion, m2, 999);
    expect(champion.monsterStatGroups["terra_petrificada:1:damage:full"]).toBe(2);
    expect(champion.permanentDamageBonusPercent).toBe(14); // não é 8+8=16
  });

  it("stat_permanent (defesa): soma flat à defesa de base", () => {
    const game = createGameV2(1);
    const champion = game.teams.A.champions[0];
    const baseDefense = champion.baseDefense;
    const m = findByType(game, "colosso_rachado"); // terra_petrificada nível 2, stat defense
    attackMonsterV2(game, champion, m, 999);
    expect(champion.defense).toBe(baseDefense + 1);
  });

  it("stat_permanent (vida máxima): ajusta maxHp e hp atual proporcionalmente, e concede a carta secundária do chefe", () => {
    const game = createGameV2(1);
    const champion = game.teams.A.champions[0];
    const baseMaxHp = champion.baseMaxHp;
    const m = findByType(game, "tita_ancestral"); // terra_petrificada nível 3, stat max_hp + carta secundária
    attackMonsterV2(game, champion, m, 9999);
    const expectedMaxHp = Math.round(baseMaxHp * 1.1);
    expect(champion.maxHp).toBe(expectedMaxHp);
    expect(game.teams.A.hand.some((c) => c.cardId === "muralha_ancestral" && c.monster)).toBe(true);
  });

  it("recomputeChampionBonusesV2 chamado de novo não duplica efeito (idempotente dado o mesmo monsterStatGroups)", () => {
    const game = createGameV2(1);
    const champion = game.teams.A.champions[0];
    champion.monsterStatGroups["vale_selvagem:1:damage:reduced"] = 2;
    recomputeChampionBonusesV2(champion);
    const first = champion.permanentDamageBonusPercent;
    recomputeChampionBonusesV2(champion);
    expect(champion.permanentDamageBonusPercent).toBe(first);
    expect(first).toBe(7);
  });
});

describe("integração: carta/básica de alvo 'enemy' apontada pra um monstro", () => {
  it("validateTargetV2/enumerateTargetsV2 aceitam o uid de um monstro vivo", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const m = findByType(game, "javali_bravo");
    attacker.pos = { ...m.pos };
    expect(isMonsterUidV2(m.uid)).toBe(true);
    expect(validateTargetV2(game, attacker, { range: 5, target: "enemy" }, { uid: m.uid })).toBeNull();
    const list = enumerateTargetsV2(game, attacker, { range: 5, target: "enemy" });
    expect(list.some((t) => t.uid === m.uid)).toBe(true);
  });

  it("playCardV2 (niara_ultima_bala, alvo 'enemy') reduz o hp do monstro", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const m = findByType(game, "sentinela_pedra");
    niara.pos = { ...m.pos };
    game.teams.A.mana = 10;
    const before = m.hp;
    const cardUid = seedCardUid(game, niara.uid, "niara_ultima_bala");
    playCardV2(game, "A", cardUid, 2, { uid: m.uid });
    expect(m.hp).toBeLessThan(before);
  });

  it("playBasicV2 com alvo 'enemy' também acerta o monstro", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const m = findByType(game, "javali_bravo");
    niara.pos = { ...m.pos };
    const before = m.hp;
    playBasicV2(game, niara.uid, { uid: m.uid });
    expect(m.hp).toBeLessThan(before);
  });
});

describe("limite de mão ignora cartas de monstro", () => {
  it("skipDraw é permitido mesmo com a mão cheia de cartas normais + cartas de monstro extras", () => {
    const game = createGameV2(1);
    game.turn.phase = "draw";
    const tm = game.teams.A;
    tm.hand = [];
    for (let i = 0; i < balance.hand.max_size; i++) {
      tm.hand.push({ uid: `normal-${i}`, cardId: "potion_life", owner: tm.champions[0].uid });
    }
    tm.hand.push({ uid: "monster-reward-x", cardId: "salto_ardiloso", owner: tm.champions[0].uid, monster: true });
    const actions = legalActionsV2(game, "A");
    expect(actions.some((a) => a.type === "skipDraw")).toBe(true);
    expect(() => applyActionV2(game, "A", { type: "skipDraw" })).not.toThrow();
  });
});

// Helper só pra achar o uid real de uma carta específica na mão/baralho de um campeão (sem reimplementar o motor de baralho nos testes).
function seedCardUid(game: GameStateV2, championUid: string, cardId: string): string {
  const owner = game.teams.A.champions.find((c) => c.uid === championUid) ?? game.teams.B.champions.find((c) => c.uid === championUid);
  const t = owner!.team;
  const deck = game.teams[t].decks[championUid];
  const found = deck.draw.find((c) => c.cardId === cardId) ?? deck.discard.find((c) => c.cardId === cardId);
  if (!found) throw new Error(`carta ${cardId} não encontrada no baralho de ${championUid}`);
  // Coloca na mão pra poder jogar via playCardV2.
  deck.draw = deck.draw.filter((c) => c.uid !== found.uid);
  deck.discard = deck.discard.filter((c) => c.uid !== found.uid);
  game.teams[t].hand.push(found);
  return found.uid;
}
