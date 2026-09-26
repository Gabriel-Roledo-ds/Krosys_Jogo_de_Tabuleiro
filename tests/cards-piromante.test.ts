import { describe, it, expect } from "vitest";
import { applyAction } from "../src/engine/turn";
import { getChampion } from "../src/engine/state";
import { onLand } from "../src/engine/hazards";
import { tickRound } from "../src/engine/tick";
import { give, hp, place, play, scenario, uid } from "./helpers";

const mk = () => scenario({ A: ["piromante", "atirador", "curandeiro"], B: ["atirador", "curandeiro", "andarilho"] });
const P = uid("A", "piromante");
const b1 = uid("B", "atirador"); // defesa 0
const b2 = uid("B", "curandeiro"); // defesa 0
const b3 = uid("B", "andarilho"); // defesa 1

describe("Piromante: básica e passiva", () => {
  it("Faísca: 1 de dano de fogo em quem estiver na casa, alcance 3", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    applyAction(s, "A", { type: "basic", target: { pos: { x: 5, y: 8 } } });
    expect(hp(s, b1)).toBe(13);
  });

  it("Pele em Brasa: imune ao fogo, o próprio e o de aliados", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, uid("A", "atirador"), 6, 5);
    give(s, "A", "bola_de_fogo");
    play(s, "A", "bola_de_fogo", { pos: { x: 5, y: 5 } });
    expect(hp(s, P)).toBe(14);
    expect(hp(s, uid("A", "atirador"))).toBe(14 - 3); // fogo amigo atinge quem não é imune
  });
});

describe("Piromante: 10 cartas", () => {
  it("Brasa: 1 de dano em raio 1", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    place(s, b2, 6, 9);
    give(s, "A", "brasa");
    play(s, "A", "brasa", { pos: { x: 5, y: 8 } });
    expect(hp(s, b1)).toBe(13);
    expect(hp(s, b2)).toBe(15);
  });

  it("Fogo Fátuo: uma casa queima 1 por rodada durante 2 rodadas", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    give(s, "A", "fogo_fatuo");
    play(s, "A", "fogo_fatuo", { pos: { x: 5, y: 8 } });
    expect(s.ground).toHaveLength(1);
    tickRound(s);
    expect(hp(s, b1)).toBe(13);
    tickRound(s);
    expect(hp(s, b1)).toBe(12);
    tickRound(s);
    expect(hp(s, b1)).toBe(12);
    expect(s.ground).toHaveLength(0);
  });

  it("Chão em Chamas: 3x3 queima 1 por rodada e ignora a defesa", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b3, 6, 8);
    give(s, "A", "chao_em_chamas");
    play(s, "A", "chao_em_chamas", { pos: { x: 5, y: 8 } });
    expect(s.ground).toHaveLength(9);
    tickRound(s);
    expect(hp(s, b3)).toBe(16 - 1); // dano contínuo ignora defesa 1
  });

  it("Rastro de Fogo: casas por onde o campeão passou neste turno queimam", () => {
    const s = mk();
    place(s, P, 5, 5);
    s.turn.movementLeft = 3;
    applyAction(s, "A", { type: "move", to: { x: 5, y: 8 } });
    give(s, "A", "rastro_de_fogo");
    play(s, "A", "rastro_de_fogo");
    expect(s.ground).toHaveLength(3); // uma casa por passo
    expect(s.ground.some((g) => g.pos.x === 5 && g.pos.y === 8)).toBe(true);
  });

  it("Combustão: 3 de dano só se o alvo estiver em chamas", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    give(s, "A", "combustao");
    give(s, "A", "fogo_fatuo");
    play(s, "A", "combustao", { uid: b1 });
    expect(hp(s, b1)).toBe(14); // falhou: não está em chamas
    play(s, "A", "fogo_fatuo", { pos: { x: 5, y: 8 } });
    give(s, "A", "combustao");
    play(s, "A", "combustao", { uid: b1 });
    expect(hp(s, b1)).toBe(11);
  });

  it("Bola de Fogo: 3 em raio 1", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    place(s, b2, 6, 9);
    give(s, "A", "bola_de_fogo");
    play(s, "A", "bola_de_fogo", { pos: { x: 5, y: 8 } });
    expect(hp(s, b1)).toBe(11);
    expect(hp(s, b2)).toBe(13);
  });

  it("Muro de Chamas: linha de 4 casas, 2 de dano a quem entrar", () => {
    const s = mk();
    place(s, P, 5, 5);
    give(s, "A", "muro_de_chamas");
    play(s, "A", "muro_de_chamas", { pos: { x: 4, y: 7 }, dir: { x: 1, y: 0 } });
    expect(s.ground.filter((g) => g.kind === "fire_wall")).toHaveLength(4);
    place(s, b1, 6, 7);
    onLand(s, getChampion(s, b1), { voluntary: true });
    expect(hp(s, b1)).toBe(12);
  });

  it("Chuva de Faíscas: 1 de dano em 3 alvos aleatórios a até 5 casas", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    place(s, b2, 6, 9);
    place(s, b3, 4, 9);
    give(s, "A", "chuva_de_faiscas");
    play(s, "A", "chuva_de_faiscas");
    // O boss (7,7) também está no alcance: são 4 candidatos, e 3 são sorteados.
    const lost = [14 - hp(s, b1), 16 - hp(s, b2), 16 - hp(s, b3), 60 - s.boss.hp];
    expect(lost.filter((x) => x === 1)).toHaveLength(3);
    expect(lost.filter((x) => x === 0)).toHaveLength(1);
  });

  it("Nova: 2 de dano em raio 2 ao redor do próprio campeão e empurra 1 casa", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 6, 5);
    give(s, "A", "nova");
    play(s, "A", "nova");
    expect(hp(s, b1)).toBe(12);
    expect(getChampion(s, b1).pos).toEqual({ x: 7, y: 5 });
    expect(hp(s, P)).toBe(14);
  });

  it("Explosão: 5 em raio 2", () => {
    const s = mk();
    place(s, P, 5, 5);
    place(s, b1, 5, 8);
    place(s, b2, 7, 10);
    give(s, "A", "explosao");
    play(s, "A", "explosao", { pos: { x: 5, y: 8 } });
    expect(hp(s, b1)).toBe(9);
    expect(hp(s, b2)).toBe(16 - 5);
  });
});
