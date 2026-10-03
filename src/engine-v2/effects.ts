// Execução dos blocos de `effects` das cartas v2 (roster novo) — motor hexagonal.
// Cobre por agora os 5 tipos mais usados em cards_v2.json (damage, apply_status,
// apply_status_area, heal, shield — juntos são ~220 das ~290 ocorrências de
// efeito nas 120 cartas). Os outros ~45 tipos do catálogo em
// claude/formato-dados.md entram em incrementos seguintes (ver KANBAN.md).
//
// Escopo: isto é só "o que o efeito faz" com uma lista de alvos já resolvida —
// "quem é o alvo" (ler o target da carta, alcance, área ao redor de uma casa
// etc.) é uma camada de cima ainda não construída (orquestração de jogar uma
// carta). Então as funções aqui recebem os campeões-alvo já escolhidos.

import { balance, type Effect } from "../engine/data";
import { addHex, hexDirectionTo, hexDistance, hexLine, hexNeighbors, HEX_DIRECTIONS, sameHex, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, logV2, type ChampionStateV2, type GameStateV2 } from "./state";
import { dealDamageV2, type DamageOptsV2 } from "./damage";
import { addStatus, heal, removeNegativeStatuses, removePositiveStatuses, removeStatus, statusAmount } from "./status";
import { forcedMove, pullChampion, pushChampion, teleportChampion } from "./movement";
import { championsInRadius } from "./targeting";
import { wallAtV2 } from "./world";
import { reviveChampionV2 } from "./death";
import { attackBossV2, attackMinionV2 } from "./boss";
import { attackMonsterV2 } from "./monsters";
import { onLandV2 } from "./hazards";

/** Nenhum campeão vivo (de qualquer equipe) na casa. */
function isEmptyOfChampions(game: GameStateV2, h: Hex): boolean {
  return !allChampionsV2(game).some((c) => c.alive && sameHex(c.pos, h));
}

/** Status/efeito de chão sem duração natural — persiste até ser consumido/removido (pilhas de veneno, armadilha, mola). */
export const PERSISTENT_REMAINING = 999;

/** Status cujo nome já é negativo por convenção (ver claude/formato-dados.md). */
const NEGATIVE_STATUS_NAMES = new Set([
  "defense_down",
  "movement_reduced",
  "damage_down",
  "stun",
  "root",
  "taunted",
  "silenced",
]);

function isNegativeStatus(name: string): boolean {
  return NEGATIVE_STATUS_NAMES.has(name);
}

export interface EffectContextV2 {
  game: GameStateV2;
  attacker: ChampionStateV2 | null;
  /** Gera o próximo id único de status, igual a nextId(s) do estado. */
  nextId: () => number;
  /**
   * Destino escolhido pelo jogador pra `move_self`/`teleport_self` quando a
   * carta não restringe a uma direção (target "self" ou "cell") — a escolha
   * em si é feita pela camada de "jogar uma carta", que ainda não existe (ver
   * KANBAN.md); por enquanto quem chama applyEffectV2 passa o destino direto.
   */
  moveDest?: Hex;
  /** Direção escolhida pelo jogador pra `move_self` quando o target é "direction". */
  moveDir?: Hex;
  /**
   * Casa-centro escolhida pelo jogador pra efeitos de alvo "cell" que criam
   * algo no chão (ground_fire, venom_zone) — mesma ideia de moveDest, mas
   * pros efeitos que não movem ninguém. Preenchida por quem chama
   * applyEffectV2 até a camada de "jogar carta" existir de verdade.
   */
  targetCell?: Hex;
  /** Segunda casa escolhida — só usada por `create_portal_pair` (target "two_cells", Portal do Dorin). */
  targetCell2?: Hex;
  /**
   * Caminho (sem a casa de partida) do último `move_self` resolvido nesta
   * carta — só preenchido quando quem chamou passa `ctx.moveDir` (cartas de
   * target "direction"). `damage_all_adjacent_during_move` (Dança das
   * Lâminas da Vextra) lê daqui pra saber por onde o atacante passou.
   */
  lastMovePath?: Hex[];
  /**
   * Alcance resolvido da carta no rank escolhido (com bônus já somados) —
   * só usado por efeitos com `all_enemies_in_range`/`all_poisoned_enemies`
   * (Praga em Massa, Colapso Tóxico etc. do Thorne), que afetam todo mundo
   * dentro do alcance da carta em vez de um alvo escolhido. Preenchida por
   * quem chama applyEffectV2 até a camada de "jogar carta" existir de verdade.
   */
  rangeForAll?: number;
  /**
   * Último campeão atingido por um bloco de dano desta mesma carta — como os
   * blocos de uma carta são executados em sequência sobre o MESMO ctx (não
   * uma cópia), `damage` guarda aqui quem acertou, e `damage_second_target`/
   * `damage_third_target` (Ricochete da Niara) leem daqui pra encadear
   * "o próximo alvo perto do anterior", sem precisar saber de fora quem foi
   * atingido antes.
   */
  lastTarget?: ChampionStateV2 | null;
  /** uids já atingidos pela cadeia de ricochete desta carta (inclui o 1º alvo) — pra `damage_third_target` não voltar a acertar quem o `damage_second_target` já pulou. */
  hitChain?: Set<string>;
  /** Bônus de dano da carta (Passo das Sombras da Vextra, `buff_next_card`) — consumido pela camada de "jogar carta" (src/engine-v2/cardPlay.ts), somado a todo dano desta carta. */
  bonusDamage?: number;
}

/** O mais próximo de `origin` (fora `exclude`) a até `maxDistance` casas, com desempate estável por uid. */
function nearestOtherChampion(
  game: GameStateV2,
  origin: Hex,
  maxDistance: number,
  exclude: Set<string>,
): ChampionStateV2 | null {
  const candidates = allChampionsV2(game).filter((c) => c.alive && !exclude.has(c.uid) && hexDistance(c.pos, origin) <= maxDistance);
  candidates.sort((a, b) => hexDistance(a.pos, origin) - hexDistance(b.pos, origin) || a.uid.localeCompare(b.uid));
  return candidates[0] ?? null;
}

/**
 * Quem está a até `radius` casas de quem usou a carta (área ao redor de si
 * mesmo — Nova de Fogo, Grito de Guerra). [PADRÃO]: não inclui o próprio
 * atacante (o "around_self" é lido como "nos outros ao redor", não em si
 * mesmo) — revisar se o dono do projeto quiser que também se afete.
 */
function resolveAroundSelf(ctx: EffectContextV2, effect: Effect): ChampionStateV2[] {
  if (!ctx.attacker) return [];
  const radius = effect.radius ?? effect.area_radius ?? 0;
  return championsInRadius(ctx.game, ctx.attacker.pos, radius, { excludeUid: ctx.attacker.uid });
}

/**
 * Centro e raio de uma área de `damage`, se o efeito for mesmo uma área:
 * `around_self` (ao redor de quem usou a carta) ou `radius` com uma casa
 * escolhida pelo jogador (`ctx.targetCell`, cartas de alvo "cell" como Bola
 * de Fogo/Chuva de Aço/Golpe do Fim do Mundo). Devolve null pra dano de alvo
 * único (sem radius nem around_self) — não é área, não deve acertar boss/
 * monstro/lacaio por aqui (isso já é resolvido em cardPlay.ts pro alvo único).
 */
function resolveDamageAreaV2(ctx: EffectContextV2, effect: Effect): { origin: Hex; radius: number } | null {
  const radius = effect.radius ?? effect.area_radius;
  if (radius === undefined) return null;
  if (effect.around_self) return ctx.attacker ? { origin: ctx.attacker.pos, radius } : null;
  if (ctx.targetCell) return { origin: ctx.targetCell, radius };
  return null;
}

/**
 * Dano de área também acerta o boss e os monstros/lacaios do mapa dentro do
 * raio, não só campeões (achado de escopo, 02/10/2026 — KANBAN "dano em área/
 * aleatório contra boss e monstro"). Usa as mesmas funções dedicadas de
 * cardPlay.ts (attackBossV2/attackMonsterV2/attackMinionV2) em vez do
 * pipeline genérico de dano entre campeões — mesma convenção do resto do
 * motor v2 (boss/monstro/lacaio nunca passam por dealDamageV2 direto).
 * attackMonsterV2 já dispara a reação da criatura antes do dano, igual a um
 * ataque de alvo único — a área não é tratada como exceção a essa regra.
 */
function hitBossMonstersAndMinionsInAreaV2(ctx: EffectContextV2, area: { origin: Hex; radius: number }, effect: Effect): void {
  if (!ctx.attacker) return;
  const amount = (effect.amount ?? 0) + (ctx.bonusDamage ?? 0);
  const opts = { ignoreDefense: effect.ignore_defense };
  if (ctx.game.boss.alive && hexDistance(area.origin, ctx.game.boss.pos) <= area.radius) {
    attackBossV2(ctx.game, ctx.attacker, amount, opts);
  }
  for (const m of ctx.game.monsters) {
    if (m.alive && hexDistance(area.origin, m.pos) <= area.radius) attackMonsterV2(ctx.game, ctx.attacker, m, amount, opts);
  }
  for (const m of ctx.game.minions) {
    if (m.alive && hexDistance(area.origin, m.pos) <= area.radius) attackMinionV2(ctx.game, ctx.attacker, m.uid, amount);
  }
}

/** Todo inimigo vivo a até `ctx.rangeForAll` casas de quem usou a carta. */
function resolveAllEnemiesInRange(ctx: EffectContextV2): ChampionStateV2[] {
  if (!ctx.attacker || ctx.rangeForAll === undefined) return [];
  return championsInRadius(ctx.game, ctx.attacker.pos, ctx.rangeForAll, { excludeUid: ctx.attacker.uid }).filter(
    (c) => c.team !== ctx.attacker!.team,
  );
}

/** Todo inimigo vivo e COM pilhas de veneno a até `ctx.rangeForAll` casas de quem usou a carta. */
function resolveAllPoisonedEnemiesInRange(ctx: EffectContextV2): ChampionStateV2[] {
  return resolveAllEnemiesInRange(ctx).filter((c) => statusAmount(c, "venom_stacks") > 0);
}

/**
 * `damage`: causa dano a cada alvo. Devolve o resultado por alvo (uid -> dano
 * final). Com `around_self` (Nova de Fogo, Golpe do Titã), ignora `targets` e
 * acerta todo mundo (aliado incluso — fogo amigo existe) ao redor de quem usou
 * a carta, raio `effect.radius`. Com `radius` e uma casa escolhida pelo
 * jogador (`ctx.targetCell`, cartas de alvo "cell" como Bola de Fogo/Chuva de
 * Aço/Golpe do Fim do Mundo — achado corrigido 02/10/2026), idem mas ao redor
 * dessa casa, não de quem usou a carta: antes disso `targets` (sempre
 * `[owner]` pra alvo "cell", ver cardPlay.ts) acabava sendo o único acertado,
 * ignorando a área de verdade. Em qualquer um dos dois casos, boss/monstros/
 * lacaios do mapa dentro do raio também sofrem o dano (hitBossMonstersAndMinionsInAreaV2).
 */
export function applyDamage(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const opts: DamageOptsV2 = {
    ignoreDefense: effect.ignore_defense,
    ignoreShield: effect.ignore_shield,
    bonus: ctx.bonusDamage,
  };
  const area = resolveDamageAreaV2(ctx, effect);
  const actualTargets = effect.around_self
    ? resolveAroundSelf(ctx, effect)
    : area
      ? championsInRadius(ctx.game, area.origin, area.radius)
      : targets;
  if (area) hitBossMonstersAndMinionsInAreaV2(ctx, area, effect);
  const out: Record<string, number> = {};
  for (const target of actualTargets) {
    const result = dealDamageV2(ctx.attacker, target, effect.amount ?? 0, opts);
    out[target.uid] = result.final;
    // Devolve o reflexo (escudo com reflect_amount/reflect_absorbed_damage) a
    // quem causou o dano — um nível só, sem repropagar um novo reflexo.
    if (result.reflectToAttacker > 0 && ctx.attacker) {
      dealDamageV2(null, ctx.attacker, result.reflectToAttacker, { ignoreDefense: true, ignoreShield: true });
    }
  }
  if (actualTargets.length > 0) {
    ctx.lastTarget = actualTargets[actualTargets.length - 1];
    ctx.hitChain = new Set([...(ctx.hitChain ?? []), ...actualTargets.map((t) => t.uid)]);
  }
  return out;
}

/** `self_damage`: o próprio dono da carta perde vida (custo do efeito, ignora defesa/escudo). */
export function applySelfDamage(ctx: EffectContextV2, effect: Effect): number {
  if (!ctx.attacker) return 0;
  return dealDamageV2(null, ctx.attacker, effect.amount ?? 0, { ignoreDefense: true, ignoreShield: true }).final;
}

function durationFromEffect(effect: Effect): { unit: "rounds" | "champion_turns"; value: number } {
  if (effect.duration) return effect.duration;
  return { unit: "rounds", value: 1 };
}

/** `apply_status` / `apply_status_area`: aplica o mesmo status num ou mais alvos (propaga ao Elo de controle, se o alvo tiver um e o status for de controle — ver propagateLinkedControl). O status "mark" (Marca do Predador da Niara) usa `bonus_damage` em vez de `amount` nos dados — aceito como alternativa. */
export function applyStatus(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  const negative = isNegativeStatus(effect.status);
  for (const target of targets) {
    addStatus(target, ctx.nextId(), effect.status, duration.unit, duration.value, {
      amount: effect.amount ?? effect.bonus_damage,
      negative,
    });
    propagateLinkedControl(ctx, target, effect.status, duration);
  }
}

/**
 * `jump_to_nearest_enemy_on_target_death` (Marca do Predador ★★★ da Niara):
 * marca o status "mark" que a MESMA carta aplicou no(s) mesmo(s) alvo(s) (já
 * resolvido antes deste bloco, já que os efeitos de um rank rodam em
 * sequência sobre os mesmos alvos — ver cardPlay.ts) com `jumpOnDeath: true`.
 * A consequência de verdade (achar o inimigo mais próximo e mover o status
 * pra ele) mora em death.ts (killChampionV2), no momento em que o campeão
 * marcado morre de fato.
 */
export function applyJumpToNearestEnemyOnTargetDeath(targets: ChampionStateV2[]): void {
  for (const target of targets) {
    const mark = target.statuses.find((s) => s.status === "mark");
    if (mark) mark.jumpOnDeath = true;
  }
}

/**
 * `link_buff` (Pacto Arcano da Aurelia): aplica o MESMO status/buff tanto em
 * quem usou a carta quanto no aliado escolhido, de uma vez — diferente de
 * `link` (applyLink), não cria um vínculo persistente que propaga depois;
 * os dois lados só recebem o buff na hora, cada um com sua própria duração
 * independente (perder o buff de um lado não afeta o outro).
 */
export function applyLinkBuff(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  const duration = durationFromEffect(effect);
  const recipients = [ctx.attacker, ...targets];
  for (const recipient of recipients) {
    addStatus(recipient, ctx.nextId(), effect.status, duration.unit, duration.value, {
      amount: effect.amount,
      negative: isNegativeStatus(effect.status),
    });
  }
}

/** `apply_status_around_self`: aplica o status em todo mundo ao redor de quem usou a carta (Grito de Guerra). */
export function applyStatusAroundSelf(ctx: EffectContextV2, effect: Effect): void {
  applyStatus(ctx, effect, resolveAroundSelf(ctx, effect));
}

/**
 * Propaga uma fração da cura recebida ao parceiro de Elo de cura (Corrente de
 * Vida da Selene), se houver. Não repropaga a partir do parceiro — evita
 * ida-e-volta infinita entre os dois lados do vínculo.
 */
function propagateLinkedHeal(ctx: EffectContextV2, source: ChampionStateV2, healAmount: number): void {
  if (healAmount <= 0) return;
  const link = source.statuses.find((s) => s.status === "link_heal" && s.partner);
  if (!link || link.amount === undefined) return;
  const partner = allChampionsV2(ctx.game).find((c) => c.uid === link.partner);
  if (!partner || !partner.alive) return;
  const shared = Math.round((healAmount * link.amount) / 100);
  if (shared > 0) heal(partner, shared);
}

/** `heal`: cura, sem passar do hp máximo. Devolve a cura efetiva por alvo (propaga ao Elo de cura, se houver). */
export function applyHeal(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const target of targets) {
    if (!target.alive) {
      out[target.uid] = 0;
      continue;
    }
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + (effect.amount ?? 0));
    const healed = target.hp - before;
    out[target.uid] = healed;
    propagateLinkedHeal(ctx, target, healed);
  }
  return out;
}

/** `heal_over_time`: cura por rodada, resolvida de verdade pelo tick (tick.ts). */
export function applyHealOverTime(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) {
    addStatus(target, ctx.nextId(), "heal_over_time", duration.unit, duration.value, { amount: effect.amount });
  }
}

/** `shield`: soma escudo (não substitui) e define o reflexo, se houver. */
export function applyShield(effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    target.shield += effect.amount ?? 0;
    if (effect.reflect_amount !== undefined) target.reflect = effect.reflect_amount;
  }
}

/** `remove_negative_effects` / `remove_negative_effects_all_allies`. */
export function applyRemoveNegativeEffects(effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    removeNegativeStatuses(target, { all: effect.all, amount: effect.amount });
  }
}

/** `remove_positive_effects`: o inverso, usado pela Aurelia (Dissonância). */
export function applyRemovePositiveEffects(effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    removePositiveStatuses(target, { all: effect.all, amount: effect.amount });
  }
}

/** `grant_personal_mana` / `drain_personal_mana` (mana pessoal, não a de equipe). */
export function applyPersonalMana(effect: Effect, targets: ChampionStateV2[], sign: 1 | -1): void {
  for (const target of targets) {
    target.personalMana = Math.max(0, target.personalMana + sign * (effect.amount ?? 0));
  }
}

/** `push`: afasta cada alvo do atacante (ou de quem usou a carta) por `distance` casas (dispara efeitos de casa na chegada — ver hazards.ts). */
export function applyPush(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  const actualTargets = effect.area_radius !== undefined ? resolveAroundSelf(ctx, effect) : targets;
  for (const target of actualTargets) {
    const from = { ...target.pos };
    pushChampion(ctx.game, target, ctx.attacker.pos, effect.distance ?? 0);
    onLandV2(ctx.game, target, { voluntary: false, from });
  }
}

/** `pull`: aproxima cada alvo de quem usou a carta por `distance` casas (dispara efeitos de casa na chegada — ver hazards.ts). */
export function applyPull(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  for (const target of targets) {
    const from = { ...target.pos };
    pullChampion(ctx.game, target, ctx.attacker.pos, effect.distance ?? 0);
    onLandV2(ctx.game, target, { voluntary: false, from });
  }
}

/**
 * `move_self`: reposicionamento instantâneo do próprio dono. Com `ctx.moveDir`
 * (cartas de target "direction", ex. Dança das Lâminas da Vextra), avança em
 * linha naquela direção, parando antes de obstáculo. Com `ctx.moveDest`
 * (target "self", ex. Recuo Calculado da Niara), salta pra qualquer casa
 * livre a até `effect.distance` de distância. Dispara efeitos de casa na
 * chegada (ver hazards.ts) como qualquer outro deslocamento forçado.
 */
export function applyMoveSelf(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    const from = { ...target.pos };
    if (ctx.moveDir) forcedMove(ctx.game, target, ctx.moveDir, effect.distance ?? 0);
    else if (ctx.moveDest) safeTeleport(ctx.game, target, ctx.moveDest, effect.distance ?? 0);
    // Caminho percorrido nesta chamada — só faz sentido pra moveDir (linha
    // reta); damage_all_adjacent_during_move (Dança das Lâminas da Vextra)
    // lê isso a seguir, no mesmo ctx (ver DISPATCH, efeitos da mesma carta
    // rodam em sequência sobre o mesmo contexto).
    if (ctx.moveDir && !sameHex(from, target.pos)) ctx.lastMovePath = hexLine(from, target.pos);
    onLandV2(ctx.game, target, { voluntary: false, from });
  }
}

/** `teleport_self`: salta pra uma casa escolhida (target "cell"), já validada em alcance por quem chamou (dispara efeitos de casa na chegada — ver hazards.ts). */
export function applyTeleportSelf(ctx: EffectContextV2, _effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.moveDest) return;
  for (const target of targets) {
    const from = { ...target.pos };
    safeTeleport(ctx.game, target, ctx.moveDest, Infinity);
    onLandV2(ctx.game, target, { voluntary: false, from });
  }
}

/**
 * teleportChampion lança erro se a casa não estiver livre — correto como regra geral
 * (movimento forçado por terceiros não deveria silenciosamente ir pro lugar errado),
 * mas aqui o próprio jogador ESCOLHEU a casa ao jogar a carta (target "cell"), e
 * validateTargetV2 só confere alcance, não se a casa está livre (ela pode valer pra
 * outros efeitos de "cell" que não se importam, como parede/chão) — então a casa pode
 * ter deixado de estar livre entre a escolha e a resolução (outro campeão se moveu lá,
 * ou simplesmente a validação nunca checou). Nesse caso o salto apenas falha (carta
 * consumida sem efeito) em vez de travar a partida inteira. [PADRÃO, achado ao ligar
 * os bots v2 — mover a checagem de "livre" pra validateTargetV2 seria mais correto,
 * mas exigiria saber, só pelo tipo de target "cell", se o efeito por trás exige
 * destino livre ou não; fica pra quando isso for revisto.]
 */
function safeTeleport(s: GameStateV2, target: ChampionStateV2, dest: Hex, maxDistance: number): void {
  try {
    teleportChampion(s, target, dest, maxDistance);
  } catch {
    logV2(s, `${target.defId} (${target.team}) não consegue saltar pra (${dest.q},${dest.r}) — destino inválido`);
  }
}

/** `apply_venom_stacks`: acumula pilhas de veneno no alvo, até `max_stacks`. */
export function applyVenomStacks(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const gain = effect.amount ?? 1;
  const max = effect.max_stacks ?? Infinity;
  let actualTargets = targets;
  if (effect.all_enemies_in_range) actualTargets = resolveAllEnemiesInRange(ctx);
  else if (effect.radius !== undefined && ctx.targetCell) actualTargets = championsInRadius(ctx.game, ctx.targetCell, effect.radius);
  for (const target of actualTargets) {
    const current = statusAmount(target, "venom_stacks");
    if (current > 0) removeStatus(target, "venom_stacks");
    const next = Math.min(max, current + gain);
    addStatus(target, ctx.nextId(), "venom_stacks", "rounds", PERSISTENT_REMAINING, { amount: next, negative: true });
  }
}

/** `detonate_venom_stacks`: consome as pilhas do alvo, causando dano proporcional. */
export function applyDetonateVenomStacks(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  const actualTargets = effect.all_poisoned_enemies ? resolveAllPoisonedEnemiesInRange(ctx) : targets;
  const out: Record<string, number> = {};
  for (const target of actualTargets) {
    const stacks = statusAmount(target, "venom_stacks");
    removeStatus(target, "venom_stacks");
    out[target.uid] = stacks > 0 ? dealDamageV2(ctx.attacker, target, stacks * (effect.damage_per_stack ?? 0)).final : 0;
  }
  return out;
}

/**
 * `link`: cria o vínculo (Elo) entre dois campeões. Guardado como status
 * "link_heal" (Corrente de Vida da Selene — propaga cura, ver
 * propagateLinkedHeal) ou "link_control" (Elo Natural da Sylvane — propaga
 * controle, ver propagateLinkedControl), conforme qual `share_*_percent` a
 * carta trouxer.
 *
 * **Ambiguidade de alvo resolvida (02/10/2026) [PADRÃO]:** no texto original,
 * a Corrente de Vida da Selene liga QUEM USOU A CARTA a um aliado (`target:
 * "ally"`, 1 alvo só) — esse caso (`link_heal`) continua ligando
 * `ctx.attacker` a cada alvo recebido, como sempre foi. Já o Elo Natural da
 * Sylvane liga dois INIMIGOS entre si ("compartilha entre inimigos"), sem
 * envolver a própria Sylvane — igual ao "Elo" do MVP original
 * (src/engine/effects.ts, mesmo nome de carta/target "two_enemies"). Pra
 * cobrir isso, `sylvane_elo_natural` passou a ter `target: "two_enemies"`
 * (targeting.ts/cardPlay.ts, novo), e aqui `link_control` ignora
 * `ctx.attacker` e liga os DOIS alvos resolvidos entre si (`targets[0]` com
 * `targets[1]`) — exige exatamente 2 alvos, garantido por quem resolve
 * "two_enemies".
 */
export function applyLink(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  const kind = effect.share_heal_percent !== undefined ? "link_heal" : "link_control";
  const amount = effect.share_heal_percent ?? effect.share_control_percent ?? effect.amount;
  if (kind === "link_control") {
    const [a, b] = targets;
    if (!a || !b) return;
    addStatus(a, ctx.nextId(), kind, duration.unit, duration.value, { amount, partner: b.uid });
    addStatus(b, ctx.nextId(), kind, duration.unit, duration.value, { amount, partner: a.uid });
    return;
  }
  if (!ctx.attacker) return;
  for (const target of targets) {
    addStatus(ctx.attacker, ctx.nextId(), kind, duration.unit, duration.value, { amount, partner: target.uid });
    addStatus(target, ctx.nextId(), kind, duration.unit, duration.value, { amount, partner: ctx.attacker.uid });
  }
}

/** uid do parceiro de Elo ativo (cura ou controle) de um campeão, se houver. */
export function linkedPartnerOf(c: ChampionStateV2): string | null {
  return c.statuses.find((s) => s.status === "link_heal" || s.status === "link_control")?.partner ?? null;
}

/** Nomes de status que contam como "controle" pra propagação do Elo Natural — mesma lista de regras-e-decisoes.md §8 (imobilizado/silenciado/atordoado/lentidão) + provocado (Varek), que também impõe uma restrição de ação. */
const CONTROL_STATUS_NAMES = new Set(["stun", "root", "silenced", "movement_reduced", "taunted"]);

/**
 * Propaga um status de CONTROLE (não dano/cura) ao parceiro de Elo de
 * controle (Elo Natural da Sylvane), se houver, com a duração reduzida pela
 * porcentagem do vínculo (`share_control_percent` — 50%/75%, arredondado,
 * mínimo 1). Não repropaga a partir do parceiro (mesma convenção de
 * propagateLinkedHeal) — evita ida-e-volta infinita entre os dois lados.
 */
function propagateLinkedControl(ctx: EffectContextV2, source: ChampionStateV2, status: string, duration: { unit: "rounds" | "champion_turns"; value: number }): void {
  if (!CONTROL_STATUS_NAMES.has(status)) return;
  const link = source.statuses.find((s) => s.status === "link_control" && s.partner);
  if (!link || link.amount === undefined) return;
  const partner = allChampionsV2(ctx.game).find((c) => c.uid === link.partner);
  if (!partner || !partner.alive) return;
  const sharedValue = Math.max(1, Math.round((duration.value * link.amount) / 100));
  addStatus(partner, ctx.nextId(), status, duration.unit, sharedValue, { negative: true });
}

/**
 * `ground_fire`: cria (ou renova, se já houver uma no mesmo centro e dono)
 * uma área de fogo em `ctx.targetCell`, que causa `damage_per_round` por
 * rodada a quem estiver dentro (resolvido no tick, ver tick.ts).
 */
export function applyGroundFire(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground = ctx.game.ground.filter((g) => !(g.kind === "fire" && sameHex(g.pos, ctx.targetCell!)));
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "fire",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
    damagePerRound: effect.damage_per_round,
  });
}

/**
 * `venom_zone`: cria uma área que aplica `stacks_per_round` pilhas de veneno
 * por rodada a quem estiver dentro (resolvido no tick, ver tick.ts).
 */
export function applyVenomZone(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground = ctx.game.ground.filter((g) => !(g.kind === "venom" && sameHex(g.pos, ctx.targetCell!)));
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "venom",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
    stacksPerRound: effect.stacks_per_round,
  });
}

/**
 * `hidden_trap` (Armadilha do Dorin): cria uma armadilha de 1 disparo na
 * casa escolhida — dano na hora + penalidade de movimento (★★★) a quem
 * terminar o movimento ali. Some ao disparar (ver hazards.ts/onLandV2), sem
 * duração natural (`PERSISTENT_REMAINING`, como pilhas de veneno).
 */
export function applyHiddenTrap(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "trap",
    pos: { ...ctx.targetCell },
    radius: 0,
    team: ctx.attacker.team,
    remaining: PERSISTENT_REMAINING,
    damageOnEnter: effect.damage,
    slowAmount: effect.slow_amount,
  });
}

/**
 * `spring` (Mola do Dorin): cria uma mola na casa escolhida — lança quem
 * terminar o movimento ali por `distance` casas na direção de quem veio (ver
 * hazards.ts/onLandV2). Também sem duração natural, até ser disparada
 * (diferente do MVP, que guarda a mola numa lista própria — aqui reaproveita
 * `game.ground`, mais simples por não precisar de outro array/tipo de estado).
 */
export function applySpring(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "spring",
    pos: { ...ctx.targetCell },
    radius: 0,
    team: ctx.attacker.team,
    remaining: PERSISTENT_REMAINING,
    distance: effect.distance,
  });
}

/**
 * `fire_wall` (Muro de Chamas da Ignira): linha de `length` casas na direção
 * escolhida (`ctx.moveDir`, target "direction"), cada uma causando
 * `damage_on_enter` a quem terminar o movimento nela (não por rodada — ver
 * hazards.ts/onLandV2), durando `duration` rodadas. Para ao sair do tabuleiro
 * ou bater numa parede (mesma regra de `forcedMove`/linha, mas aqui é
 * geometria de criação, não movimento — usa `hexNeighbors` em sequência na
 * direção dada).
 */
export function applyFireWall(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.moveDir) return;
  const duration = durationFromEffect(effect);
  const length = effect.length ?? 1;
  let pos = ctx.attacker.pos;
  for (let i = 0; i < length; i++) {
    pos = addHex(pos, ctx.moveDir);
    if (!inHexBoard(pos, ctx.game.board) || wallAtV2(ctx.game, pos)) break;
    ctx.game.ground.push({
      id: ctx.nextId(),
      kind: "fire_wall",
      pos: { ...pos },
      radius: 0,
      team: ctx.attacker.team,
      remaining: duration.value,
      damageOnEnter: effect.damage_on_enter,
    });
  }
}

/**
 * `venom_terrain` (Fossa de Ácido do Thorne): área persistente que aplica
 * `stacks_on_enter` pilhas de veneno a quem termina o movimento dentro
 * (diferente de `venom_zone`, que aplica por RODADA a quem está dentro, não
 * só ao entrar — ver hazards.ts/onLandV2).
 */
export function applyVenomTerrain(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "venom_terrain",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
    stacksOnEnter: effect.stacks_on_enter,
  });
}

/**
 * `mark_ground_area` (Chuva de Aço ★★★ da Niara): marca a área onde a carta
 * explodiu — quem entrar nela enquanto durar sofre `retrigger_damage_fraction`
 * do dano original de novo (ver hazards.ts/onLandV2). `ctx.bonusDamage` já
 * foi somado ao dano original antes de chegar aqui (mesma ordem de
 * `applyDamage`), então o valor guardado já reflete qualquer buff da carta.
 */
export function applyMarkGroundArea(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "mark",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
    retriggerFraction: effect.retrigger_damage_fraction,
    storedDamage: (effect.amount ?? 0) + (ctx.bonusDamage ?? 0),
  });
}

/**
 * `detonate_nearby_ground_fire` (Combustão Total ★★★ da Ignira): detona a
 * área de `ground_fire` mais próxima do alvo (dentro do próprio raio dela),
 * aplicando de uma vez o dano de TODAS as rodadas restantes (`damagePerRound
 * * remaining`) a quem estiver dentro agora, e remove a área — "detona
 * antecipadamente", ela não volta a causar dano depois disso.
 */
export function applyDetonateNearbyGroundFire(ctx: EffectContextV2, _effect: Effect, targets: ChampionStateV2[]): void {
  const target = targets[0];
  if (!target) return;
  const fires = ctx.game.ground
    .filter((g) => g.kind === "fire" && hexDistance(g.pos, target.pos) <= g.radius)
    .sort((a, b) => hexDistance(a.pos, target.pos) - hexDistance(b.pos, target.pos));
  const fire = fires[0];
  if (!fire) return;
  const totalDamage = (fire.damagePerRound ?? 0) * fire.remaining;
  if (totalDamage > 0) {
    for (const c of allChampionsV2(ctx.game).filter((c) => c.alive && hexDistance(c.pos, fire.pos) <= fire.radius)) {
      dealDamageV2(ctx.attacker, c, totalDamage, { dot: true });
    }
  }
  ctx.game.ground = ctx.game.ground.filter((g) => g.id !== fire.id);
}

/**
 * `fire_trail` (Rastro de Fogo ★ a ★★★ da Ignira, "ao se mover", carta
 * rápida): não deixa fogo na hora — guarda um status no próprio dono que o
 * PRÓXIMO movimento voluntário dele consome, deixando fogo em cada casa do
 * caminho (ver turn.ts, caso "move"). [PADRÃO]: um "próximo movimento" por
 * uso, consumido mesmo que ele não ande nada neste turno (sem prazo de
 * validade além disso — revisar se o dono do projeto quiser uma validade).
 */
export function applyFireTrail(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) {
    addStatus(target, ctx.nextId(), "fire_trail_active", "rounds", PERSISTENT_REMAINING, {
      amount: effect.damage_per_round,
      trailDurationRounds: duration.value,
      trailInstantBonus: effect.instant_bonus_on_enter,
      negative: false,
    });
  }
}

/**
 * `delayed_damage` (Explosão Retardada ★ a ★★★ da Ignira): marca a casa do
 * alvo escolhido na hora (não o segue se ele se mover) e explode sozinha
 * `delay_rounds` rodadas depois, acertando quem estiver na área nesse
 * momento (ver tick.ts) — inclusive quem marcou, se ficar perto.
 */
export function applyDelayedDamage(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker) return;
  const target = targets[0];
  if (!target) return;
  ctx.game.delayedDamages.push({
    id: ctx.nextId(),
    pos: { ...target.pos },
    radius: effect.radius ?? 0,
    amount: effect.amount ?? 0,
    team: ctx.attacker.team,
    roundsLeft: effect.delay_rounds ?? 1,
  });
}

/**
 * `damage_all_adjacent_during_move` (Dança das Lâminas ★★/★★★ da Vextra):
 * dano a todo inimigo que ficou adjacente a QUALQUER casa do caminho
 * percorrido pelo `move_self` desta mesma carta (`ctx.lastMovePath`, ver
 * applyMoveSelf acima — os dois efeitos rodam em sequência sobre o mesmo
 * ctx). Cada inimigo é atingido só 1x mesmo perto de vários passos.
 */
export function applyDamageAllAdjacentDuringMove(ctx: EffectContextV2, effect: Effect): Record<string, number> {
  if (!ctx.attacker || !ctx.lastMovePath) return {};
  const hitUids = new Set<string>();
  for (const step of ctx.lastMovePath) {
    for (const h of hexNeighbors(step)) {
      const hit = allChampionsV2(ctx.game).find((c) => c.alive && c.team !== ctx.attacker!.team && !hitUids.has(c.uid) && sameHex(c.pos, h));
      if (hit) hitUids.add(hit.uid);
    }
  }
  const out: Record<string, number> = {};
  for (const uid of hitUids) {
    const c = allChampionsV2(ctx.game).find((x) => x.uid === uid)!;
    out[uid] = dealDamageV2(ctx.attacker, c, effect.amount ?? 0, { bonus: ctx.bonusDamage }).final;
  }
  return out;
}

/** `create_structure` (Torre de Vigia do Dorin): estrutura em `ctx.targetCell` que causa dano por rodada a inimigos dentro de `range` (resolvido em tick.ts). */
export function applyCreateStructure(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  if (!isEmptyOfChampions(ctx.game, ctx.targetCell) || wallAtV2(ctx.game, ctx.targetCell)) return;
  const duration = effect.duration ? durationFromEffect(effect).value : null;
  ctx.game.structures.push({
    id: ctx.nextId(),
    pos: { ...ctx.targetCell },
    hp: effect.hp ?? 1,
    team: ctx.attacker.team,
    damagePerRound: effect.damage_per_round ?? 0,
    range: effect.range ?? 0,
    remaining: duration,
  });
}

/** Cria uma parede, sem duplicar se já houver uma ali (mesma regra de applyCreateWall). */
function pushWallIfFree(ctx: EffectContextV2, pos: Hex, hp: number, duration: number): void {
  if (!ctx.attacker || wallAtV2(ctx.game, pos)) return;
  ctx.game.walls.push({ id: ctx.nextId(), pos: { ...pos }, hp, team: ctx.attacker.team, remaining: duration });
}

/** `create_walls_line` (Muralha do Dorin, target "line"): `count` paredes em fila a partir de `ctx.targetCell`, na direção de quem usou a carta até lá. */
export function applyCreateWallsLine(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell || !ctx.moveDir) return;
  const duration = durationFromEffect(effect).value;
  let pos = { ...ctx.targetCell };
  for (let i = 0; i < (effect.count ?? 1); i++) {
    if (!inHexBoard(pos, ctx.game.board)) break;
    pushWallIfFree(ctx, pos, effect.hp ?? balance.walls.normal_wall_hp, duration);
    pos = addHex(pos, ctx.moveDir);
  }
}

/** Direção vizinha a `dir` girando `steps` posições no hexágono (60° por passo) — ver HEX_DIRECTIONS. */
function rotateHexDir(dir: Hex, steps: number): Hex {
  const i = HEX_DIRECTIONS.findIndex((d) => d.q === dir.q && d.r === dir.r);
  if (i < 0) return dir;
  return HEX_DIRECTIONS[(i + steps + HEX_DIRECTIONS.length * 2) % HEX_DIRECTIONS.length];
}

/**
 * `create_walls_shape` (Barricada ★★/★★★ do Dorin, target "cell"): uma
 * "cunha" de paredes a partir de `ctx.targetCell` — 3 em linha na direção de
 * quem usou a carta até lá, e o resto virando 60° a partir da última.
 * [PADRÃO]: a carta não guarda direção nos dados (ao contrário do MVP
 * original, que usava `target.dir` num grid quadrado) — aqui ela é
 * derivada de quem usou a carta até a casa escolhida, igual ao target "line".
 */
export function applyCreateWallsShape(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const dir = ctx.moveDir ?? hexDirectionTo(ctx.attacker.pos, ctx.targetCell);
  if (dir.q === 0 && dir.r === 0) return;
  const duration = durationFromEffect(effect).value;
  const hp = effect.hp ?? balance.walls.normal_wall_hp;
  const count = effect.count ?? 1;
  const cells: Hex[] = [];
  let pos = { ...ctx.targetCell };
  for (let i = 0; i < Math.min(3, count); i++) {
    cells.push(pos);
    pos = addHex(pos, dir);
  }
  if (count > 3) {
    const side = rotateHexDir(dir, 2);
    let sidePos = addHex(cells[cells.length - 1], side);
    for (let i = 3; i < count; i++) {
      cells.push(sidePos);
      sidePos = addHex(sidePos, side);
    }
  }
  for (const c of cells) if (inHexBoard(c, ctx.game.board)) pushWallIfFree(ctx, c, hp, duration);
}

/**
 * `create_walls_around_target` (Bastião Impenetrável ★★★ do Dorin, target
 * "cell"): cerca a área escolhida com `count` paredes. [PADRÃO]: hexágono só
 * tem 6 vizinhos de verdade (contra os 8 do grid quadrado do MVP original),
 * então o anel 1 completo (6) é preenchido primeiro e o que faltar (`count`
 * acima de 6) vem do anel 2, em ordem fixa — revisar se o dono do projeto
 * quiser outra geometria.
 */
export function applyCreateWallsAroundTarget(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect).value;
  const hp = effect.hp ?? balance.walls.normal_wall_hp;
  const count = effect.count ?? 6;
  const ring1 = hexNeighbors(ctx.targetCell);
  const ring2 = ring1.flatMap((h) => hexNeighbors(h)).filter((h) => !sameHex(h, ctx.targetCell!) && !ring1.some((r) => sameHex(r, h)));
  const uniqueRing2: Hex[] = [];
  for (const h of ring2) if (!uniqueRing2.some((u) => sameHex(u, h))) uniqueRing2.push(h);
  const cells = [...ring1, ...uniqueRing2].slice(0, count);
  for (const c of cells) if (inHexBoard(c, ctx.game.board)) pushWallIfFree(ctx, c, hp, duration);
}

/** `create_portal_pair` (Portal do Dorin, target "two_cells"): duas casas ligadas — entrar numa teleporta pra outra (ver hazards.ts/onLandV2). */
export function applyCreatePortalPair(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell || !ctx.targetCell2) return;
  const duration = effect.lasts_until_destroyed ? null : (balance.walls.default_duration_rounds ?? 3);
  ctx.game.portals.push({
    id: ctx.nextId(),
    a: { ...ctx.targetCell },
    b: { ...ctx.targetCell2 },
    team: ctx.attacker.team,
    remaining: duration,
  });
}

/** `slow_cell` (Teia da Sylvane): área que custa o dobro de movimento pra atravessar (ver movement.ts). */
export function applySlowCell(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  const duration = durationFromEffect(effect);
  ctx.game.ground.push({
    id: ctx.nextId(),
    kind: "slow",
    pos: { ...ctx.targetCell },
    radius: effect.radius ?? 0,
    team: ctx.attacker.team,
    remaining: duration.value,
  });
}

/** `reflect_absorbed_damage`: enquanto tiver escudo, reflete `percent`% do dano absorvido (Vingança do Escudo). */
export function applyReflectAbsorbedDamage(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  ctx.attacker.reflectPercent = effect.percent ?? 0;
}

/**
 * `extend_existing_control`: estende a duração de todo controle (status
 * negativo) já ativo no alvo, na mesma unidade do `duration` da carta — não
 * aplica controle novo por si (Marca da Natureza da Sylvane). Sem controle
 * ativo, não faz nada.
 */
export function applyExtendExistingControl(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) {
    for (const st of target.statuses) {
      if (st.negative && st.unit === duration.unit) st.remaining += duration.value;
    }
  }
}

/**
 * `taunt_area`: provoca todo inimigo ao redor de quem usou a carta (status
 * "taunted", já negativo por convenção). Guarda só o status — fazer os
 * inimigos de fato priorizarem atacar o provocador depende da IA de
 * bots/boss, que ainda não existe no motor v2 (ver KANBAN.md).
 */
export function applyTauntArea(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  const duration = durationFromEffect(effect);
  const enemies = resolveAroundSelf(ctx, effect).filter((c) => c.team !== ctx.attacker!.team);
  for (const target of enemies) addStatus(target, ctx.nextId(), "taunted", duration.unit, duration.value, { negative: true });
}

/**
 * `block_ranged_attacks`: guarda o status no próprio dono da carta (Parede
 * Humana do Varek) — bloquear de fato ataques à distância contra ele (ou,
 * com `blocks_area`, contra a área ao redor) ainda depende de targeting.ts
 * saber ler esse status, o que não existe ainda (ver KANBAN.md).
 */
export function applyBlockRangedAttacks(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  const duration = durationFromEffect(effect);
  addStatus(ctx.attacker, ctx.nextId(), "block_ranged_attacks", duration.unit, duration.value, { negative: false, amount: effect.blocks_area ? 1 : 0 });
}

/**
 * `protective_dome`: guarda o status no(s) alvo(s) (Cúpula do Dorin,
 * combinável com `shield` na mesma carta). Reduzir/bloquear dano de fato
 * ainda depende de damage.ts saber ler esse status, o que não existe ainda.
 */
export function applyProtectiveDome(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const duration = durationFromEffect(effect);
  for (const target of targets) addStatus(target, ctx.nextId(), "protective_dome", duration.unit, duration.value, { negative: false });
}

/** `create_wall`: cria uma parede em `ctx.targetCell` (Barreira Rápida/Pilar do Dorin). */
export function applyCreateWall(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.targetCell) return;
  if (wallAtV2(ctx.game, ctx.targetCell)) return; // já tem parede ali — não duplica, não renova sozinha
  ctx.game.walls.push({
    id: ctx.nextId(),
    pos: { ...ctx.targetCell },
    hp: effect.hp ?? balance.walls.normal_wall_hp,
    team: ctx.attacker.team,
    remaining: balance.walls.default_duration_rounds,
    blocksRangedAttacks: effect.blocks_ranged_attacks,
  });
}

/** `reinforce_wall`: soma hp a uma parede já existente em `ctx.targetCell` (target "wall"). Sem parede ali, não faz nada. */
export function applyReinforceWall(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.targetCell) return;
  const wall = wallAtV2(ctx.game, ctx.targetCell);
  if (!wall) return;
  wall.hp += effect.amount ?? effect.bonus_hp ?? 0;
  if (effect.permanent) wall.remaining = null;
}

/** `destroy_wall`: remove a parede em `ctx.targetCell`, se houver. */
export function applyDestroyWall(ctx: EffectContextV2): void {
  if (!ctx.targetCell) return;
  ctx.game.walls = ctx.game.walls.filter((w) => !sameHex(w.pos, ctx.targetCell!));
}

/** `move_in_line`: avança em linha reta na direção escolhida, parando antes de obstáculo (Investida Selvagem/Perseguição do Borak). */
export function applyMoveInLine(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker || !ctx.moveDir) return;
  forcedMove(ctx.game, ctx.attacker, ctx.moveDir, effect.distance ?? 0);
}

/** Primeiro campeão vivo (de qualquer equipe) na direção `ctx.moveDir` a partir de quem usou a carta, se houver, antes de uma parede ou da borda. */
function firstChampionInPath(ctx: EffectContextV2): ChampionStateV2 | null {
  if (!ctx.attacker || !ctx.moveDir) return null;
  let pos = ctx.attacker.pos;
  const maxSteps = ctx.game.board.q_size + ctx.game.board.r_size;
  for (let i = 0; i < maxSteps; i++) {
    pos = addHex(pos, ctx.moveDir);
    if (!inHexBoard(pos, ctx.game.board) || wallAtV2(ctx.game, pos)) return null;
    const hit = allChampionsV2(ctx.game).find((c) => c.alive && c.uid !== ctx.attacker!.uid && sameHex(c.pos, pos));
    if (hit) return hit;
  }
  return null;
}

/**
 * `damage_first_in_path`: dano ao primeiro campeão na direção da investida
 * (Investida Selvagem/Perseguição Implacável do Borak), com empurrão opcional
 * (`push_distance`). O parâmetro `stun_if_target_marked_or_weak` ainda não é
 * avaliado — depende do status "mark"/de um conceito de "fraco" que o motor
 * v2 não define ainda (ver KANBAN.md).
 */
export function applyDamageFirstInPath(ctx: EffectContextV2, effect: Effect): Record<string, number> {
  const target = firstChampionInPath(ctx);
  if (!target || !ctx.attacker) return {};
  const out: Record<string, number> = { [target.uid]: dealDamageV2(ctx.attacker, target, effect.amount ?? 0, { bonus: ctx.bonusDamage }).final };
  if (effect.push_distance) pushChampion(ctx.game, target, ctx.attacker.pos, effect.push_distance);
  ctx.lastTarget = target;
  return out;
}

/** `damage_pierce_line`: dano em até `targets` campeões em linha, a partir de quem usou a carta na direção do alvo escolhido (Disparo Perfurante da Niara). */
export function applyDamagePierceLine(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  if (!ctx.attacker || targets.length === 0) return {};
  const dir = hexDirectionTo(ctx.attacker.pos, targets[0].pos);
  if (dir.q === 0 && dir.r === 0) return {};
  const out: Record<string, number> = {};
  const maxHits = effect.targets ?? 1;
  const maxSteps = ctx.game.board.q_size + ctx.game.board.r_size;
  let pos = ctx.attacker.pos;
  for (let i = 0; i < maxSteps && Object.keys(out).length < maxHits; i++) {
    pos = addHex(pos, dir);
    if (!inHexBoard(pos, ctx.game.board) || wallAtV2(ctx.game, pos)) break;
    const hit = allChampionsV2(ctx.game).find((c) => c.alive && c.uid !== ctx.attacker!.uid && sameHex(c.pos, pos));
    if (hit) out[hit.uid] = dealDamageV2(ctx.attacker, hit, effect.amount ?? 0, { bonus: ctx.bonusDamage }).final;
  }
  return out;
}

/** `damage_behind_target`: dano em quem estiver bem atrás do alvo escolhido, na mesma linha de ataque (Golpe Fendente do Borak). */
export function applyDamageBehindTarget(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): Record<string, number> {
  if (!ctx.attacker || targets.length === 0) return {};
  const primary = targets[0];
  const dir = hexDirectionTo(ctx.attacker.pos, primary.pos);
  if (dir.q === 0 && dir.r === 0) return {};
  const behindPos = addHex(primary.pos, dir);
  const behind = allChampionsV2(ctx.game).find((c) => c.alive && c.uid !== ctx.attacker!.uid && sameHex(c.pos, behindPos));
  if (!behind) return {};
  return { [behind.uid]: dealDamageV2(ctx.attacker, behind, effect.amount ?? 0, { bonus: ctx.bonusDamage }).final };
}

/**
 * `damage_second_target` / `damage_third_target`: ricochete (Ricochete da
 * Niara) — acerta o campeão vivo mais próximo do ÚLTIMO alvo atingido nesta
 * mesma carta (`ctx.lastTarget`, deixado pelo bloco `damage` anterior), a até
 * `max_distance_from_first`/`max_distance_from_second` casas, excluindo quem
 * já foi atingido. Sem alvo anterior ou sem ninguém por perto, não faz nada.
 */
function applyDamageChainedTarget(ctx: EffectContextV2, effect: Effect, maxDistanceKey: string): Record<string, number> {
  if (!ctx.lastTarget) return {};
  const exclude = new Set<string>(ctx.hitChain ?? []);
  exclude.add(ctx.lastTarget.uid);
  if (ctx.attacker) exclude.add(ctx.attacker.uid);
  const next = nearestOtherChampion(ctx.game, ctx.lastTarget.pos, effect[maxDistanceKey] ?? 0, exclude);
  if (!next) return {};
  const out = { [next.uid]: dealDamageV2(ctx.attacker, next, effect.amount ?? 0, { bonus: ctx.bonusDamage }).final };
  ctx.lastTarget = next;
  ctx.hitChain = new Set([...exclude, next.uid]);
  return out;
}

export const applyDamageSecondTarget = (ctx: EffectContextV2, effect: Effect): Record<string, number> =>
  applyDamageChainedTarget(ctx, effect, "max_distance_from_first");

export const applyDamageThirdTarget = (ctx: EffectContextV2, effect: Effect): Record<string, number> =>
  applyDamageChainedTarget(ctx, effect, "max_distance_from_second");

/** `gap_close_strike`: teleporta quem usou a carta pra uma casa livre ao lado do alvo, a até `distance` do ponto de partida (Sombra Letal da Vextra). */
export function applyGapCloseStrike(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  if (!ctx.attacker || targets.length === 0) return;
  const target = targets[0];
  const maxDistance = effect.distance ?? Infinity;
  const candidates = hexNeighbors(target.pos)
    .filter((h) => inHexBoard(h, ctx.game.board) && !wallAtV2(ctx.game, h) && isEmptyOfChampions(ctx.game, h))
    .filter((h) => hexDistance(ctx.attacker!.pos, h) <= maxDistance)
    .sort((a, b) => hexDistance(ctx.attacker!.pos, a) - hexDistance(ctx.attacker!.pos, b));
  const dest = candidates[0];
  if (!dest) return;
  ctx.attacker.pos = { ...dest };
}

/** `buff_next_card`: guarda o bônus pra próxima carta jogada pela equipe (Passo das Sombras da Vextra). Consumido em cardPlay.ts/turn.ts (ctx.bonusDamage). */
export function applyBuffNextCard(ctx: EffectContextV2, effect: Effect): void {
  if (!ctx.attacker) return;
  ctx.game.teams[ctx.attacker.team].nextCardBuff = { bonusDamage: effect.bonus_damage ?? 0 };
}

/**
 * `resurrect` (Ressurgir da Selene): traz um aliado morto de volta na hora,
 * pulando a espera de `outTurns` (ver death.ts). `targets` é o único aliado
 * morto escolhido (target "dead_ally", já validado por targeting.ts). O
 * limite de 1x por partida é checado antes de pagar a carta, em
 * cardPlay.ts/turn.ts (`resurrectBlockedV2`) — aqui só marca `resurrectUsed`
 * depois de resolver, pra não travar se o efeito falhar por algum motivo.
 */
export function applyResurrect(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const target = targets[0];
  if (!target) return;
  reviveChampionV2(ctx.game, target, effect.hp_percent ?? 100);
  ctx.game.teams[target.team].resurrectUsed = true;
}

/**
 * `death_ward` (Fênix Momentânea da Ignira): concede ao próprio dono um
 * status que, na PRÓXIMA vez que ele morreria, o salva com 1hp e explode
 * dano em área ao redor — a consequência de verdade mora em death.ts
 * (killChampionV2 checa o status antes de matar). Aqui só concede o status,
 * sem duração natural (persiste até ser consumido).
 */
export function applyDeathWard(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  for (const target of targets) {
    addStatus(target, ctx.nextId(), "death_ward", "rounds", PERSISTENT_REMAINING, {
      amount: effect.explode_damage ?? 0,
      radius: effect.explode_radius ?? 0,
      negative: false,
    });
  }
}

const DISPATCH: Record<string, (ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]) => void> = {
  damage: (ctx, effect, targets) => applyDamage(ctx, effect, targets),
  apply_status: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  apply_status_area: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  apply_status_all_allies: (ctx, effect, targets) => applyStatus(ctx, effect, targets),
  heal: (ctx, effect, targets) => applyHeal(ctx, effect, targets) as unknown as void,
  heal_all_allies: (ctx, effect, targets) => applyHeal(ctx, effect, targets) as unknown as void,
  shield: (_ctx, effect, targets) => applyShield(effect, targets),
  shield_all_allies: (_ctx, effect, targets) => applyShield(effect, targets),
  remove_negative_effects: (_ctx, effect, targets) => applyRemoveNegativeEffects(effect, targets),
  remove_negative_effects_all_allies: (_ctx, effect, targets) => applyRemoveNegativeEffects(effect, targets),
  remove_positive_effects: (_ctx, effect, targets) => applyRemovePositiveEffects(effect, targets),
  grant_personal_mana: (_ctx, effect, targets) => applyPersonalMana(effect, targets, 1),
  drain_personal_mana: (_ctx, effect, targets) => applyPersonalMana(effect, targets, -1),
  push: (ctx, effect, targets) => applyPush(ctx, effect, targets),
  pull: (ctx, effect, targets) => applyPull(ctx, effect, targets),
  move_self: (ctx, effect, targets) => applyMoveSelf(ctx, effect, targets),
  teleport_self: (ctx, effect, targets) => applyTeleportSelf(ctx, effect, targets),
  apply_venom_stacks: (ctx, effect, targets) => applyVenomStacks(ctx, effect, targets),
  detonate_venom_stacks: (ctx, effect, targets) => applyDetonateVenomStacks(ctx, effect, targets) as unknown as void,
  link: (ctx, effect, targets) => applyLink(ctx, effect, targets),
  heal_over_time: (ctx, effect, targets) => applyHealOverTime(ctx, effect, targets),
  ground_fire: (ctx, effect) => applyGroundFire(ctx, effect),
  venom_zone: (ctx, effect) => applyVenomZone(ctx, effect),
  apply_status_around_self: (ctx, effect) => applyStatusAroundSelf(ctx, effect),
  self_damage: (ctx, effect) => applySelfDamage(ctx, effect) as unknown as void,
  reflect_absorbed_damage: (ctx, effect) => applyReflectAbsorbedDamage(ctx, effect),
  extend_existing_control: (ctx, effect, targets) => applyExtendExistingControl(ctx, effect, targets),
  taunt_area: (ctx, effect) => applyTauntArea(ctx, effect),
  block_ranged_attacks: (ctx, effect) => applyBlockRangedAttacks(ctx, effect),
  protective_dome: (ctx, effect, targets) => applyProtectiveDome(ctx, effect, targets),
  create_wall: (ctx, effect) => applyCreateWall(ctx, effect),
  reinforce_wall: (ctx, effect) => applyReinforceWall(ctx, effect),
  destroy_wall: (ctx) => applyDestroyWall(ctx),
  move_in_line: (ctx, effect) => applyMoveInLine(ctx, effect),
  damage_first_in_path: (ctx, effect) => applyDamageFirstInPath(ctx, effect) as unknown as void,
  damage_pierce_line: (ctx, effect, targets) => applyDamagePierceLine(ctx, effect, targets) as unknown as void,
  damage_behind_target: (ctx, effect, targets) => applyDamageBehindTarget(ctx, effect, targets) as unknown as void,
  damage_second_target: (ctx, effect) => applyDamageSecondTarget(ctx, effect) as unknown as void,
  damage_third_target: (ctx, effect) => applyDamageThirdTarget(ctx, effect) as unknown as void,
  gap_close_strike: (ctx, effect, targets) => applyGapCloseStrike(ctx, effect, targets),
  buff_next_card: (ctx, effect) => applyBuffNextCard(ctx, effect),
  resurrect: (ctx, effect, targets) => applyResurrect(ctx, effect, targets),
  death_ward: (ctx, effect, targets) => applyDeathWard(ctx, effect, targets),
  jump_to_nearest_enemy_on_target_death: (_ctx, _effect, targets) => applyJumpToNearestEnemyOnTargetDeath(targets),
  link_buff: (ctx, effect, targets) => applyLinkBuff(ctx, effect, targets),
  hidden_trap: (ctx, effect) => applyHiddenTrap(ctx, effect),
  spring: (ctx, effect) => applySpring(ctx, effect),
  fire_wall: (ctx, effect) => applyFireWall(ctx, effect),
  venom_terrain: (ctx, effect) => applyVenomTerrain(ctx, effect),
  mark_ground_area: (ctx, effect) => applyMarkGroundArea(ctx, effect),
  detonate_nearby_ground_fire: (ctx, effect, targets) => applyDetonateNearbyGroundFire(ctx, effect, targets),
  fire_trail: (ctx, effect, targets) => applyFireTrail(ctx, effect, targets),
  delayed_damage: (ctx, effect, targets) => applyDelayedDamage(ctx, effect, targets),
  damage_all_adjacent_during_move: (ctx, effect) => applyDamageAllAdjacentDuringMove(ctx, effect) as unknown as void,
  create_structure: (ctx, effect) => applyCreateStructure(ctx, effect),
  create_walls_line: (ctx, effect) => applyCreateWallsLine(ctx, effect),
  create_walls_shape: (ctx, effect) => applyCreateWallsShape(ctx, effect),
  create_walls_around_target: (ctx, effect) => applyCreateWallsAroundTarget(ctx, effect),
  create_portal_pair: (ctx, effect) => applyCreatePortalPair(ctx, effect),
  slow_cell: (ctx, effect) => applySlowCell(ctx, effect),
};

/** Tipos de efeito que já têm execução real no motor v2 (os outros ainda só existem como dado). */
export const IMPLEMENTED_EFFECT_TYPES: string[] = Object.keys(DISPATCH);

/**
 * Executa um bloco de efeito sobre os alvos já resolvidos. Lança erro se o
 * tipo ainda não está implementado — a lista de implementados cresce conforme
 * os incrementos do KANBAN avançam pelo catálogo de claude/formato-dados.md.
 */
export function applyEffectV2(ctx: EffectContextV2, effect: Effect, targets: ChampionStateV2[]): void {
  const fn = DISPATCH[effect.type];
  if (!fn) throw new Error(`Tipo de efeito ainda não implementado no motor v2: ${effect.type}`);
  fn(ctx, effect, targets);
}
