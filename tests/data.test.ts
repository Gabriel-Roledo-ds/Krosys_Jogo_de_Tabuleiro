import { describe, it, expect } from "vitest";
import champions from "../data/champions.json";
import cards from "../data/cards.json";
import boss from "../data/boss.json";
import monsters from "../data/monsters.json";
import balance from "../data/balance.json";
import { useRealData } from "./compact";

useRealData(); // estes testes conferem os arquivos de dados de verdade, não o tabuleiro compacto


const championCards = cards.filter((c) => c.owner !== "monster");
const monsterCards = cards.filter((c) => c.owner === "monster");

describe("campeões", () => {
  it("são 6 com HP e defesa da ficha", () => {
    expect(champions.map((c) => [c.id, c.hp, c.defense])).toEqual([
      ["atirador", 14, 0],
      ["piromante", 14, 0],
      ["andarilho", 16, 1],
      ["enredador", 18, 1],
      ["curandeiro", 16, 0],
      ["arquiteto", 20, 2],
    ]);
  });

  it("cada campeão tem pelo menos 10 cartas no baralho", () => {
    for (const ch of champions) {
      const n = championCards.filter((c) => c.owner === ch.id).length;
      expect(n, ch.id).toBeGreaterThanOrEqual(balance.cards.deck_size_min);
    }
  });

  it("basicas custam 0 (não estão no baralho) e têm alcance", () => {
    for (const ch of champions) {
      expect(ch.basic.range, ch.id).toBeDefined();
    }
  });
});

describe("cartas", () => {
  it("são 120 de campeão (6 x 20) e 3 de monstro", () => {
    expect(championCards).toHaveLength(120);
    expect(monsterCards).toHaveLength(3);
  });

  it("ids são únicos", () => {
    const ids = cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda carta tem custo, fast, range, target e pelo menos um efeito", () => {
    for (const c of cards) {
      expect(c.cost, c.id).toBeGreaterThanOrEqual(1);
      expect(typeof c.fast, c.id).toBe("boolean");
      expect(c.range, c.id).toBeDefined();
      expect(c.target, c.id).toBeTruthy();
      expect(c.effects.length, c.id).toBeGreaterThan(0);
    }
  });

  it("as cartas rápidas são exatamente a lista confirmada", () => {
    const fast = championCards.filter((c) => c.fast).map((c) => c.id).sort();
    expect(fast).toEqual(
      ["bencao", "escudo", "escudo_reativo", "estaca", "purificar", "recuo_tatico", "retorno", "vigia"].sort(),
    );
  });

  it("Execução: 8 de dano base, 12 no total se marcado (marca incluída)", () => {
    const ex = cards.find((c) => c.id === "execucao")!;
    const dmg = ex.effects[0] as any;
    expect(dmg.amount).toBe(8);
    expect(dmg.total_if_target_has_status).toEqual({ status: "mark", total: 12, mark_included: true });
    expect(ex.cost).toBe(5);
  });

  it("queimadura e dano ao longo do tempo contam em rodadas", () => {
    for (const id of ["fogo_fatuo", "chao_em_chamas", "rastro_de_fogo", "regeneracao", "torre_de_vigia"]) {
      const c = cards.find((x) => x.id === id)!;
      const e = c.effects[0] as any;
      if (e.duration) expect(e.duration.unit, id).toBe("rounds");
    }
    expect(balance.effects.damage_over_time_counts_in).toBe("rounds");
  });

  it("controle em campeão dura em turnos do campeão", () => {
    for (const id of ["raizes", "atordoar", "silencio"]) {
      const e = cards.find((x) => x.id === id)!.effects[0] as any;
      expect(e.duration.unit, id).toBe("champion_turns");
      expect(e.control, id).toBe(true);
    }
  });

  it("Purificar é rápida e remove efeitos negativos (descongela)", () => {
    const p = cards.find((c) => c.id === "purificar")!;
    expect(p.fast).toBe(true);
    expect(p.effects[0].type).toBe("remove_negative_effects");
  });
});

describe("boss", () => {
  it("tem 40 de vida, defesa 1, alcance 4 e 11 cartas", () => {
    expect(boss.hp).toBe(40);
    expect(boss.defense).toBe(1);
    expect(boss.range).toBe(4);
    expect(boss.deck).toHaveLength(11);
    expect(balance.boss.deck_size).toBe(11);
  });

  it("toda carta tem um tipo de alvo válido", () => {
    for (const c of boss.deck) {
      expect(balance.boss.target_types, c.id).toContain(c.target);
    }
  });

  it("classificação das cartas segue as regras", () => {
    const by = (t: string) => boss.deck.filter((c) => c.target === t).map((c) => c.id).sort();
    expect(by("closest")).toEqual(["agarrar", "garra", "pisao", "prole", "sopro_gelido"].sort());
    expect(by("last_attacker")).toEqual(["devorar", "maldicao"]);
    expect(by("aura")).toEqual(["carapaca", "furia", "terremoto"]);
    expect(by("area")).toEqual(["rugido"]);
  });

  it("Terremoto é aura de raio 5 com dano contínuo de 1 que ignora defesa", () => {
    const t = boss.deck.find((c) => c.id === "terremoto") as any;
    expect(t.radius).toBe(5);
    expect(balance.boss.terremoto_radius).toBe(5);
    expect(t.effects[0].amount_per_round).toBe(1);
    expect(t.effects[0].ignores_defense).toBe(true);
  });
});

describe("monstros", () => {
  const { types, placements } = monsters;

  it("são 20: 8 fracos, 8 médios, 4 fortes (bate com balance.json)", () => {
    const count = (t: string) => placements.filter((m) => m.type === t).length;
    expect(placements).toHaveLength(balance.monsters.total);
    expect(count("weak")).toBe(balance.monsters.rings.near_start_per_team * balance.teams.count + balance.monsters.rings.second_ring_total);
    expect(count("medium")).toBe(balance.monsters.rings.middle_ring_total);
    expect(count("strong")).toBe(balance.monsters.rings.near_boss_total);
    expect(new Set(placements.map((m) => m.id)).size).toBe(20);
  });

  it("cada monstro tem uma passiva de multiplicador de dano com raio", () => {
    for (const t of Object.values(types) as any[]) {
      expect(["aura_damage_dealt_multiplier", "aura_damage_taken_multiplier"]).toContain(t.passive.type);
      expect(t.passive.multiplier).toBeGreaterThan(0);
      expect(t.passive.radius).toBeGreaterThanOrEqual(1);
    }
    expect((types.weak as any).passive.multiplier).toBe(1.5); // Frenesi: causa mais dano
    expect((types.medium as any).passive.multiplier).toBe(1.5); // Fragilidade: recebe mais dano
    expect((types.strong as any).passive.multiplier).toBe(0.5); // Pele de Pedra: recebe menos dano
  });

  it("cada tipo dá uma carta que existe, com custo 1, 2 e 3", () => {
    const cost = (t: keyof typeof types) => cards.find((c) => c.id === types[t].reward_card)?.cost;
    expect(cost("weak")).toBe(1);
    expect(cost("medium")).toBe(2);
    expect(cost("strong")).toBe(3);
  });

  it("mapa é simétrico nos eixos x e y e cabe no tabuleiro", () => {
    const key = (m: { type: string; position: { x: number; y: number } }) => `${m.type}:${m.position.x}:${m.position.y}`;
    const keys = new Set(placements.map(key));
    for (const m of placements) {
      expect(m.position.x).toBeGreaterThanOrEqual(0);
      expect(m.position.x).toBeLessThan(balance.board.width);
      expect(m.position.y).toBeGreaterThanOrEqual(0);
      expect(m.position.y).toBeLessThan(balance.board.height);
      const mirror = { type: m.type, position: { x: balance.board.width - 1 - m.position.x, y: m.position.y } };
      expect(keys.has(key(mirror)), key(m)).toBe(true);
      const flip = { type: m.type, position: { x: m.position.x, y: balance.board.height - 1 - m.position.y } };
      expect(keys.has(key(flip)), key(m)).toBe(true);
    }
  });

  it("nenhum monstro ocupa a casa do boss ou uma largada", () => {
    const starts = [...balance.teams.start_areas.A, ...balance.teams.start_areas.B];
    for (const m of placements) {
      expect(m.position).not.toEqual(balance.board.boss_position);
      expect(starts).not.toContainEqual(m.position);
    }
  });
});

describe("balance.json", () => {
  it("confirma as decisões do dia", () => {
    expect(balance.mana.gain_per_turn).toBe(3);
    expect(balance.mana.cap).toBe(10);
    expect(balance.fast_cards.max_chained_responses).toBe(3);
    expect(balance.effects.collision_damage).toBe(0);
    expect(balance.boss.max_active_auras).toBe(1);
    expect(balance.boss.drawing_aura_skips_attack).toBe(true);
    expect(balance.combat.champions_can_attack_other_teams).toBe(true);
  });

  it("cada equipe tem 9 casas de largada, sem sobreposição", () => {
    const { A, B } = balance.teams.start_areas;
    expect(A).toHaveLength(9);
    expect(B).toHaveLength(9);
    const all = [...A, ...B].map((p) => `${p.x},${p.y}`);
    expect(new Set(all).size).toBe(18);
  });
});

describe("losango", () => {
  it("largadas e monstros ficam dentro do tabuleiro e o boss no centro", async () => {
    const { inBounds } = await import("../src/engine/board");
    const { width: w, height: h } = balance.board;
    expect([w, h]).toEqual([21, 21]);
    expect(balance.board.boss_position).toEqual({ x: 10, y: 10 });
    for (const team of ["A", "B"] as const) {
      expect(balance.teams.start_areas[team]).toHaveLength(9);
      for (const p of balance.teams.start_areas[team]) expect(inBounds(p, w, h)).toBe(true);
    }
    for (const m of monsters.placements) expect(inBounds(m.position, w, h)).toBe(true);
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inBounds({ x, y }, w, h)) n++;
    expect(n).toBe(221);
    // O boss só alcança uma parte do mapa: sobra bastante chão fora do alcance dele.
    let outside = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inBounds({ x, y }, w, h) && Math.max(Math.abs(x - 10), Math.abs(y - 10)) > (boss as any).range) outside++;
    expect(outside / n).toBeGreaterThan(0.55);
  });
});
