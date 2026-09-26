// Cálculo de dano. Todo dano do jogo passa por aqui, na ordem do documento de regras:
// base, bônus fixos, multiplicadores, defesa, escudo, vida.
// Mortes não são resolvidas aqui: só depois da pilha (ver death.ts).

import { balance, getChampionDef, monsterTypes } from "./data";
import { distance, type Pos } from "./board";
import { getChampion, log, type ChampionState, type GameState, type TeamId, type Unit } from "./state";
import { isUntargetable } from "./world";

export interface DamageSource {
  team: TeamId | null;
  /** uid do campeão que causou (para último hit e Devorar) */
  champion: string | null;
  kind: "champion" | "boss" | "monster" | "world";
  /** nome de quem causou, para o registro de eventos ("Monstro Fraco", "Armadilha") */
  label?: string;
  /** de onde o golpe partiu, para passivas que dependem de distância */
  from?: Pos;
}

export interface DamageOpts {
  /** dano contínuo, ignora defesa */
  dot?: boolean;
  ignoreDefense?: boolean;
  element?: string;
  /** a marca já está incluída no total (Execução) */
  markIncluded?: boolean;
  /** bônus fixo extra (Mira Total, Fúria) */
  bonus?: number;
  /** golpe direto (aplica passivas de distância e espinhos) */
  direct?: boolean;
  /** evita repassar o dano pelo Elo e pelo reflexo */
  noChain?: boolean;
}

export const worldSource: DamageSource = { team: null, champion: null, kind: "world" };

export const championSource = (c: ChampionState): DamageSource => ({
  team: c.team,
  champion: c.uid,
  kind: "champion",
  from: c.pos,
});

/**
 * Dano final que o alvo sofreria (antes do escudo).
 * Base 0 continua 0. Base 1 ou mais nunca fica abaixo de 1 depois da defesa.
 */
export function computeDamage(s: GameState, src: DamageSource, target: Unit, base: number, opts: DamageOpts = {}): number {
  if (isUntargetable(target)) return 0;
  if (opts.element === "fire" && target.kind === "champion" && getChampionDef(target.defId).passive.effects.some((e) => e.type === "immune_to" && e.element === "fire")) {
    return 0;
  }
  let bonus = opts.bonus ?? 0;

  // Passiva do Atirador: +1 contra alvos a 3 ou mais casas (golpes diretos).
  if (opts.direct && src.kind === "champion" && src.champion && src.from) {
    const shooter = getChampion(s, src.champion);
    for (const e of getChampionDef(shooter.defId).passive.effects) {
      if (e.type === "bonus_damage_if_distance_at_least" && distance(src.from, target.pos) >= e.distance) bonus += e.amount;
    }
  }
  // Marca: +bônus de qualquer fonte.
  if (!opts.markIncluded) {
    for (const st of target.statuses) if (st.kind === "mark") bonus += st.amount ?? 0;
  }

  let total = base + bonus;
  const ignoresDefense = opts.dot || opts.ignoreDefense;
  if (!ignoresDefense) {
    total -= target.defense;
    if (target.kind === "boss") total -= target.damageReduction;
  }
  if (base >= 1 && !opts.dot) total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  return Math.max(0, total);
}

/**
 * Causa dano. Devolve o dano final aplicado (escudo e vida somados).
 * O alvo pode ficar com vida <= 0: a morte é resolvida depois, em resolveDeaths.
 */
export function dealDamage(s: GameState, src: DamageSource, target: Unit, base: number, opts: DamageOpts = {}): number {
  const final = computeDamage(s, src, target, base, opts);
  if (final <= 0) return 0;

  let remaining = final;
  let absorbed = 0;
  let reflected = 0;
  if (target.kind === "champion" && target.shield > 0) {
    absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
    reflected = target.reflect;
    if (target.shield === 0) target.reflect = 0;
  }
  target.hp -= remaining;
  const by = src.label ?? (src.champion ? label(getChampion(s, src.champion)) : src.kind === "boss" ? "Boss" : undefined);
  log(s, `${label(target)} sofre ${final} de dano${by ? ` de ${by}` : ""}${absorbed ? ` (${absorbed} absorvido pelo escudo)` : ""} [${Math.max(0, target.hp)}/${target.maxHp} PV]`);

  if (src.champion && src.team) {
    target.lastHitBy = { team: src.team, champion: src.champion };
    if (target.kind === "boss") target.lastAttacker = src.champion;
  }

  if (!opts.noChain) {
    // Reflexo do Escudo Reativo.
    if (target.kind === "champion" && absorbed > 0 && reflected > 0 && src.champion) {
      const attacker = getChampion(s, src.champion);
      if (attacker.alive) dealDamage(s, { team: target.team, champion: target.uid, kind: "champion" }, attacker, reflected, { dot: true, noChain: true });
    }
    // Elo: metade do dano vai para o parceiro.
    if (target.kind === "champion") {
      const link = target.statuses.find((x) => x.kind === "link");
      if (link?.partner) {
        const partner = getChampion(s, link.partner);
        if (partner.alive) dealDamage(s, src, partner, Math.max(1, Math.floor(final / 2)), { dot: true, noChain: true });
      }
    }
    // Espinhos do monstro médio: reflete em quem bate de perto.
    if (target.kind === "monster" && opts.direct && src.champion && src.from && distance(src.from, target.pos) === 1) {
      const thorns = monsterThorns(target);
      if (thorns > 0) dealDamage(s, { team: null, champion: null, kind: "monster", label: `Espinhos de ${label(target)}` }, getChampion(s, src.champion), thorns, { dot: true, noChain: true });
    }
  }
  return final;
}

function monsterThorns(m: { type: string }): number {
  const eff = monsterTypes[m.type].continuous_effect;
  return eff.type === "thorns_adjacent" ? eff.amount : 0;
}

export function label(u: Unit): string {
  switch (u.kind) {
    case "champion":
      return `${getChampionDef(u.defId).name} (${u.team})`;
    case "boss":
      return "Boss";
    case "monster":
      return `${monsterTypes[u.type].name} (${u.uid.slice(0, 3)})`;
    default:
      return "Lacaio do Boss";
  }
}
