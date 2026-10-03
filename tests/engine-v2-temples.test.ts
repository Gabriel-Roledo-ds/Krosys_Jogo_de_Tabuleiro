// Templos de bênção nos cantos obtusos do mapa hexagonal (roster v2) — item 43
// do KANBAN, regras-e-decisoes.md §21. Ver src/engine-v2/{temples,temples-data}.ts.

import { describe, it, expect } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { attackTempleV2, findTempleV2, isTempleUidV2 } from "../src/engine-v2/temples";
import { isFreeCellV2 } from "../src/engine-v2/world";
import { tickRoundV2 } from "../src/engine-v2/tick";
import { statusAmount, hasStatus } from "../src/engine-v2/status";
import { hexBoard } from "../src/design/hexBoard";
import { viewForV2 } from "../src/server/view-v2";
import { playBasicV2 } from "../src/engine-v2/cardPlay";
import { enumerateTargetsV2 } from "../src/engine-v2/targeting";

describe("templos de bênção (motor v2)", () => {
  it("cria exatamente 2 templos, um por canto obtuso, cada um com o deus fixo certo", () => {
    const game = createGameV2(1);
    expect(game.temples).toHaveLength(hexBoard.corner_pockets.length);
    const norte = findTempleV2(game, "temple-canto_norte");
    const sul = findTempleV2(game, "temple-canto_sul");
    expect(norte.godId).toBe("furia");
    expect(sul.godId).toBe("vida");
    expect(norte.alive).toBe(true);
    expect(norte.claimedBy).toBeNull();
    expect(norte.hp).toBe(norte.maxHp);
    expect(norte.hp).toBeGreaterThan(0);
  });

  it("uid de templo segue o padrão temple-<canto> e isTempleUidV2 reconhece só esse padrão", () => {
    expect(isTempleUidV2("temple-canto_norte")).toBe(true);
    expect(isTempleUidV2("monster-3")).toBe(false);
    expect(isTempleUidV2(undefined)).toBe(false);
  });

  it("a casa de um guardião vivo é sólida (bloqueia movimento/ocupação)", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_norte");
    expect(isFreeCellV2(game, temple.pos)).toBe(false);
    temple.alive = false;
    expect(isFreeCellV2(game, temple.pos)).toBe(true);
  });

  it("attackTempleV2 causa dano (base - defesa, mínimo 1) e contra-ataca o atacante, ignorando a defesa dele, se o guardião sobreviver", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_norte");
    const niara = game.teams.A.champions[0];
    niara.defense = 3; // pra confirmar que o contra-ataque realmente ignora isso
    const hpBefore = niara.hp;
    const templeHpBefore = temple.hp;

    const dealt = attackTempleV2(game, niara, temple, 5);

    expect(dealt).toBe(Math.max(1, 5 - temple.defense));
    expect(temple.hp).toBe(templeHpBefore - dealt);
    expect(temple.alive).toBe(true); // guardião tem muito mais hp que isso
    // contra-ataque: dano fixo do guardião, SEM subtrair a defesa do campeão
    expect(niara.hp).toBe(hpBefore - temple.counterDamage);
  });

  it("um golpe que mata o guardião não sofre contra-ataque (ele já caiu)", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_norte");
    temple.hp = 1; // um golpe qualquer mata
    const niara = game.teams.A.champions[0];
    const hpBefore = niara.hp;

    attackTempleV2(game, niara, temple, 10);

    expect(temple.alive).toBe(false);
    expect(niara.hp).toBe(hpBefore); // sem contra-ataque
  });

  it("derrotar o guardião reivindica o templo pra equipe do atacante e concede a bênção fixa do canto a TODOS os 3 campeões (vivos ou mortos)", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_norte"); // deus "furia" -> damage_buff
    temple.hp = 1;
    const niara = game.teams.A.champions[0];
    const varek = game.teams.A.champions[1];
    varek.alive = false; // confirma que a bênção também é concedida a quem está fora de campo

    attackTempleV2(game, niara, temple, 10);

    expect(temple.alive).toBe(false);
    expect(temple.claimedBy).toBe("A");
    expect(game.teams.A.blessings).toEqual(["furia"]);
    for (const c of game.teams.A.champions) {
      expect(statusAmount(c, "damage_buff")).toBeGreaterThanOrEqual(2);
      expect(hasStatus(c, "damage_buff")).toBe(true);
    }
    // time B não ganhou nada
    for (const c of game.teams.B.champions) expect(hasStatus(c, "damage_buff")).toBe(false);
  });

  it("a bênção é permanente: tickRoundV2 passando várias rodadas não remove nem reduz o status", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_sul"); // deus "vida" -> heal_over_time
    temple.hp = 1;
    const niara = game.teams.A.champions[0];
    attackTempleV2(game, niara, temple, 10);
    expect(hasStatus(niara, "heal_over_time")).toBe(true);

    niara.hp = Math.max(1, niara.maxHp - 10); // dá espaço pra curar, sem passar do máximo
    const hpBeforeTicks = niara.hp;
    for (let i = 0; i < 20; i++) tickRoundV2(game);

    expect(hasStatus(niara, "heal_over_time")).toBe(true); // nunca expira
    expect(niara.hp).toBeGreaterThan(hpBeforeTicks); // e continuou curando a cada rodada
  });

  it("um templo já reivindicado não pode ser alvo de novo (guardião não está mais em campo)", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_norte");
    temple.hp = 1;
    const niara = game.teams.A.champions[0];
    attackTempleV2(game, niara, temple, 10);

    const before = game.teams.A.blessings.length;
    const dealt = attackTempleV2(game, niara, temple, 10);
    expect(dealt).toBe(0);
    expect(game.teams.A.blessings.length).toBe(before); // não reconcede a bênção
  });

  it("viewForV2 expõe os templos sem filtrar por neblina (marco fixo, igual ao boss)", () => {
    const game = createGameV2(1);
    const view = viewForV2(game, "A") as { temples: unknown[] };
    expect(view.temples).toHaveLength(2);
  });

  it("de ponta a ponta: a básica de um campeão adjacente ao templo o enumera como alvo válido e causa dano de verdade via playBasicV2", () => {
    const game = createGameV2(1);
    const temple = findTempleV2(game, "temple-canto_norte");
    const niara = game.teams.A.champions[0];
    niara.pos = { q: temple.pos.q - 1, r: temple.pos.r }; // adjacente, dentro do alcance 4 da básica

    const targets = enumerateTargetsV2(game, niara, { range: 4, target: "enemy" });
    expect(targets.some((t) => t.uid === temple.uid)).toBe(true);

    const templeHpBefore = temple.hp;
    playBasicV2(game, niara.uid, { uid: temple.uid });
    expect(temple.hp).toBeLessThan(templeHpBefore);
  });
});
