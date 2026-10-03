// Mana pessoal paga cartas (item 35 do KANBAN) — motor hexagonal (roster v2).
// Até aqui, `personalMana` (ChampionStateV2) só era ganho/perdido por
// grant_personal_mana/drain_personal_mana (poções, buffs), mas nunca servia
// pra pagar o custo de uma carta — só a mana de equipe contava. Ver
// src/engine-v2/mana.ts (canPayCardV2/spendCardManaV2): toda carta v2 tem um
// dono fixo (CardInstanceV2.owner), então seu custo pode ser coberto também
// pela mana pessoal do dono, nunca a de outro campeão — a mana pessoal é
// gasta SEMPRE primeiro (até cobrir o custo), e a de equipe cobre o resto
// [PADRÃO, 02/10/2026, ver regras-e-decisoes.md §6/§19].

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { canPayCardV2, spendCardManaV2 } from "../src/engine-v2/mana";
import { playCardV2 } from "../src/engine-v2/cardPlay";
import { fastPlaysV2, legalActionsV2 } from "../src/engine-v2/turn";
import type { CardInstanceV2 } from "../src/engine-v2/state";

function putCardInHand(game: ReturnType<typeof createGameV2>, team: "A" | "B", ownerUid: string, cardId: string): CardInstanceV2 {
  const card: CardInstanceV2 = { uid: `test#${cardId}#${ownerUid}`, cardId, owner: ownerUid };
  game.teams[team].hand.push(card);
  return card;
}

describe("canPayCardV2 / spendCardManaV2 — mana pessoal + mana de equipe", () => {
  it("mana pessoal sozinha já cobre o custo mesmo com mana de equipe zerada", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    game.teams.A.mana = 0;
    selene.personalMana = 5;
    expect(canPayCardV2(game, "A", selene, 3)).toBe(true);
    spendCardManaV2(game, "A", selene, 3);
    expect(selene.personalMana).toBe(2);
    expect(game.teams.A.mana).toBe(0);
  });

  it("mana pessoal é gasta primeiro; equipe cobre só o restante", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    game.teams.A.mana = 10;
    selene.personalMana = 2;
    spendCardManaV2(game, "A", selene, 5);
    expect(selene.personalMana).toBe(0);
    expect(game.teams.A.mana).toBe(7); // 10 - (5 - 2)
  });

  it("mana pessoal de outro campeão não cobre a carta de quem joga", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    game.teams.A.mana = 0;
    niara.personalMana = 10;
    expect(canPayCardV2(game, "A", selene, 3)).toBe(false);
  });

  it("nenhuma das duas fontes basta -> lança erro e nada é gasto", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    game.teams.A.mana = 1;
    selene.personalMana = 1;
    expect(() => spendCardManaV2(game, "A", selene, 5)).toThrow(/[Mm]ana/);
    expect(selene.personalMana).toBe(1);
    expect(game.teams.A.mana).toBe(1);
  });
});

describe("playCardV2 — mana pessoal paga carta de verdade", () => {
  it("joga carta usando só mana pessoal, mana de equipe intocada", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    niara.hp = niara.maxHp - 10;
    game.teams.A.mana = 0;
    selene.personalMana = 5;
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");

    playCardV2(game, "A", card.uid, 1, { uid: niara.uid });

    expect(niara.hp).toBe(niara.maxHp - 6); // curou os 4 do rank 1
    expect(selene.personalMana).toBe(4); // gastou 1 (custo do rank 1) da mana pessoal
    expect(game.teams.A.mana).toBe(0);
  });

  it("mana pessoal de outro campeão da equipe não ajuda a pagar essa carta", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    game.teams.A.mana = 0;
    niara.personalMana = 10; // não é da selene, não deveria contar
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");

    expect(() => playCardV2(game, "A", card.uid, 1, { uid: niara.uid })).toThrow(/[Mm]ana/);
  });
});

describe("fastPlaysV2/legalActionsV2 — carta só pagável via mana pessoal aparece como jogável", () => {
  it("fastPlaysV2 lista uma carta rápida pagável só com mana pessoal do dono", () => {
    const game = createGameV2(1);
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    game.teams.A.mana = 0;
    selene.personalMana = 10;
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");

    const plays = fastPlaysV2(game, "A");
    expect(plays.some((p) => p.card.uid === card.uid)).toBe(true);
  });

  it("legalActionsV2 inclui jogar a carta quando só a mana pessoal do dono cobre o custo", () => {
    const game = createGameV2(1);
    game.turn.team = "A";
    game.turn.phase = "act";
    const selene = game.teams.A.champions.find((c) => c.defId === "selene")!;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    niara.pos = { ...selene.pos, q: selene.pos.q + 1 };
    game.teams.A.mana = 0;
    selene.personalMana = 10;
    const card = putCardInHand(game, "A", selene.uid, "selene_bencao");

    const actions = legalActionsV2(game, "A");
    expect(actions.some((a) => a.type === "play" && a.card === card.uid)).toBe(true);
  });
});
