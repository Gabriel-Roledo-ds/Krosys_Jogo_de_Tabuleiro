// Execução dos efeitos das cartas e habilidades básicas.
// Cada carta é uma lista de blocos de efeito (data/cards.json); aqui cada bloco vira código.

import { balance, getCardDef, getChampionDef, type Effect } from "./data";
import {
  DIRECTIONS,
  addPos,
  directionTo,
  distance,
  cellsInRadius,
  inBounds,
  isAdjacent,
  rotate90,
  samePos,
  type Pos,
} from "./board";
import { championSource, dealDamage, worldSource, label } from "./damage";
import { onLand } from "./hazards";
import { forcedMove, moveOptionsFor, movePath, reachableMap, teleport } from "./movement";
import { rngOf } from "./rng";
import { resurrect } from "./death";
import {
  getChampion,
  log,
  type ChampionState,
  type GameState,
  type StackItem,
  type Target,
  type Unit,
} from "./state";
import { addStatus, durationText, heal, removeNegative, statusLabel, tryControl } from "./status";
import { rangeOf, validateTarget } from "./targeting";
import { addPosSafe } from "./util";
import {
  getUnit,
  inRange,
  isAllyOf,
  isBurning,
  isEnemyOf,
  isFreeCell,
  isUntargetable,
  liveUnits,
  structureAt,
  unitsInRadius,
  wallAt,
} from "./world";

interface Ctx {
  s: GameState;
  owner: ChampionState;
  target: Target;
  bonusDamage: number;
  /** alcance efetivo da carta (com Mira Total) */
  range: number;
  primary: Unit | null;
  /** primeiro alvo atingido por Investida */
  hit: Unit | null;
  /** casa da parede destruída (Demolir) */
  destroyedAt: Pos | null;
}

/** Resolve uma carta ou habilidade básica da pilha. Devolve false se falhou (alvo sumiu). */
export function resolveItem(s: GameState, item: StackItem, def: { range: number | "self"; target: string; effects: Effect[] }): boolean {
  const owner = getChampion(s, item.owner!);
  if (!owner.alive) {
    log(s, `${owner.uid} não está em campo: a ação falha`);
    return false;
  }
  const err = validateTarget(s, owner, def, item.target, item.buff?.range ?? 0);
  if (err) {
    log(s, `A ação de ${owner.uid} falha (${err})`);
    return false;
  }
  const ctx: Ctx = {
    s,
    owner,
    target: item.target,
    bonusDamage: item.buff?.damage ?? 0,
    range: rangeOf(def, item.buff?.range ?? 0),
    primary: item.target.uid ? getUnit(s, item.target.uid) : null,
    hit: null,
    destroyedAt: null,
  };
  for (const e of def.effects) applyEffect(ctx, e);
  return true;
}

// ---------- utilitários ----------

const src = (ctx: Ctx) => championSource(ctx.owner);
const hit = (ctx: Ctx, u: Unit, amount: number, extra: Parameters<typeof dealDamage>[4] = {}) =>
  dealDamage(ctx.s, src(ctx), u, amount, { direct: true, bonus: ctx.bonusDamage, ...extra });

/** Dano em uma casa: unidades, parede e estrutura que estiverem nela. */
function damageWallsAt(s: GameState, cells: Pos[], amount: number): void {
  for (const p of cells) {
    const w = wallAt(s, p);
    if (w) {
      w.hp -= amount;
      if (w.hp <= 0) s.walls = s.walls.filter((x) => x.id !== w.id);
    }
    const st = structureAt(s, p);
    if (st) {
      st.hp -= amount;
      if (st.hp <= 0) s.structures = s.structures.filter((x) => x.id !== st.id);
    }
  }
}

const durationRounds = (e: Effect): number => (e.duration?.value as number) ?? 1;

function pushGround(ctx: Ctx, kind: "fire" | "fire_wall" | "slow", pos: Pos, damage: number, remaining: number): void {
  const { s } = ctx;
  if (!inBounds(pos, s.width, s.height)) return;
  s.ground = s.ground.filter((g) => !(g.kind === kind && samePos(g.pos, pos)));
  s.ground.push({ id: s.nextId++, kind, pos: { ...pos }, damage, remaining, team: ctx.owner.team });
}

function structureBonusHp(owner: ChampionState): number {
  return getChampionDef(owner.defId).passive.effects.filter((e) => e.type === "structure_bonus_hp").reduce((n, e) => n + e.amount, 0);
}

function addWall(ctx: Ctx, pos: Pos, kind: "weak" | "low" | "normal", hp: number, remaining: number | null): boolean {
  const { s } = ctx;
  if (!isFreeCell(s, pos)) return false;
  s.walls.push({ id: s.nextId++, pos: { ...pos }, hp: hp + structureBonusHp(ctx.owner), kind, team: ctx.owner.team, remaining });
  return true;
}

function enemyUnitsInRange(ctx: Ctx, range: number): Unit[] {
  return liveUnits(ctx.s).filter(
    (u) => isEnemyOf(u, ctx.owner.team) && !isUntargetable(u) && inRange(ctx.s, ctx.owner.pos, u.pos, range),
  );
}

/** Aplica um status a uma unidade; controle respeita o limite de 1 por rodada. */
function applyStatusTo(ctx: Ctx, u: Unit, e: Effect): void {
  const dur = e.duration ?? { unit: "rounds", value: 1 };
  if (u.kind !== "champion") {
    // Só a marca vale em monstros e no boss.
    if (e.status === "mark") {
      u.statuses = u.statuses.filter((x) => x.kind !== "mark");
      u.statuses.push({ id: ctx.s.nextId++, kind: "mark", unit: dur.unit, remaining: dur.value, amount: e.bonus_damage, negative: true });
    }
    return;
  }
  if (isUntargetable(u)) return;
  if (e.control && !tryControl(ctx.s, u)) {
    log(ctx.s, `${label(u)} resiste ao controle`);
    return;
  }
  addStatus(ctx.s, u, {
    kind: e.status,
    unit: dur.unit,
    remaining: dur.value,
    amount: e.status === "mark" ? e.bonus_damage : e.amount,
    negative: true,
  });
  log(ctx.s, `${label(u)} recebe ${statusLabel(e.status)} (${durationText(dur.unit, dur.value)})`);
}

function healUnit(ctx: Ctx, target: ChampionState, amount: number): void {
  const healed = heal(target, amount);
  log(ctx.s, `${label(target)} recupera ${healed} de vida`);
  if (target.uid !== ctx.owner.uid) {
    for (const p of getChampionDef(ctx.owner.defId).passive.effects) {
      if (p.type === "self_heal_when_healing_ally") heal(ctx.owner, p.amount);
    }
  }
}

/** Empurra ou puxa uma unidade a partir de `origin`. */
function shove(ctx: Ctx, u: Unit, origin: Pos, dist: number, mode: "push" | "pull", control: boolean): void {
  if (u.kind !== "champion") return;
  if (isUntargetable(u)) return;
  if (control && !tryControl(ctx.s, u)) return;
  const dir = mode === "push" ? directionTo(origin, u.pos) : directionTo(u.pos, origin);
  if (dir.x === 0 && dir.y === 0) return;
  let steps = dist;
  if (mode === "pull") steps = Math.min(dist, Math.max(0, distance(u.pos, origin) - 1));
  if (forcedMove(ctx.s, u, dir, steps) > 0) onLand(ctx.s, u, { voluntary: false });
}

// ---------- efeitos ----------

function applyEffect(ctx: Ctx, e: Effect): void {
  const { s, owner, target } = ctx;
  switch (e.type) {
    // ----- dano -----
    case "damage": {
      if (e.only_if === "target_burning_or_on_burning_ground") {
        if (!ctx.primary || !(isBurning(s, ctx.primary))) {
          log(s, "Combustão falha: o alvo não está em chamas");
          return;
        }
      }
      const opts = { element: e.element as string | undefined };
      if (e.around_self) {
        for (const u of unitsInRadius(s, owner.pos, e.radius)) if (u.uid !== owner.uid) hit(ctx, u, e.amount, opts);
        damageWallsAt(s, cellsInRadius(owner.pos, e.radius, s.width, s.height), e.amount);
        return;
      }
      if (e.random_targets) {
        const cands = enemyUnitsInRange(ctx, ctx.range);
        const chosen = rngOf(s).shuffle(cands).slice(0, e.random_targets);
        for (const u of chosen) hit(ctx, u, e.amount, opts);
        return;
      }
      if (e.per_target) {
        for (const uid of [target.uid, target.uid2]) {
          const u = uid ? getUnit(s, uid) : null;
          if (u) hit(ctx, u, e.amount, opts);
        }
        return;
      }
      if (e.radius !== undefined && target.pos) {
        for (const u of unitsInRadius(s, target.pos, e.radius)) hit(ctx, u, e.amount, opts);
        damageWallsAt(s, cellsInRadius(target.pos, e.radius, s.width, s.height), e.amount);
        return;
      }
      if (ctx.primary) {
        let amount = e.amount;
        let markIncluded = false;
        if (e.total_if_target_has_status && ctx.primary.statuses.some((x) => x.kind === e.total_if_target_has_status.status)) {
          amount = e.total_if_target_has_status.total;
          markIncluded = !!e.total_if_target_has_status.mark_included;
        }
        hit(ctx, ctx.primary, amount, { ...opts, markIncluded });
        return;
      }
      if (target.pos) {
        // Básica em casa (Faísca): atinge quem estiver nela, e paredes.
        const u = liveUnits(s).find((x) => samePos(x.pos, target.pos!) && !isUntargetable(x));
        if (u) hit(ctx, u, e.amount, opts);
        damageWallsAt(s, [target.pos], e.amount);
      }
      return;
    }
    case "damage_second_target": {
      if (!ctx.primary) return;
      const first = ctx.primary;
      const cands = liveUnits(s)
        .filter((u) => u.uid !== first.uid && isEnemyOf(u, owner.team) && !isUntargetable(u) && distance(u.pos, first.pos) <= e.max_distance_from_first)
        .sort((a, b) => distance(a.pos, first.pos) - distance(b.pos, first.pos));
      if (cands[0]) hit(ctx, cands[0], e.amount);
      return;
    }
    case "damage_first_in_path":
      if (ctx.hit) hit(ctx, ctx.hit, e.amount);
      return;
    case "damage_adjacent_to_target":
      if (ctx.destroyedAt) for (const u of unitsInRadius(s, ctx.destroyedAt, 1)) hit(ctx, u, e.amount);
      return;
    case "self_damage":
      dealDamage(s, worldSource, owner, e.amount, { dot: true, noChain: true });
      return;

    // ----- status e controle -----
    case "apply_status":
      if (ctx.primary) applyStatusTo(ctx, ctx.primary, e);
      return;
    case "apply_status_adjacent_enemies":
      for (const u of liveUnits(s)) if (u.kind === "champion" && u.team !== owner.team && isAdjacent(u.pos, owner.pos)) applyStatusTo(ctx, u, { ...e, status: e.status });
      return;
    case "apply_status_area":
      if (target.pos) for (const u of unitsInRadius(s, target.pos, e.radius)) if (isEnemyOf(u, owner.team)) applyStatusTo(ctx, u, e);
      return;
    case "link": {
      const a = target.uid ? getUnit(s, target.uid) : null;
      const b = target.uid2 ? getUnit(s, target.uid2) : null;
      if (a?.kind === "champion" && b?.kind === "champion") {
        addStatus(s, a, { kind: "link", unit: "rounds", remaining: durationRounds(e), partner: b.uid, negative: true });
        addStatus(s, b, { kind: "link", unit: "rounds", remaining: durationRounds(e), partner: a.uid, negative: true });
      }
      return;
    }
    case "remove_negative_effects":
      if (ctx.primary?.kind === "champion") removeNegative(ctx.primary);
      return;
    case "immune_to_control_area":
      if (target.pos) {
        for (const u of unitsInRadius(s, target.pos, e.radius)) {
          if (u.kind === "champion" && u.team === owner.team) addStatus(s, u, { kind: "control_immune", unit: "rounds", remaining: durationRounds(e), negative: false });
        }
      }
      return;

    // ----- cura e escudo -----
    case "heal": {
      if (e.around_self) {
        for (const u of unitsInRadius(s, owner.pos, e.radius)) if (u.kind === "champion" && u.team === owner.team && u.uid !== owner.uid) healUnit(ctx, u, e.amount);
        return;
      }
      if (ctx.primary?.kind === "champion") healUnit(ctx, ctx.primary, e.amount);
      return;
    }
    case "heal_over_time":
      if (ctx.primary?.kind === "champion") addStatus(s, ctx.primary, { kind: "hot", unit: "rounds", remaining: durationRounds(e), amount: e.amount_per_round, negative: false });
      return;
    case "shield":
      if (ctx.primary?.kind === "champion") {
        ctx.primary.shield += e.amount;
        if (e.reflect_damage) ctx.primary.reflect = Math.max(ctx.primary.reflect, e.reflect_damage);
        log(s, `${label(ctx.primary)} ganha ${e.amount} de escudo`);
      }
      return;
    case "resurrect": {
      const dead = target.uid ? getChampion(s, target.uid) : null;
      const team = s.teams[owner.team];
      if (!dead || dead.alive || team.resurrectUsed) return;
      if (resurrect(s, owner, dead)) team.resurrectUsed = true;
      return;
    }

    // ----- posicionamento -----
    case "bonus_move":
      s.turn.movementLeft += e.amount;
      return;
    case "team_mana_if_moved_at_least":
      s.turn.stepBonus = { distance: e.distance, amount: e.amount };
      return;
    case "teleport_to_turn_start": {
      const dest = s.turn.startPositions[owner.uid];
      if (dest && teleport(s, owner, dest)) onLand(s, owner, { voluntary: false });
      return;
    }
    case "move_self_away_from_target": {
      if (!ctx.primary) return;
      const from = ctx.primary.pos;
      const cells = [...reachableMap(s, owner, e.distance, moveOptionsFor(s, owner)).values()];
      cells.sort((a, b) => distance(b.pos, from) - distance(a.pos, from));
      if (cells[0] && distance(cells[0].pos, from) > distance(owner.pos, from)) {
        owner.pos = { ...cells[0].pos };
        onLand(s, owner, { voluntary: false });
      }
      return;
    }
    case "push":
    case "pull":
    case "force_move_toward_self": {
      const mode = e.type === "push" ? "push" : "pull";
      if (e.area_radius !== undefined) {
        for (const u of unitsInRadius(s, owner.pos, e.area_radius)) if (u.uid !== owner.uid) shove(ctx, u, owner.pos, e.distance, "push", false);
        return;
      }
      if (ctx.primary) shove(ctx, ctx.primary, owner.pos, e.distance, mode, !!e.control);
      return;
    }
    case "swap_places": {
      const other = ctx.primary;
      if (other?.kind !== "champion") return;
      const a = { ...owner.pos };
      owner.pos = { ...other.pos };
      other.pos = a;
      onLand(s, owner, { voluntary: false });
      onLand(s, other, { voluntary: false });
      return;
    }
    case "move_target": {
      const ally = ctx.primary;
      if (ally?.kind !== "champion" || !target.pos) return;
      const path = movePath(s, ally, target.pos, e.distance, moveOptionsFor(s, ally));
      if (!path) return;
      ally.pos = { ...target.pos };
      onLand(s, ally, { voluntary: false });
      return;
    }
    case "move_self_with_adjacent_ally": {
      if (!target.pos) return;
      const ally = target.uid2 ? getUnit(s, target.uid2) : null;
      const path = movePath(s, owner, target.pos, e.distance, moveOptionsFor(s, owner));
      if (!path || ally?.kind !== "champion") return;
      owner.pos = { ...target.pos };
      const cell = addPosSafe(owner.pos, (p) => isFreeCell(s, p));
      if (cell) ally.pos = cell;
      onLand(s, owner, { voluntary: false });
      onLand(s, ally, { voluntary: false });
      return;
    }
    case "move_in_line": {
      const dir = target.dir!;
      for (let i = 0; i < e.distance; i++) {
        const next = addPos(owner.pos, dir);
        if (isFreeCell(s, next)) {
          owner.pos = next;
          continue;
        }
        const u = liveUnits(s).find((x) => samePos(x.pos, next));
        if (u && !isUntargetable(u)) ctx.hit = u;
        break;
      }
      onLand(s, owner, { voluntary: false });
      return;
    }
    case "teleport_self":
      if (target.pos && teleport(s, owner, target.pos)) onLand(s, owner, { voluntary: false });
      return;
    case "move_all_allies": {
      for (const ally of s.teams[owner.team].champions) {
        if (!ally.alive) continue;
        const opts = moveOptionsFor(s, ally);
        const cells = [...reachableMap(s, ally, e.distance, opts).values()];
        const wanted = target.moves?.[ally.uid];
        let dest: Pos | null = null;
        if (wanted && cells.some((c) => samePos(c.pos, wanted))) dest = wanted;
        else if (!wanted) {
          // Sem escolha: avança em direção ao boss, se isso ajudar.
          cells.sort((a, b) => distance(a.pos, s.boss.pos) - distance(b.pos, s.boss.pos));
          if (cells[0] && distance(cells[0].pos, s.boss.pos) < distance(ally.pos, s.boss.pos)) dest = cells[0].pos;
        }
        if (dest) {
          ally.pos = { ...dest };
          onLand(s, ally, { voluntary: false });
        }
      }
      return;
    }
    case "phase_this_turn":
      s.turn.phasing = true;
      return;
    case "buff_next_card":
      s.teams[owner.team].nextCardBuff = { range: e.bonus_range, damage: e.bonus_damage };
      return;

    // ----- fogo -----
    case "ground_fire": {
      if (!target.pos) return;
      for (const p of cellsInRadius(target.pos, e.radius, s.width, s.height)) pushGround(ctx, "fire", p, e.damage_per_round, durationRounds(e));
      return;
    }
    case "fire_trail": {
      if (s.turn.main !== owner.uid) return;
      for (const p of s.turn.trail) pushGround(ctx, "fire", p, e.damage_per_round, durationRounds(e));
      return;
    }
    case "fire_wall": {
      if (!target.pos || !target.dir) return;
      let p = target.pos;
      for (let i = 0; i < e.length; i++) {
        if (inBounds(p, s.width, s.height)) pushGround(ctx, "fire_wall", p, e.damage_on_enter, durationRounds(e));
        p = addPos(p, target.dir);
      }
      return;
    }
    case "slow_cell":
      if (target.pos) pushGround(ctx, "slow", target.pos, 0, durationRounds(e));
      return;
    case "watch":
      s.watches.push({ id: s.nextId++, owner: owner.uid, team: owner.team, range: e.trigger_range, damage: e.damage });
      return;

    // ----- construção (Arquiteto) -----
    case "create_wall": {
      if (!target.pos) return;
      const hp = e.kind === "low" ? balance.walls.low_wall_hp : (e.hp ?? balance.walls.normal_wall_hp);
      addWall(ctx, target.pos, e.kind, hp, balance.walls.default_duration_rounds);
      return;
    }
    case "reinforce_wall": {
      const w = target.pos ? wallAt(s, target.pos) : null;
      if (w) {
        w.hp += e.bonus_hp;
        w.remaining = null;
      }
      return;
    }
    case "destroy_wall": {
      if (!target.pos) return;
      s.walls = s.walls.filter((w) => !samePos(w.pos, target.pos!));
      s.structures = s.structures.filter((w) => !samePos(w.pos, target.pos!));
      ctx.destroyedAt = target.pos;
      return;
    }
    case "create_walls_line": {
      if (!target.pos || !target.dir) return;
      let p = target.pos;
      for (let i = 0; i < e.count; i++) {
        addWall(ctx, p, "normal", balance.walls.normal_wall_hp, durationRounds(e));
        p = addPos(p, target.dir);
      }
      return;
    }
    case "create_walls_shape": {
      if (!target.pos || !target.dir) return;
      const cells: Pos[] = [];
      let p = target.pos;
      for (let i = 0; i < 3; i++) {
        cells.push(p);
        p = addPos(p, target.dir);
      }
      const side = rotate90(target.dir);
      let q = addPos(cells[2], side);
      for (let i = 0; i < 2; i++) {
        cells.push(q);
        q = addPos(q, side);
      }
      for (const c of cells) addWall(ctx, c, "normal", balance.walls.normal_wall_hp, durationRounds(e));
      return;
    }
    case "create_walls_around_target": {
      const ally = ctx.primary;
      if (!ally) return;
      for (const d of DIRECTIONS) addWall(ctx, addPos(ally.pos, d), "normal", balance.walls.normal_wall_hp, durationRounds(e));
      return;
    }
    case "hidden_trap":
      if (target.pos && isFreeCell(s, target.pos)) s.traps.push({ id: s.nextId++, pos: { ...target.pos }, damage: e.damage, team: owner.team });
      return;
    case "spring":
      if (target.pos && target.dir && isFreeCell(s, target.pos)) {
        s.springs.push({ id: s.nextId++, pos: { ...target.pos }, dir: target.dir, distance: e.launch_distance, team: owner.team, remaining: balance.walls.spring_duration_rounds });
      }
      return;
    case "create_structure":
      if (target.pos && isFreeCell(s, target.pos)) {
        s.structures.push({ id: s.nextId++, pos: { ...target.pos }, hp: e.hp + structureBonusHp(owner), kind: "watchtower", damage: e.damage_per_round, range: e.range, team: owner.team });
      }
      return;
    case "create_portal_pair":
      if (target.pos && target.pos2 && isFreeCell(s, target.pos) && isFreeCell(s, target.pos2)) {
        s.portals.push({ id: s.nextId++, a: { ...target.pos }, b: { ...target.pos2 }, team: owner.team, remaining: balance.walls.portal_duration_rounds });
      }
      return;

    default:
      throw new Error(`Efeito não implementado: ${e.type}`);
  }
}

export { getCardDef, isAllyOf };
