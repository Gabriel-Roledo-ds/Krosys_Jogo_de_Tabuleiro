// Testes do boss no motor hexagonal (roster v2, item 6 da ordem de execução).
// Ver KANBAN.md e src/engine-v2/boss.ts.

import { describe, it, expect } from "vitest";
import { balance } from "../src/engine/data";
import { createGameV2 } from "../src/engine-v2/state";
import { attackBossV2, bossShouldActivateV2, championsInBossRangeV2, BOSS_UID_V2 } from "../src/engine-v2/boss";
import { activateBossV2, applyActionV2, startGameV2 } from "../src/engine-v2/turn";
import { killChampionV2, resolveBossDeathV2, resolveDeathsV2, returnDeadChampionsV2 } from "../src/engine-v2/death";
import { resurrectBlockedV2, playCardV2, playBasicV2 } from "../src/engine-v2/cardPlay";
import { validateTargetV2, enumerateTargetsV2 } from "../src/engine-v2/targeting";
import { isFreeCellV2 } from "../src/engine-v2/world";

describe("championsInBossRangeV2 / bossShouldActivateV2", () => {
  it("só conta campeão vivo, atingível e dentro do alcance do boss", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    c.pos = { ...game.boss.pos };
    expect(championsInBossRangeV2(game, "A")).toContain(c);
    expect(bossShouldActivateV2(game, "A")).toBe(true);
    expect(bossShouldActivateV2(game, "B")).toBe(false);

    c.untargetable = true;
    expect(bossShouldActivateV2(game, "A")).toBe(false);
  });
});

describe("activateBossV2", () => {
  it("não ativa sem campeão da equipe ao alcance", () => {
    const game = createGameV2(1);
    expect(activateBossV2(game, "A")).toBeNull();
    expect(game.boss.deck.length).toBe(11); // nada foi comprado
  });

  it("alvo closest: dano no campeão mais próximo do boss dentro do alcance, não no mais distante", () => {
    for (let seed = 1; seed < 50; seed++) {
      const g = createGameV2(seed);
      const [a, b] = g.teams.A.champions;
      a.pos = { q: g.boss.pos.q - 2, r: g.boss.pos.r };
      b.pos = { q: g.boss.pos.q - 1, r: g.boss.pos.r }; // mais perto do boss
      const card = activateBossV2(g, "A");
      if (card?.target === "closest" && card.effects.some((e) => e.type === "damage")) {
        expect(b.hp).toBeLessThan(b.maxHp);
        expect(a.hp).toBe(a.maxHp);
        return;
      }
    }
    throw new Error("nenhuma seed de 1 a 49 sacou uma carta 'closest' com dano — ajustar o teste");
  });

  it("alvo area: todos dentro do raio da carta tomam o efeito, fogo amigo incluso", () => {
    for (let seed = 1; seed < 50; seed++) {
      const g = createGameV2(seed);
      for (const c of [...g.teams.A.champions, ...g.teams.B.champions]) c.pos = { ...g.boss.pos };
      const card = activateBossV2(g, "A");
      if (card?.target === "area") {
        for (const c of [...g.teams.A.champions, ...g.teams.B.champions]) {
          if (card.effects.some((e) => e.type === "damage")) expect(c.hp).toBeLessThan(c.maxHp);
        }
        return;
      }
    }
    throw new Error("nenhuma seed de 1 a 49 sacou uma carta 'area' — ajustar o teste");
  });

  it("alvo aura: só ativa a aura, não ataca, e substitui a anterior", () => {
    for (let seed = 1; seed < 50; seed++) {
      const g = createGameV2(seed);
      const c = g.teams.A.champions[0];
      c.pos = { ...g.boss.pos };
      const hpBefore = c.hp;
      const card = activateBossV2(g, "A");
      if (card?.target === "aura") {
        expect(g.boss.aura?.cardId).toBe(card.id);
        expect(c.hp).toBe(hpBefore); // aura não ataca na hora de sacar
        return;
      }
    }
    throw new Error("nenhuma seed de 1 a 49 sacou uma carta 'aura' — ajustar o teste");
  });

  it("baralho esgotado: embaralha o descarte de volta", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    c.pos = { ...game.boss.pos };
    // "Prole" (summon_minion) não está implementada no motor v2 ainda (sem
    // lacaios) — ignora esse erro específico pra só testar o reembaralhar.
    for (let i = 0; i < 11; i++) {
      try {
        activateBossV2(game, "A");
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes("summon_minion")) throw err;
      }
    }
    expect(game.boss.deck.length + game.boss.discard.length).toBe(11);
  });
});

describe("ativação do boss pela pilha de respostas rápidas (02/10/2026)", () => {
  it("equipe alvo com carta rápida na mão NÃO sofre o dano na hora: fica esperando resposta", () => {
    const game = createGameV2(1);
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    varek.pos = { ...game.boss.pos }; // dentro do alcance (closest óbvio: só ele)
    game.boss.deck = ["garra", ...game.boss.deck.filter((id) => id !== "garra")]; // força "Garra" (dano 3) no topo
    game.teams.A.mana = 10;
    const card = { uid: "resp1", cardId: "varek_escudo_reforcado", owner: varek.uid };
    game.teams.A.hand.push(card);
    const hpBefore = varek.hp;

    const usedCard = activateBossV2(game, "A");
    expect(usedCard?.id).toBe("garra");
    // Varek é o alvo e tem carta rápida de escudo pagável: a pilha fica esperando a resposta dele, não resolve ainda.
    expect(game.pending).not.toBeNull();
    expect(game.pending?.priority).toBe("A");
    expect(varek.hp).toBe(hpBefore); // dano do boss ainda não aconteceu

    applyActionV2(game, "A", { type: "play", card: card.uid, rank: 1, target: { uid: varek.uid } });
    // Escudo (rank 1, 5) resolve primeiro (LIFO, igual a qualquer resposta rápida), ANTES do
    // dano do boss. dealBossDamageV2 ainda não desconta escudo (gap pré-existente, fora do
    // escopo desta etapa — só a ORDEM de resolução é o que esta etapa resolve), então o
    // escudo fica intacto e o dano (3 - defesa 3, mínimo 1) cai direto na vida.
    expect(game.pending).toBeNull();
    expect(varek.shield).toBe(5);
    expect(varek.hp).toBe(hpBefore - 1);
  });

  it("sem ninguém pra responder, resolve na hora (comportamento de antes continua valendo)", () => {
    const game = createGameV2(1);
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    varek.pos = { ...game.boss.pos };
    game.boss.deck = ["garra", ...game.boss.deck.filter((id) => id !== "garra")];
    const hpBefore = varek.hp;

    activateBossV2(game, "A"); // sem carta rápida na mão: ninguém responde
    expect(game.pending).toBeNull();
    expect(varek.hp).toBeLessThan(hpBefore); // dano já aconteceu
  });

  it("equipe adversária (que nem está no alcance) também pode responder antes do dano resolver — a ativação não tem 'dono'", () => {
    const game = createGameV2(1);
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    varek.pos = { ...game.boss.pos };
    game.boss.deck = ["garra", ...game.boss.deck.filter((id) => id !== "garra")];
    // Time A (equipe da vez, alvo da carta) sem carta rápida pagável na mão.
    // Time B tem uma carta rápida de utilidade (mana pessoal pra Aurelia), sem nenhuma
    // relação com o boss — só prova que QUALQUER equipe ganha a chance, não só o alvo.
    game.teams.B.mana = 10;
    const aurelia = game.teams.B.champions.find((c) => c.defId === "aurelia")!;
    const card = { uid: "resp2", cardId: "aurelia_inspiracao", owner: aurelia.uid };
    game.teams.B.hand.push(card);

    activateBossV2(game, "A");
    expect(game.pending).not.toBeNull();
    expect(game.pending?.priority).toBe("B");

    const target = enumerateTargetsV2(game, aurelia, { range: 3, target: "ally" })[0];
    applyActionV2(game, "B", { type: "play", card: card.uid, rank: 1, target });
    expect(game.pending).toBeNull(); // B respondeu, A não tem o que responder: resolve tudo
  });

  it("fase 'boss' no turno de verdade (startGameV2/beginTurn): fica esperando resposta e só entra na fase de compra depois de resolver", () => {
    const game = createGameV2(1);
    const varek = game.teams.A.champions.find((c) => c.defId === "varek")!;
    varek.pos = { ...game.boss.pos };
    game.boss.deck = ["garra", ...game.boss.deck.filter((id) => id !== "garra")];
    game.teams.A.mana = 10;
    const card = { uid: "resp3", cardId: "varek_escudo_reforcado", owner: varek.uid };
    game.teams.A.hand.push(card);

    startGameV2(game); // beginTurn da equipe A: returnDeadChampionsV2 + ativação do boss
    expect(game.turn.phase).toBe("boss");
    expect(game.pending?.priority).toBe("A");

    applyActionV2(game, "A", { type: "play", card: card.uid, rank: 1, target: { uid: varek.uid } });
    expect(game.pending).toBeNull();
    expect(game.turn.phase).toBe("draw"); // resolveu e seguiu pro turno normal
  });
});

describe("attackBossV2", () => {
  it("causa dano líquido (defesa fixa, mínimo 1) e marca lastAttacker", () => {
    const game = createGameV2(1);
    const attacker = game.teams.A.champions[0];
    const hpBefore = game.boss.hp;
    const dealt = attackBossV2(game, attacker, 3);
    expect(dealt).toBeGreaterThan(0);
    expect(game.boss.hp).toBe(hpBefore - dealt);
    expect(game.boss.lastAttacker).toBe(attacker.uid);
  });

  it("recompensa (bounty): depois do primeiro golpe de uma equipe, os próximos golpes dela causam x2", () => {
    const game = createGameV2(1);
    const a = game.teams.A.champions[0];
    const base = 10;
    const champMult = balance.damage.champion_damage_multiplier ?? 1;
    const bountyMult = balance.boss.bounty_multiplier ?? 1;
    const round = (x: number): number => Math.floor(x + 0.5 + 1e-9);
    const minDmg = balance.damage.minimum_damage_if_base_at_least_1;

    const dealt1 = attackBossV2(game, a, base); // primeiro golpe: ainda sem bounty
    expect(game.bountyTeam).toBe("A");
    expect(dealt1).toBe(Math.max(minDmg, round(base * champMult) - game.boss.defense));

    const hpBefore = game.boss.hp;
    const dealt2 = attackBossV2(game, a, base); // agora com bounty (x2 em cima do multiplicador normal)
    expect(dealt2).toBe(Math.max(minDmg, round(base * champMult * bountyMult) - game.boss.defense));
    expect(game.boss.hp).toBe(hpBefore - dealt2);
  });

  it("Carapaça (damageReduction) reduz o dano recebido", () => {
    const game = createGameV2(1);
    game.boss.damageReduction = 2;
    const a = game.teams.A.champions[0];
    const dealt = attackBossV2(game, a, 5);
    expect(dealt).toBe(5 - game.boss.defense - 2);
  });

  it("boss morto não sofre mais dano", () => {
    const game = createGameV2(1);
    game.boss.alive = false;
    expect(attackBossV2(game, game.teams.A.champions[0], 10)).toBe(0);
  });
});

describe("integração: carta/básica de alvo 'enemy' apontada pro boss", () => {
  it("validateTargetV2/enumerateTargetsV2 aceitam o boss como alvo 'enemy' ao alcance", () => {
    const game = createGameV2(1);
    const owner = game.teams.A.champions[0];
    owner.pos = { q: game.boss.pos.q - 1, r: game.boss.pos.r };
    const def = { range: 3, target: "enemy" };
    expect(validateTargetV2(game, owner, def, { uid: BOSS_UID_V2 })).toBeNull();
    const targets = enumerateTargetsV2(game, owner, def);
    expect(targets.some((t) => t.uid === BOSS_UID_V2)).toBe(true);
  });

  it("playCardV2 com carta de dano único (target enemy) no boss reduz a vida dele", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { q: game.boss.pos.q - 1, r: game.boss.pos.r };
    game.teams.A.mana = 10;
    const card = { uid: "c1", cardId: "niara_ultima_bala", owner: niara.uid };
    game.teams.A.hand.push(card);
    const hpBefore = game.boss.hp;
    playCardV2(game, "A", card.uid, 2, { uid: BOSS_UID_V2 });
    expect(game.boss.hp).toBeLessThan(hpBefore);
  });

  it("habilidade básica de alvo enemy também pode acertar o boss", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { q: game.boss.pos.q - 1, r: game.boss.pos.r };
    const hpBefore = game.boss.hp;
    playBasicV2(game, niara.uid, { uid: BOSS_UID_V2 });
    expect(game.boss.hp).toBeLessThan(hpBefore);
  });
});

describe("boss ocupa a própria casa (bloqueia movimento/alvo 'cell')", () => {
  it("isFreeCellV2 é falso na casa do boss enquanto ele estiver vivo", () => {
    const game = createGameV2(1);
    expect(isFreeCellV2(game, game.boss.pos)).toBe(false);
    game.boss.alive = false;
    expect(isFreeCellV2(game, game.boss.pos)).toBe(true);
  });
});

describe("morte definitiva depois que o boss cai (regras-e-decisoes.md §18)", () => {
  it("resolveBossDeathV2 marca o boss como morto quando hp chega a 0", () => {
    const game = createGameV2(1);
    game.boss.hp = 0;
    game.bountyTeam = "A";
    resolveBossDeathV2(game);
    expect(game.boss.alive).toBe(false);
    expect(game.bountyTeam).toBeNull();
  });

  it("com o boss vivo, a morte é temporária (outTurns, volta depois)", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    killChampionV2(game, c);
    expect(c.permaDead).toBe(false);
    expect(c.outTurns).toBeGreaterThan(0);
  });

  it("com o boss morto, a morte é definitiva: outTurns 0, permaDead, nunca volta", () => {
    const game = createGameV2(1);
    game.boss.alive = false;
    const c = game.teams.A.champions[0];
    killChampionV2(game, c);
    expect(c.permaDead).toBe(true);
    expect(c.outTurns).toBe(0);
    returnDeadChampionsV2(game, "A");
    expect(c.alive).toBe(false); // não volta mais
  });

  it("resolveDeathsV2 resolve a queda do boss antes de matar os campeões (dano simultâneo)", () => {
    const game = createGameV2(1);
    game.boss.hp = 0;
    const c = game.teams.A.champions[0];
    c.hp = 0;
    resolveDeathsV2(game, "A");
    expect(game.boss.alive).toBe(false);
    expect(c.alive).toBe(false);
    expect(c.permaDead).toBe(true); // morreu na mesma resolução em que o boss caiu
  });

  it("Ressurgir (resurrect) para de funcionar depois que o boss morre", () => {
    const game = createGameV2(1);
    game.boss.alive = false;
    expect(resurrectBlockedV2(game, "A", [{ type: "resurrect" }])).toBe(true);
  });
});
