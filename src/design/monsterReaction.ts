// Lógica isolada do sistema de reação ao ataque do mapa de monstros (roster v2).
//
// Design-only: implementa só a REGRA (claude/monstros-mapa.md, "Sistema de reação
// ao ataque"), sem tocar no motor da partida de verdade (src/engine/*), que ainda
// roda o roster MVP antigo. Serve pra testar a regra com posições fictícias antes
// do tabuleiro hexagonal existir — ver regras-e-decisoes.md §19 "Sequenciamento
// da implementação".
//
// Quando o roster v2 entrar em produção, isso deve ser revisto e ligado à pilha
// de respostas rápidas de verdade (src/engine) em vez de rodar sozinho.

import monstersMapJson from "../../data/monsters_map.json";

export type Posture = "agressiva" | "territorial" | "evasiva";
export type ReactionKind = "auto" | "choice" | "mini_turn";
export type AttackTrigger = "attacked_by_champion" | "entered_range" | "passed_through";

export interface ReactionOption {
  name: string;
  range: number | string;
  effects: { type: string; [key: string]: unknown }[];
  condition?: string;
  posture_after?: Posture;
  targets?: number;
  require_adjacent_to_each_other?: boolean;
}

export interface Reaction {
  kind: ReactionKind;
  options: ReactionOption[];
  move?: { distance: number; mode?: string; ignores_solids?: boolean };
  repeats_on_each_attack?: boolean;
}

export interface MonsterType {
  name: string;
  zone: string;
  level: 1 | 2 | 3;
  copies: number;
  hp: number;
  defense: number;
  posture: Posture;
  reaction: Reaction;
  is_boss_tier?: boolean;
}

const raw = monstersMapJson as unknown as { types: Record<string, MonsterType> };
export const monsterTypes: Record<string, MonsterType> = raw.types;

export function getMonsterType(id: string): MonsterType {
  const t = monsterTypes[id];
  if (!t) throw new Error(`Tipo de criatura desconhecido: ${id}`);
  return t;
}

/** Contexto mínimo de combate pra decidir a reação — tudo fictício, sem tabuleiro de verdade. */
export interface CombatContext {
  trigger: AttackTrigger;
  /** Já foi atacada antes nesse mesmo combate (desde a última vez que ficou sem ninguém no alcance)? */
  attackedBeforeThisCombat: boolean;
  /** Já fugiu uma vez nesse mesmo combate (postura Evasiva)? */
  fledOnceThisCombat: boolean;
  /** Pode fugir agora (não está encurralada contra parede/borda)? */
  canFlee: boolean;
}

/**
 * Gatilho da reação: só dispara quando o trigger é "attacked_by_champion".
 * Entrar no alcance ou só passar perto nunca aciona nada — ver claude/monstros-mapa.md.
 */
export function shouldReact(trigger: AttackTrigger): boolean {
  return trigger === "attacked_by_champion";
}

/**
 * Escolhe qual opção da reação a criatura usa, segundo a postura (determinístico, sem IA):
 * - Agressiva: sempre a opção de dano.
 * - Territorial: controle/mitigação na primeira vez; dano nas seguintes.
 * - Evasiva: fuga/reposicionamento, exceto se já fugiu uma vez ou está encurralada.
 *
 * As opções são identificadas por convenção de posição na lista (ver monsters_map.json):
 * para kind "auto" só existe 1 opção. Para "choice"/"mini_turn" a convenção usada ao
 * escrever os dados é: a 1ª opção listada é a de dano/agressiva, a 2ª é a de controle/fuga.
 * Isso é uma leitura de implementação, não está nos dados — documentado aqui de propósito.
 */
export function chooseReactionOption(type: MonsterType, ctx: CombatContext): ReactionOption {
  const { options } = type.reaction;
  if (options.length === 1) return options[0];

  const [damageOption, utilityOption] = options;

  switch (type.posture) {
    case "agressiva":
      return damageOption;

    case "territorial":
      return ctx.attackedBeforeThisCombat ? damageOption : utilityOption;

    case "evasiva":
      if (!ctx.canFlee || ctx.fledOnceThisCombat) return damageOption;
      return utilityOption;

    default: {
      // Exaustividade: qualquer postura nova precisa ser tratada acima.
      const _never: never = type.posture;
      throw new Error(`Postura desconhecida: ${_never}`);
    }
  }
}

/** Decide a reação completa (se reage, e com qual opção), dado o gatilho e o contexto. */
export function decideReaction(
  type: MonsterType,
  trigger: AttackTrigger,
  ctx: CombatContext,
): { reacted: false } | { reacted: true; option: ReactionOption; moved: boolean } {
  if (!shouldReact(trigger)) return { reacted: false };
  const option = chooseReactionOption(type, ctx);
  return { reacted: true, option, moved: type.reaction.kind === "mini_turn" };
}
