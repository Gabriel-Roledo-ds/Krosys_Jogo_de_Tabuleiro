// Testes do fluxo de turno do motor hexagonal (roster v2) — src/engine-v2/turn.ts.
// Cobre fase de compra/ação/descarte, movimento com orçamento do dado,
// básica/carta resolvendo via pilha, resposta rápida reordenando a resolução
// (escudo antes do dano que o provocou) e a alternância A/B com incremento
// de rodada. Ver KANBAN.md (item 4 da ordem de execução).

import { describe, it, expect } from "vitest";
import { createGameV2, type CardInstanceV2, type GameStateV2, type TeamId } from "../src/engine-v2/state";
import { applyActionV2, cannotBasicV2, cannotCastV2, legalActionsV2, startGameV2, IllegalActionV2 } from "../src/engine-v2/turn";
import { addStatus } from "../src/engine-v2/status";

function putCardInHand(game: GameStateV2, team: TeamId, ownerUid: string, cardId: string): CardInstanceV2 {
  const card: CardInstanceV2 = { uid: `test#${cardId}#${ownerUid}#${Math.random()}`, cardId, owner: ownerUid };
  game.teams[team].hand.push(card);
  return card;
}

describe("fase de compra", () => {
  it("primeiro turno da partida compra 3 cartas, ganha mana e entra na fase de ação", () => {
    const game = createGameV2(1);
    startGameV2(game);
    expect(game.turn.phase).toBe("draw");
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const handBefore = game.teams.A.hand.length;
    applyActionV2(game, "A", { type: "draw", champion: niara.uid });
    expect(game.teams.A.hand.length).toBe(handBefore + 3);
    expect(game.teams.A.mana).toBe(3); // gainTurnManaV2 (+3)
    expect(game.turn.phase).toBe("act");
    expect(game.turn.die).toBeGreaterThanOrEqual(1);
  });

  it("não deixa pular a compra com a mão abaixo do limite", () => {
    const game = createGameV2(1);
    startGameV2(game);
    expect(() => applyActionV2(game, "A", { type: "skipDraw" })).toThrow(/mão cheia/);
  });
});

describe("fase de ação — movimento", () => {
  it("anda até o orçamento do dado e pode continuar com o campeão já ativo", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    game.turn.die = 4;
    const niara = game.teams.A.champions[0];
    const dest1 = { q: niara.pos.q + 2, r: niara.pos.r };
    applyActionV2(game, "A", { type: "move", to: dest1, champion: niara.uid });
    expect(niara.pos).toEqual(dest1);
    expect(game.turn.movementLeft).toBe(2);

    const dest2 = { q: dest1.q + 1, r: dest1.r };
    applyActionV2(game, "A", { type: "move", to: dest2 }); // sem `champion`: usa o campeão ativo
    expect(niara.pos).toEqual(dest2);
    expect(game.turn.movementLeft).toBe(1);
  });

  it("recusa mover além do orçamento restante", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    game.turn.die = 2;
    const niara = game.teams.A.champions[0];
    const farAway = { q: niara.pos.q + 10, r: niara.pos.r };
    expect(() => applyActionV2(game, "A", { type: "move", to: farAway, champion: niara.uid })).toThrow(IllegalActionV2);
  });

  it("stay ativa o campeão sem gastar casas", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    game.turn.die = 5;
    const niara = game.teams.A.champions[0];
    applyActionV2(game, "A", { type: "stay", champion: niara.uid });
    expect(game.turn.main).toBe(niara.uid);
    expect(game.turn.movementLeft).toBe(5);
    expect(() => applyActionV2(game, "A", { type: "stay", champion: niara.uid })).toThrow(/já gastou/);
  });
});

describe("fase de ação — básica e carta resolvem via pilha quando ninguém responde", () => {
  it("básica de dano resolve na hora (hand do adversário vazia, sem resposta possível)", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.pos = { q: niara.pos.q + 2, r: niara.pos.r };
    borak.defense = 0;
    const before = borak.hp;
    applyActionV2(game, "A", { type: "basic", champion: niara.uid, target: { uid: borak.uid } });
    expect(game.pending).toBeNull();
    expect(borak.hp).toBeLessThan(before);
  });

  it("carta resolve na hora e descarta pro baralho do dono", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    game.teams.A.mana = 5;
    const niara = game.teams.A.champions.find((c) => c.defId === "niara")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    borak.pos = { q: niara.pos.q + 1, r: niara.pos.r }; // mesma linha reta (champion_in_line)
    borak.defense = 0;
    const card = putCardInHand(game, "A", niara.uid, "niara_tiro_certeiro");
    const before = borak.hp;
    applyActionV2(game, "A", { type: "play", card: card.uid, rank: 1, target: { uid: borak.uid } });
    expect(game.pending).toBeNull();
    expect(borak.hp).toBeLessThan(before);
    expect(game.teams.A.hand.find((c) => c.uid === card.uid)).toBeUndefined();
  });
});

describe("pilha de respostas rápidas reordena a resolução (LIFO)", () => {
  it("escudo rápido jogado em resposta absorve o dano da carta que o provocou", () => {
    const game = createGameV2(1, { comp: { A: ["vextra", "niara", "varek"], B: ["borak", "dorin", "selene"] } });
    game.turn.phase = "act";
    game.teams.A.mana = 10;
    game.teams.B.mana = 10;

    const vextra = game.teams.A.champions.find((c) => c.defId === "vextra")!;
    const borak = game.teams.B.champions.find((c) => c.defId === "borak")!;
    const selene = game.teams.B.champions.find((c) => c.defId === "selene")!;
    borak.pos = { q: vextra.pos.q + 2, r: vextra.pos.r };
    selene.pos = { q: borak.pos.q + 1, r: borak.pos.r };
    borak.defense = 0;

    const damageCard = putCardInHand(game, "A", vextra.uid, "vextra_lamina_rapida"); // rank1: dano 4, alc.2, custo1
    const shieldCard = putCardInHand(game, "B", selene.uid, "selene_escudo_luz"); // rank1: escudo 4, alc.3, custo2, rápida

    const before = borak.hp;
    applyActionV2(game, "A", { type: "play", card: damageCard.uid, rank: 1, target: { uid: borak.uid } });

    // A pilha abriu: B tem prioridade pra responder (Escudo de Luz é rápida e alcança o Borak).
    expect(game.pending).not.toBeNull();
    expect(game.pending?.priority).toBe("B");

    applyActionV2(game, "B", { type: "play", card: shieldCard.uid, rank: 1, target: { uid: borak.uid } });

    // Sem mais ninguém pra responder (A já jogou sua única carta), a pilha resolve:
    // o escudo (empilhado por último) resolve PRIMEIRO e absorve o dano inteiro
    // (dano base 4, escudo 4 — setup.ts usa o tabuleiro compacto com
    // champion_damage_multiplier=1 pros testes de mecânica). Se a ordem fosse
    // invertida (dano antes do escudo), o escudo chegaria tarde e não
    // absorveria nada: a vida cairia 4 e sobraria escudo parado.
    expect(game.pending).toBeNull();
    expect(borak.hp).toBe(before); // absorvido inteiro, vida não cai
    expect(borak.shield).toBe(0); // escudo consumido inteiro
  });
});

describe("fim de turno: alternância A/B e rodada", () => {
  it("end na fase de ação passa o turno pra B; o fim do turno de B incrementa a rodada", () => {
    const game = createGameV2(1);
    startGameV2(game);
    const niara = game.teams.A.champions[0];
    applyActionV2(game, "A", { type: "draw", champion: niara.uid }); // entra em "act"
    applyActionV2(game, "A", { type: "end" });
    expect(game.turn.team).toBe("B");
    expect(game.round).toBe(1);

    const borak = game.teams.B.champions[0];
    applyActionV2(game, "B", { type: "draw", champion: borak.uid });
    applyActionV2(game, "B", { type: "end" });
    expect(game.turn.team).toBe("A");
    expect(game.round).toBe(2);
  });

  it("mão acima do limite força a fase de descarte antes de encerrar", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    const niara = game.teams.A.champions[0];
    for (let i = 0; i < 8; i++) putCardInHand(game, "A", niara.uid, "niara_tiro_certeiro");
    applyActionV2(game, "A", { type: "end" });
    expect(game.turn.phase).toBe("discard");
    const extra = game.teams.A.hand[0];
    applyActionV2(game, "A", { type: "discard", card: extra.uid });
    expect(game.turn.team).toBe("B"); // mão voltou a 7, turno passou
  });
});

describe("silêncio e atordoamento bloqueiam cartas/básica (achado de escopo item 4, resolvido)", () => {
  it("cannotCastV2 detecta silenced e stunned ainda ativos; cannotBasicV2 só stunned; status 'fresh' não bloqueia", () => {
    const game = createGameV2(1);
    const c = game.teams.A.champions[0];
    expect(cannotCastV2(c)).toBe(false);
    expect(cannotBasicV2(c)).toBe(false);

    addStatus(c, 1, "silenced", "rounds", 2, { negative: true });
    expect(cannotCastV2(c)).toBe(true);
    expect(cannotBasicV2(c)).toBe(false); // silêncio só bloqueia cartas, não a básica

    c.statuses = [];
    addStatus(c, 2, "stunned", "rounds", 2, { negative: true });
    expect(cannotCastV2(c)).toBe(true);
    expect(cannotBasicV2(c)).toBe(true);

    c.statuses[0].fresh = true; // aplicado neste turno: só vale a partir do próximo
    expect(cannotCastV2(c)).toBe(false);
    expect(cannotBasicV2(c)).toBe(false);
  });

  it("legalActionsV2 não lista básica de campeão atordoado, nem carta de campeão silenciado", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    const niara = game.teams.A.champions[0];
    const card = putCardInHand(game, "A", niara.uid, "niara_marca_predador");
    addStatus(niara, 1, "stunned", "rounds", 2, { negative: true });
    let actions = legalActionsV2(game, "A");
    expect(actions.some((a) => a.type === "basic" && a.champion === niara.uid)).toBe(false);
    // atordoado também bloqueia cartas (stunned conta pra cannotCastV2)
    expect(actions.some((a) => a.type === "play" && a.card === card.uid)).toBe(false);

    niara.statuses = [];
    addStatus(niara, 2, "silenced", "rounds", 2, { negative: true });
    actions = legalActionsV2(game, "A");
    expect(actions.some((a) => a.type === "play" && a.card === card.uid)).toBe(false);
    // silêncio não bloqueia a básica
    expect(actions.some((a) => a.type === "basic" && a.champion === niara.uid)).toBe(true);
  });

  it("jogar carta de campeão silenciado lança IllegalActionV2", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    const niara = game.teams.A.champions[0];
    const foe = game.teams.B.champions[0];
    const card = putCardInHand(game, "A", niara.uid, "niara_marca_predador");
    addStatus(niara, 1, "silenced", "rounds", 2, { negative: true });
    expect(() => applyActionV2(game, "A", { type: "play", card: card.uid, rank: 1, target: { uid: foe.uid } })).toThrow(/não pode usar cartas/);
  });

  it("usar a básica de campeão atordoado lança IllegalActionV2", () => {
    const game = createGameV2(1);
    game.turn.phase = "act";
    const niara = game.teams.A.champions[0];
    const foe = game.teams.B.champions[0];
    addStatus(niara, 1, "stunned", "rounds", 2, { negative: true });
    expect(() => applyActionV2(game, "A", { type: "basic", champion: niara.uid, target: { uid: foe.uid } })).toThrow(/atordoado/);
  });
});
