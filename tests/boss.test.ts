import { describe, it, expect } from "vitest";
import { beginBossActivation, bossShouldActivate, resolveBossItem } from "../src/engine/boss";
import { resolveDeaths } from "../src/engine/death";
import { getChampion, type GameState } from "../src/engine/state";
import { dealDamage, worldSource } from "../src/engine/damage";
import { tickRound } from "../src/engine/tick";
import { applyAction } from "../src/engine/turn";
import { give, hp, place, scenario, uid } from "./helpers";

const mk = () => scenario({ A: ["atirador", "piromante", "arquiteto"], B: ["atirador", "curandeiro", "andarilho"] });
const near = uid("A", "atirador"); // defesa 0
const far = uid("A", "piromante");
const tank = uid("A", "arquiteto"); // defesa 2

/** Faz o boss ativar a carta indicada sobre a equipe A. */
function bossPlays(s: GameState, cardId: string): void {
  s.boss.deck = [cardId, ...s.boss.deck.filter((c) => c !== cardId)];
  const item = beginBossActivation(s, "A");
  resolveBossItem(s, item);
  resolveDeaths(s);
}

describe("ativação do boss", () => {
  it("só ativa se um campeão do jogador estiver a até 4 casas do boss", () => {
    const s = mk();
    expect(bossShouldActivate(s, "A")).toBe(false);
    place(s, near, 7, 4); // distância 3
    expect(bossShouldActivate(s, "A")).toBe(true);
    place(s, near, 7, 2); // distância 5
    expect(bossShouldActivate(s, "A")).toBe(false);
  });

  it("campeão imune (recém-voltado) não conta", () => {
    const s = mk();
    place(s, near, 7, 4);
    getChampion(s, near).untargetable = true;
    expect(bossShouldActivate(s, "A")).toBe(false);
  });

  it("no início do turno do jogador o boss compra a carta do topo e atinge o campeão em alcance", () => {
    const s = scenario({ A: ["atirador", "piromante", "arquiteto"], B: ["atirador", "curandeiro", "andarilho"] });
    place(s, near, 7, 4);
    s.boss.deck = ["garra", ...s.boss.deck.filter((c) => c !== "garra")];
    applyAction(s, "A", { type: "end" });
    place(s, uid("B", "atirador"), 12, 12);
    applyAction(s, "B", { type: "draw", champion: uid("B", "atirador") });
    applyAction(s, "B", { type: "end" });
    expect(hp(s, near)).toBe(14 - 3);
    expect(s.boss.discard).toContain("garra");
    expect(s.turn.phase).toBe("draw"); // depois do boss segue o turno normal
  });

  it("baralho esgotado: embaralha o descarte", () => {
    const s = mk();
    place(s, near, 7, 4);
    s.boss.discard = ["garra", "pisao"];
    s.boss.deck = [];
    beginBossActivation(s, "A");
    expect(s.boss.discard).toHaveLength(0);
    expect(s.boss.deck).toHaveLength(1);
  });
});

describe("11 cartas do boss", () => {
  it("Garra (mais próximo): 3 de dano ao campeão mais próximo", () => {
    const s = mk();
    place(s, near, 7, 4);
    place(s, far, 7, 3);
    bossPlays(s, "garra");
    expect(hp(s, near)).toBe(11);
    expect(hp(s, far)).toBe(14);
  });

  it("Garra respeita a defesa", () => {
    const s = mk();
    place(s, tank, 7, 4);
    bossPlays(s, "garra");
    expect(hp(s, tank)).toBe(20 - 1);
  });

  it("Rugido (área raio 3): empurra 3 casas e 1 de dano em todos, de qualquer equipe", () => {
    const s = mk();
    place(s, near, 7, 4);
    place(s, uid("B", "atirador"), 9, 8);
    bossPlays(s, "rugido");
    expect(hp(s, near)).toBe(13);
    expect(getChampion(s, near).pos).toEqual({ x: 7, y: 1 });
    expect(hp(s, uid("B", "atirador"))).toBe(13);
    expect(getChampion(s, uid("B", "atirador")).pos.x).toBeGreaterThan(9);
  });

  it("Pisão: 2 de dano no alvo e em quem estiver adjacente a ele", () => {
    const s = mk();
    place(s, near, 7, 4);
    place(s, far, 7, 3);
    place(s, uid("A", "arquiteto"), 12, 12);
    bossPlays(s, "pisao");
    expect(hp(s, near)).toBe(12);
    expect(hp(s, far)).toBe(12);
  });

  it("Sopro Gélido: alvo perde 3 de movimento no próximo turno", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "sopro_gelido");
    expect(getChampion(s, near).statuses.find((x) => x.kind === "move_penalty")?.amount).toBe(3);
  });

  it("Devorar (último a atacar): 4 de dano e o boss recupera 2", () => {
    const s = mk();
    place(s, near, 7, 4);
    place(s, far, 7, 5);
    s.boss.hp = 50;
    s.boss.lastAttacker = far;
    bossPlays(s, "devorar");
    expect(hp(s, far)).toBe(10);
    expect(hp(s, near)).toBe(14);
    expect(s.boss.hp).toBe(52);
  });

  it("último a atacar fora do alcance: cai para o mais próximo", () => {
    const s = mk();
    place(s, near, 7, 4);
    place(s, far, 1, 1);
    s.boss.lastAttacker = far;
    bossPlays(s, "devorar");
    expect(hp(s, near)).toBe(10);
  });

  it("dano em quem atacou o boss registra o último atacante", () => {
    const s = mk();
    place(s, near, 7, 5);
    applyAction(s, "A", { type: "basic", target: { uid: "boss" } });
    expect(s.boss.lastAttacker).toBe(near);
  });

  it("Prole: invoca um lacaio (3 de vida, 1 de dano) adjacente ao alvo", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "prole");
    expect(s.minions).toHaveLength(1);
    expect(s.minions[0]).toMatchObject({ hp: 3, damage: 1 });
    const m = s.minions[0].pos;
    expect(Math.max(Math.abs(m.x - 7), Math.abs(m.y - 4))).toBe(1);
  });

  it("Agarrar: 2 de dano e o alvo não se move no próximo turno", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "agarrar");
    expect(hp(s, near)).toBe(12);
    expect(getChampion(s, near).statuses.some((x) => x.kind === "immobilized")).toBe(true);
  });

  it("Maldição (último a atacar): alvo descarta 1 carta aleatória da mão", () => {
    const s = mk();
    place(s, near, 7, 4);
    s.boss.lastAttacker = near;
    give(s, "A", "tiro_rapido");
    give(s, "A", "tiro_perfurante");
    bossPlays(s, "maldicao");
    expect(s.teams.A.hand).toHaveLength(1);
    expect(s.teams.A.decks[near].discard).toHaveLength(1);
  });
});

describe("auras do boss", () => {
  it("comprar uma aura só a ativa: o boss não ataca naquela ativação", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "terremoto");
    expect(hp(s, near)).toBe(14);
    expect(s.boss.aura?.cardId).toBe("terremoto");
  });

  it("Terremoto: 1 de dano contínuo por rodada a quem está em raio 4, ignorando defesa", () => {
    const s = mk();
    place(s, tank, 7, 4);
    place(s, far, 1, 1);
    bossPlays(s, "terremoto");
    tickRound(s);
    tickRound(s);
    expect(hp(s, tank)).toBe(18); // defesa 2 não reduz dano contínuo
    expect(hp(s, far)).toBe(14);
  });

  it("no máximo 1 aura ativa: a nova substitui a anterior", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "terremoto");
    bossPlays(s, "furia");
    expect(s.boss.aura?.cardId).toBe("furia");
    tickRound(s);
    expect(hp(s, near)).toBe(14); // o Terremoto não vale mais
  });

  it("Fúria: as próximas 2 cartas do boss causam +1 de dano", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "furia");
    bossPlays(s, "garra");
    expect(hp(s, near)).toBe(14 - 4);
    bossPlays(s, "garra");
    expect(hp(s, near)).toBe(14 - 4 - 4);
    expect(s.boss.aura).toBeNull();
    bossPlays(s, "garra");
    expect(hp(s, near)).toBe(14 - 4 - 4 - 3);
  });

  it("Carapaça: o boss ignora 2 de dano até a próxima ativação dele", () => {
    const s = mk();
    place(s, near, 7, 4);
    bossPlays(s, "carapaca");
    expect(s.boss.damageReduction).toBe(2);
    const before = s.boss.hp;
    dealDamage(s, worldSource, s.boss, 5);
    expect(before - s.boss.hp).toBe(2); // 5 - defesa 1 - 2 = 2
    bossPlays(s, "garra");
    expect(s.boss.damageReduction).toBe(0);
  });
});
