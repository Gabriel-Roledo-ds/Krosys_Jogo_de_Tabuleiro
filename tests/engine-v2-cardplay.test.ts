// Testes da camada de "jogar uma carta" do motor hexagonal (roster v2) —
// src/engine-v2/cardPlay.ts. Cobre cartas reais de cards_v2.json (não só
// blocos de efeito isolados como nos testes de effects.ts), validando que
// target+alcance do rank, mana de equipe, ricochete encadeado, random_targets
// e o consumo de buff_next_card funcionam juntos de ponta a ponta.

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { playCardV2, playBasicV2, IllegalActionV2 } from "../src/engine-v2/cardPlay";
import { basicTargetV2, getChampionDefV2 } from "../src/engine-v2/data";
import { wallAtV2 } from "../src/engine-v2/world";
import type { CardInstanceV2 } from "../src/engine-v2/state";

function putCardInHand(game: ReturnType<typeof createGameV2>, team: "A" | "B", ownerUid: string, cardId: string): CardInstanceV2 {
  const card: CardInstanceV2 = { uid: `test#${cardId}#${ownerUid}`, cardId, owner: ownerUid };
  game.teams[team].hand.push(card);
  return card;
}

describe("playCardV2 — Bênção (cura, alvo ally)", () => {
  it("cura o aliado, gasta mana e descarta a carta", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    niara.hp = niara.maxHp - 10;
    game.teams.A.mana = 5;
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");

    const before = niara.hp;
    playCardV2(game, "A", card.uid, 1, { uid: niara.uid });

    expect(niara.hp).toBe(before + 4);
    expect(game.teams.A.mana).toBe(4); // rank 1 custa 1
    expect(game.teams.A.hand.find((c) => c.uid === card.uid)).toBeUndefined();
    expect(game.teams.A.decks[selene.uid].discard.some((c) => c.cardId === "selene_bencao")).toBe(true);
  });

  it("recusa alvo fora de alcance", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { q: selene.pos.q + 20, r: selene.pos.r };
    game.teams.A.mana = 5;
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");
    expect(() => playCardV2(game, "A", card.uid, 1, { uid: niara.uid })).toThrow(IllegalActionV2);
    expect(() => playCardV2(game, "A", card.uid, 1, { uid: niara.uid })).toThrow(/alcance/);
  });

  it("recusa mana insuficiente", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    game.teams.A.mana = 0;
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");
    expect(() => playCardV2(game, "A", card.uid, 1, { uid: niara.uid })).toThrow(/[Mm]ana/);
  });
});

describe("playCardV2 — Ricochete (champion_in_line, encadeia 3 alvos)", () => {
  it("rank 3 acerta os 3 inimigos em linha, sem repetir nenhum", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const aurelia = game.teams.B.champions.find((c) => c.defId === "aurelia")!;
    borak.pos = { q: niara.pos.q + 4, r: niara.pos.r };
    dorin.pos = { q: borak.pos.q + 1, r: borak.pos.r };
    aurelia.pos = { q: dorin.pos.q + 1, r: dorin.pos.r };
    for (const c of [borak, dorin, aurelia]) c.defense = 0;
    game.teams.A.mana = 10;
    const card = putCardInHand(game, "A", niara.uid, "niara_ricochete");

    playCardV2(game, "A", card.uid, 3, { uid: borak.uid });

    expect(borak.hp).toBe(borak.maxHp - 5);
    expect(dorin.hp).toBe(dorin.maxHp - 5);
    expect(aurelia.hp).toBe(aurelia.maxHp - 5);
    expect(game.teams.A.mana).toBe(6); // 10 - 4 (custo do rank 3)
  });
});

describe("playCardV2 — Chuva de Balas (random_enemies)", () => {
  it("acerta `random_targets` inimigos distintos dentro do alcance", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const enemies = game.teams.B.champions;
    enemies.forEach((c, i) => {
      c.pos = { q: niara.pos.q + i + 1, r: niara.pos.r };
      c.defense = 0;
    });
    // Boss e monstros do mapa também entram no sorteio agora (ver
    // randomDamageCandidatesV2 em cardPlay.ts) — afastados daqui pra fora do
    // alcance (6) pra manter este teste focado só nos 3 campeões inimigos.
    game.boss.pos = { q: niara.pos.q - 20, r: niara.pos.r };
    for (const m of game.monsters) m.pos = { q: niara.pos.q - 20, r: niara.pos.r };
    game.teams.A.mana = 10;
    const card = putCardInHand(game, "A", niara.uid, "niara_chuva_balas");

    playCardV2(game, "A", card.uid, 2, {});

    for (const c of enemies) expect(c.hp).toBe(c.maxHp - 3);
  });

  it("boss e monstro dentro do alcance também entram no sorteio (achado de escopo, 02/10/2026)", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    // Só o boss ao alcance (1 campeão inimigo bem longe, fora do alcance 6) —
    // com random_targets 3 e só 1 candidato possível (o boss), o boss tem que
    // ser o alvo.
    niara.pos = { ...game.boss.pos, q: game.boss.pos.q - 1 };
    for (const c of game.teams.B.champions) c.pos = { q: niara.pos.q - 20, r: niara.pos.r };
    for (const m of game.monsters) m.pos = { q: niara.pos.q - 20, r: niara.pos.r };
    game.teams.A.mana = 10;
    const card = putCardInHand(game, "A", niara.uid, "niara_chuva_balas");
    const hpBefore = game.boss.hp;

    playCardV2(game, "A", card.uid, 2, {});

    expect(game.boss.hp).toBeLessThan(hpBefore);
  });
});

describe("playCardV2 — buff_next_card (Passo das Sombras) consumido pela próxima carta", () => {
  it("soma o bônus na próxima carta de dano e depois limpa o buff", () => {
    const game = createGameV2(1, { comp: { A: ["vextra", "selene", "niara"], B: ["borak", "dorin", "aurelia"] } });
    const vextra = game.teams.A.champions.find((c) => c.defId === "vextra")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.defense = 0;
    game.teams.A.mana = 20;

    const dest = { q: vextra.pos.q + 2, r: vextra.pos.r };
    const passo = putCardInHand(game, "A", vextra.uid, "vextra_passo_sombras");
    playCardV2(game, "A", passo.uid, 3, { pos: dest });
    expect(vextra.pos).toEqual(dest);
    expect(game.teams.A.nextCardBuff).toEqual({ bonusDamage: 3 });

    borak.pos = { q: vextra.pos.q + 1, r: vextra.pos.r };
    const before = borak.hp;
    const lamina = putCardInHand(game, "A", vextra.uid, "vextra_lamina_rapida");
    playCardV2(game, "A", lamina.uid, 1, { uid: borak.uid });

    expect(borak.hp).toBe(before - 7); // 4 (rank 1) + 3 (buff) - 0 defesa
    expect(game.teams.A.nextCardBuff).toBeNull(); // consumido, não propaga pra uma 3ª carta
  });
});

describe("basicTargetV2 — alvo inferido das 10 básicas (regras-e-decisoes.md §6)", () => {
  it("dano sem cura -> enemy; cura sem dano -> ally; cria parede -> cell; target explícito vence", () => {
    expect(basicTargetV2(getChampionDefV2("niara").basic)).toBe("enemy");
    expect(basicTargetV2(getChampionDefV2("varek").basic)).toBe("enemy"); // dano + push, sem cura
    expect(basicTargetV2(getChampionDefV2("sylvane").basic)).toBe("enemy"); // controle sem alvo explícito
    expect(basicTargetV2(getChampionDefV2("selene").basic)).toBe("ally"); // heal, sem dano
    expect(basicTargetV2(getChampionDefV2("dorin").basic)).toBe("cell"); // create_wall
    expect(basicTargetV2(getChampionDefV2("aurelia").basic)).toBe("ally"); // target explícito no efeito
  });
});

describe("playBasicV2", () => {
  it("básica de dano (Niara) acerta o inimigo ao alcance", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.pos = { q: niara.pos.q + 2, r: niara.pos.r };
    borak.defense = 0;
    const before = borak.hp;
    playBasicV2(game, niara.uid, { uid: borak.uid });
    expect(borak.hp).toBe(before - 2);
  });

  it("básica de cura (Selene) só aceita aliado", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    borak.pos = { ...selene.pos, q: selene.pos.q + 1 };
    niara.hp = niara.maxHp - 5;
    playBasicV2(game, selene.uid, { uid: niara.uid });
    expect(niara.hp).toBe(niara.maxHp - 2);
    expect(() => playBasicV2(game, selene.uid, { uid: borak.uid })).toThrow(/aliado/);
  });

  it("básica de parede (Dorin) cria parede na casa escolhida, sem custar mana (básica é custo 0)", () => {
    const game = createGameV2(1);
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const pos = { q: dorin.pos.q + 1, r: dorin.pos.r };
    const manaBefore = game.teams.B.mana;
    playBasicV2(game, dorin.uid, { pos });
    expect(wallAtV2(game, pos)?.hp).toBe(2);
    expect(game.teams.B.mana).toBe(manaBefore);
  });

  it("recusa alvo fora de alcance", () => {
    const game = createGameV2(1);
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.pos = { q: niara.pos.q + 20, r: niara.pos.r };
    expect(() => playBasicV2(game, niara.uid, { uid: borak.uid })).toThrow(IllegalActionV2);
  });
});
