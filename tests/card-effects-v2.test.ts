// Testes do `effects` estruturado das cartas v2 (data/cards_v2.json), derivado
// campeão por campeão a partir do `text` — ver regras-e-decisoes.md §19 e
// claude/formato-dados.md ("effects estruturado das cartas v2"). Só cobre as
// cartas que já têm `target` + `effects` preenchidos; as que ainda não foram
// convertidas (só têm `text`) são ignoradas aqui de propósito, pra esse teste
// não quebrar enquanto o trabalho avança campeão por campeão.

import { describe, it, expect } from "vitest";
import cardsV2 from "../data/cards_v2.json";

/** Vocabulário de `target` já usado em cards.json (MVP) + o que as cartas v2 precisaram. */
const KNOWN_TARGETS = new Set([
  "enemy",
  "ally",
  "champion",
  "cell",
  "line",
  "direction",
  "self",
  "two_enemies",
  "random_enemies",
  "champion_in_line",
  "wall",
  "two_cells",
  "dead_ally",
]);

/**
 * Tipos de efeito já implementados no motor (src/engine/effects.ts) + os novos
 * que foram precisos pra descrever cartas v2 (ainda não implementados — ver
 * claude/formato-dados.md pra lista e descrição de cada um novo).
 */
const KNOWN_EFFECT_TYPES = new Set([
  // já existem em src/engine/effects.ts
  "damage",
  "damage_second_target",
  "damage_first_in_path",
  "damage_adjacent_to_target",
  "self_damage",
  "apply_status",
  "apply_status_adjacent_enemies",
  "apply_status_area",
  "link",
  "remove_negative_effects",
  "immune_to_control_area",
  "heal",
  "heal_over_time",
  "shield",
  "resurrect",
  "bonus_move",
  "team_mana_if_moved_at_least",
  "teleport_to_turn_start",
  "move_self_away_from_target",
  "push",
  "pull",
  "force_move_toward_self",
  "swap_places",
  "move_target",
  "move_self_with_adjacent_ally",
  "move_in_line",
  "teleport_self",
  "move_all_allies",
  "phase_this_turn",
  "buff_next_card",
  "ground_fire",
  "fire_trail",
  "fire_wall",
  "slow_cell",
  "watch",
  "create_wall",
  "reinforce_wall",
  "destroy_wall",
  "create_walls_line",
  "create_walls_shape",
  "create_walls_around_target",
  "hidden_trap",
  "spring",
  "create_structure",
  "create_portal_pair",
  // novos, precisos pro roster v2 — ainda não implementados no motor
  "damage_third_target",
  "damage_pierce_line",
  "move_self",
  "jump_to_nearest_enemy_on_target_death",
  "mark_ground_area",
  "damage_behind_target",
  "apply_status_around_self",
  "delayed_damage",
  "detonate_nearby_ground_fire",
  "death_ward",
  "damage_all_adjacent_during_move",
  "gap_close_strike",
  "apply_venom_stacks",
  "venom_zone",
  "detonate_venom_stacks",
  "venom_terrain",
]);

const convertedCards = cardsV2.filter((c): c is typeof c & { target: string } => "target" in c);

describe("effects estruturado das cartas v2 (parcial — campeão por campeão)", () => {
  it("Niara, Borak, Ignira, Vextra e Thorne já estão convertidos (progresso mínimo)", () => {
    for (const owner of ["niara", "borak", "ignira", "vextra", "thorne"]) {
      expect(convertedCards.filter((c) => c.owner === owner), owner).toHaveLength(12);
    }
  });

  it("toda carta convertida tem um target do vocabulário conhecido", () => {
    for (const c of convertedCards) {
      expect(KNOWN_TARGETS, c.id).toContain(c.target);
    }
  });

  it("todo rank de carta convertida tem pelo menos 1 efeito", () => {
    for (const c of convertedCards) {
      for (const r of c.ranks) {
        expect((r as { effects?: unknown[] }).effects?.length ?? 0, `${c.id} rank ${r.rank}`).toBeGreaterThan(0);
      }
    }
  });

  it("todo efeito usado é de um tipo conhecido (implementado ou já catalogado como novo)", () => {
    for (const c of convertedCards) {
      for (const r of c.ranks) {
        for (const e of (r as { effects: { type: string }[] }).effects) {
          expect(KNOWN_EFFECT_TYPES, `${c.id} rank ${r.rank}: ${e.type}`).toContain(e.type);
        }
      }
    }
  });

  it("cartas-clímax da Niara ignoram armadura e escudo, como o texto original descreve", () => {
    const juizo = cardsV2.find((c) => c.id === "niara_tiro_juizo")!;
    for (const r of juizo.ranks as { effects: { type: string; ignore_defense?: boolean; ignore_shield?: boolean }[] }[]) {
      const dmg = r.effects.find((e) => e.type === "damage")!;
      expect(dmg.ignore_defense).toBe(true);
      expect(dmg.ignore_shield).toBe(true);
    }
  });
});
