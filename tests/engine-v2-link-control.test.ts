// Elo de controle da Sylvane (item 36 do KANBAN) — motor hexagonal (roster v2).
// Até aqui, `applyLink` (effects.ts) sempre ligava quem usou a carta a cada
// alvo recebido, e a propagação de CONTROLE (diferente da de cura, já
// implementada) nunca tinha sido escrita — só o vínculo era criado, sem
// nenhum efeito prático (achado documentado em KANBAN.md/regras-e-decisoes.md).
//
// Achado de ambiguidade resolvido: "Elo Natural" (Sylvane) liga DOIS
// INIMIGOS entre si ("compartilha entre inimigos" no texto original de
// fichas-campeoes.md), não a própria Sylvane a um inimigo — diferente de
// "Corrente de Vida" (Selene), que liga quem usou a carta a 1 aliado (target
// "ally", sem ambiguidade). Resolvido igual ao "Elo" do MVP original
// (src/engine/{targeting,effects}.ts): `sylvane_elo_natural` passou a ter
// `target: "two_enemies"` (targeting.ts/cardPlay.ts, novo), e `applyLink`
// liga os dois alvos resolvidos entre si quando o vínculo é de controle.

import { describe, it, expect } from "vitest";
import { createGameV2, nextIdV2 } from "../src/engine-v2/state";
import { applyLink, applyStatus, linkedPartnerOf, type EffectContextV2 } from "../src/engine-v2/effects";
import { playCardV2 } from "../src/engine-v2/cardPlay";
import { validateTargetV2 } from "../src/engine-v2/targeting";
import type { CardInstanceV2 } from "../src/engine-v2/state";

function ctxFor(game: ReturnType<typeof createGameV2>, attacker: ReturnType<typeof createGameV2>["teams"]["A"]["champions"][number] | null, extra: Partial<EffectContextV2> = {}): EffectContextV2 {
  return { game, attacker, nextId: () => nextIdV2(game), ...extra };
}

function putCardInHand(game: ReturnType<typeof createGameV2>, team: "A" | "B", ownerUid: string, cardId: string): CardInstanceV2 {
  const card: CardInstanceV2 = { uid: `test#${cardId}#${ownerUid}`, cardId, owner: ownerUid };
  game.teams[team].hand.push(card);
  return card;
}

describe("validateTargetV2 — \"two_enemies\" (Elo Natural)", () => {
  it("aceita dois inimigos distintos ao alcance", () => {
    const game = createGameV2(1);
    const sylvane = game.teams.A.champions[0];
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    borak.pos = { q: sylvane.pos.q + 1, r: sylvane.pos.r };
    dorin.pos = { q: sylvane.pos.q + 2, r: sylvane.pos.r };
    expect(validateTargetV2(game, sylvane, { range: 4, target: "two_enemies" }, { uid: borak.uid, uid2: dorin.uid })).toBeNull();
  });

  it("recusa os dois alvos iguais", () => {
    const game = createGameV2(1);
    const sylvane = game.teams.A.champions[0];
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.pos = { q: sylvane.pos.q + 1, r: sylvane.pos.r };
    expect(validateTargetV2(game, sylvane, { range: 4, target: "two_enemies" }, { uid: borak.uid, uid2: borak.uid })).toMatch(/diferentes/);
  });

  it("recusa aliado como um dos dois alvos", () => {
    const game = createGameV2(1);
    const sylvane = game.teams.A.champions[0];
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    niara.pos = { q: sylvane.pos.q + 1, r: sylvane.pos.r };
    borak.pos = { q: sylvane.pos.q + 2, r: sylvane.pos.r };
    expect(validateTargetV2(game, sylvane, { range: 4, target: "two_enemies" }, { uid: niara.uid, uid2: borak.uid })).toMatch(/inimigo/);
  });
});

describe("applyLink — link_control liga os DOIS alvos entre si, não quem usou a carta", () => {
  it("os dois inimigos ficam ligados um ao outro; quem lançou a carta (fora dos alvos) não entra no vínculo", () => {
    const game = createGameV2(1);
    const sylvane = game.teams.A.champions[0];
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const ctx = ctxFor(game, sylvane);

    applyLink(ctx, { type: "link", share_control_percent: 50, duration: { unit: "rounds", value: 2 } }, [borak, dorin]);

    expect(linkedPartnerOf(borak)).toBe(dorin.uid);
    expect(linkedPartnerOf(dorin)).toBe(borak.uid);
    expect(linkedPartnerOf(sylvane)).toBeNull();
  });
});

describe("propagação de controle pelo Elo Natural", () => {
  it("stun aplicado num lado do vínculo propaga pro outro, com duração reduzida pela porcentagem", () => {
    const game = createGameV2(1);
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const ctx = ctxFor(game, null);
    applyLink(ctx, { type: "link", share_control_percent: 50, duration: { unit: "rounds", value: 2 } }, [borak, dorin]);

    applyStatus(ctx, { type: "apply_status", status: "stun", duration: { unit: "rounds", value: 4 } }, [borak]);

    expect(borak.statuses.some((s) => s.status === "stun" && s.remaining === 4)).toBe(true);
    expect(dorin.statuses.some((s) => s.status === "stun" && s.remaining === 2)).toBe(true); // 50% de 4 = 2
  });

  it("75% arredonda e nunca propaga duração 0", () => {
    const game = createGameV2(1);
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const ctx = ctxFor(game, null);
    applyLink(ctx, { type: "link", share_control_percent: 75, duration: { unit: "rounds", value: 1 } }, [borak, dorin]);

    applyStatus(ctx, { type: "apply_status", status: "root", duration: { unit: "rounds", value: 1 } }, [borak]);

    expect(dorin.statuses.some((s) => s.status === "root" && s.remaining === 1)).toBe(true); // round(0.75) = 1, nunca 0
  });

  it("não propaga de volta pro parceiro (sem ida-e-volta infinita)", () => {
    const game = createGameV2(1);
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const ctx = ctxFor(game, null);
    applyLink(ctx, { type: "link", share_control_percent: 50, duration: { unit: "rounds", value: 2 } }, [borak, dorin]);

    applyStatus(ctx, { type: "apply_status", status: "stun", duration: { unit: "rounds", value: 4 } }, [borak]);

    expect(dorin.statuses.filter((s) => s.status === "stun")).toHaveLength(1);
    expect(borak.statuses.filter((s) => s.status === "stun")).toHaveLength(1); // só o original, não um de volta
  });

  it("status que não é de controle (ex. defense_down) não propaga pelo Elo", () => {
    const game = createGameV2(1);
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const ctx = ctxFor(game, null);
    applyLink(ctx, { type: "link", share_control_percent: 50, duration: { unit: "rounds", value: 2 } }, [borak, dorin]);

    applyStatus(ctx, { type: "apply_status", status: "defense_down", amount: 2, duration: { unit: "rounds", value: 3 } }, [borak]);

    expect(dorin.statuses.some((s) => s.status === "defense_down")).toBe(false);
  });

  it("parceiro morto não recebe a propagação (sem lançar erro)", () => {
    const game = createGameV2(1);
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    const ctx = ctxFor(game, null);
    applyLink(ctx, { type: "link", share_control_percent: 50, duration: { unit: "rounds", value: 2 } }, [borak, dorin]);
    dorin.alive = false;

    expect(() => applyStatus(ctx, { type: "apply_status", status: "stun", duration: { unit: "rounds", value: 4 } }, [borak])).not.toThrow();
    expect(dorin.statuses.some((s) => s.status === "stun")).toBe(false);
  });
});

describe("playCardV2 — sylvane_elo_natural de ponta a ponta", () => {
  it("joga a carta escolhendo dois inimigos e liga os dois entre si", () => {
    const game = createGameV2(1, { comp: { A: ["sylvane", "niara", "selene"], B: ["borak", "dorin", "aurelia"] } });
    const sylvane = game.teams.A.champions.find((c) => c.defId === "sylvane")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const dorin = game.teams.B.champions.find((c) => c.defId === "dorin")!;
    borak.pos = { q: sylvane.pos.q + 1, r: sylvane.pos.r };
    dorin.pos = { q: sylvane.pos.q + 2, r: sylvane.pos.r };
    game.teams.A.mana = 10;
    const card = putCardInHand(game, "A", sylvane.uid, "sylvane_elo_natural");

    playCardV2(game, "A", card.uid, 2, { uid: borak.uid, uid2: dorin.uid });

    expect(linkedPartnerOf(borak)).toBe(dorin.uid);
    expect(linkedPartnerOf(dorin)).toBe(borak.uid);
    expect(linkedPartnerOf(sylvane)).toBeNull();
  });
});
