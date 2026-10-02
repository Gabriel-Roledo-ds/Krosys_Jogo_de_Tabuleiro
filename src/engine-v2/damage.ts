// Cálculo e aplicação de dano entre campeões no motor hexagonal (roster v2).
// Mesma ordem de regras-e-decisoes.md §7 que o MVP (src/engine/damage.ts):
// base, bônus, defesa, escudo, vida — adaptado pros novos parâmetros de carta
// (ignore_defense/ignore_shield) e status (damage_buff/damage_down,
// defense_buff/defense_down) do catálogo em claude/formato-dados.md.
//
// Escopo atual: só campeão-contra-campeão (sem boss/monstros no motor novo
// ainda — ver KANBAN.md). reflect_amount (Varek/Niara) e devolução por Elo
// (share_heal_percent/link) entram quando a pilha de efeitos for ligada.

import { balance } from "../engine/data";
import type { ChampionStateV2 } from "./state";
import { statusAmount } from "./status";

export interface DamageOptsV2 {
  ignoreDefense?: boolean;
  ignoreShield?: boolean;
  /** dano contínuo (queimadura, veneno): ignora defesa, sem mínimo de 1. */
  dot?: boolean;
  /** bônus fixo extra, já calculado por quem chamou (ex. marca, carta). */
  bonus?: number;
  /**
   * Pula o multiplicador balance.damage.champion_damage_multiplier mesmo com
   * `attacker` null. Convenção herdada do MVP (src/engine/damage.ts,
   * damageMultipliers): o x1,5 só vale pra fontes "champion" ou "world"
   * (DamageSource.kind), nunca pra "monster" — lacaio do boss (monsters.ts)
   * é dano de monstro, não de campeão nem "do mundo", então não leva o bônus.
   * Dano de área do chão (ground_fire/venom, tick.ts) continua sem essa opção
   * porque é "world" e deve manter o x1,5, igual ao MVP.
   */
  skipChampionMultiplier?: boolean;
}

const roundMultiplied = (x: number): number => Math.floor(x + 0.5 + 1e-9);

/** Dano final que o alvo sofreria, antes do escudo. Base 0 continua 0. */
export function computeDamageV2(attacker: ChampionStateV2 | null, target: ChampionStateV2, base: number, opts: DamageOptsV2 = {}): number {
  if (base <= 0) return 0;

  let bonus = opts.bonus ?? 0;
  if (attacker) {
    bonus += statusAmount(attacker, "damage_buff") - statusAmount(attacker, "damage_down");
  }
  let total = base + bonus;

  // % de dano permanente (recompensa de monstro do mapa — ver monsters.ts). Aplicado
  // antes do multiplicador x1,5 dos campeões, separado por ser uma fonte diferente de bônus.
  if (attacker?.permanentDamageBonusPercent) {
    total = roundMultiplied(total * (1 + attacker.permanentDamageBonusPercent / 100));
  }

  const champDamageMult = opts.skipChampionMultiplier ? 1 : balance.damage.champion_damage_multiplier ?? 1;
  if (champDamageMult !== 1) total = roundMultiplied(total * champDamageMult);

  const ignoresDefense = opts.dot || opts.ignoreDefense;
  if (!ignoresDefense) {
    const effectiveDefense = target.defense + statusAmount(target, "defense_buff") - statusAmount(target, "defense_down");
    total -= effectiveDefense;
  }
  if (!opts.dot) total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  return Math.max(0, total);
}

export interface DealDamageResultV2 {
  final: number;
  absorbedByShield: number;
  reflectToAttacker: number;
}

/**
 * Causa dano no alvo. Devolve quanto foi absorvido pelo escudo e quanto deve
 * ser refletido no atacante (reflect_amount do escudo) — quem chama decide se
 * aplica a devolução, pra não precisar de referência circular aqui.
 */
export function dealDamageV2(attacker: ChampionStateV2 | null, target: ChampionStateV2, base: number, opts: DamageOptsV2 = {}): DealDamageResultV2 {
  const final = computeDamageV2(attacker, target, base, opts);
  if (final <= 0) return { final: 0, absorbedByShield: 0, reflectToAttacker: 0 };

  let remaining = final;
  let absorbedByShield = 0;
  let reflectToAttacker = 0;
  if (!opts.ignoreShield && target.shield > 0) {
    absorbedByShield = Math.min(target.shield, remaining);
    target.shield -= absorbedByShield;
    remaining -= absorbedByShield;
    if (absorbedByShield > 0) {
      reflectToAttacker =
        target.reflectPercent !== undefined ? Math.round((absorbedByShield * target.reflectPercent) / 100) : target.reflect;
    }
    if (target.shield === 0) {
      target.reflect = 0;
      target.reflectPercent = undefined;
    }
  }
  target.hp -= remaining;
  if (attacker) target.lastHitBy = { team: attacker.team, champion: attacker.uid };
  return { final, absorbedByShield, reflectToAttacker };
}
