// Estado único do jogo. Toda ação do motor lê e altera este objeto.

import { balance, bossDef, getChampionDef, monsterData } from "./data";
import type { Pos } from "./board";
import { createRng, type Rng } from "./rng";

export type TeamId = "A" | "B";

export interface ChampionState {
  /** Único na partida, por exemplo "A-atirador". */
  uid: string;
  defId: string;
  team: TeamId;
  hp: number;
  maxHp: number;
  defense: number;
  pos: Pos;
  alive: boolean;
  /** Imune depois de voltar da morte, até o fim do primeiro turno em que for o principal. */
  untargetable: boolean;
}

export interface TeamState {
  id: TeamId;
  mana: number;
  champions: ChampionState[];
}

export interface MonsterState {
  uid: string;
  type: string;
  hp: number;
  maxHp: number;
  defense: number;
  pos: Pos;
  alive: boolean;
  rewardCard: string;
}

export interface BossState {
  hp: number;
  maxHp: number;
  defense: number;
  pos: Pos;
}

export interface GameState {
  width: number;
  height: number;
  teams: Record<TeamId, TeamState>;
  monsters: MonsterState[];
  boss: BossState;
  /** Jogador da vez. */
  currentTeam: TeamId;
  /** Rodada atual (uma rodada = todos os jogadores jogaram um turno). */
  round: number;
  rng: Rng;
}

const TEAM_IDS: TeamId[] = ["A", "B"];

/**
 * Cria uma partida nova.
 * `comp` tem os ids dos 3 campeões de cada equipe, por exemplo
 * { A: ["enredador", "piromante", "atirador"], B: ["arquiteto", "andarilho", "curandeiro"] }.
 */
export function createGame(comp: Record<TeamId, string[]>, seed: number): GameState {
  const teams = {} as Record<TeamId, TeamState>;
  for (const id of TEAM_IDS) {
    const ids = comp[id];
    if (ids.length !== balance.teams.champions_per_team) {
      throw new Error(`A equipe ${id} precisa de ${balance.teams.champions_per_team} campeões`);
    }
    const startCells = balance.teams.start_areas[id];
    teams[id] = {
      id,
      mana: balance.mana.start,
      champions: ids.map((defId, i) => {
        const def = getChampionDef(defId);
        return {
          uid: `${id}-${defId}`,
          defId,
          team: id,
          hp: def.hp,
          maxHp: def.hp,
          defense: def.defense,
          pos: { ...startCells[i] },
          alive: true,
          untargetable: false,
        };
      }),
    };
  }

  const types = monsterData.types as Record<string, { hp: number; defense: number; reward_card: string }>;
  const monsters: MonsterState[] = monsterData.placements.map((m) => ({
    uid: m.id,
    type: m.type,
    hp: types[m.type].hp,
    maxHp: types[m.type].hp,
    defense: types[m.type].defense,
    pos: { ...m.position },
    alive: true,
    rewardCard: types[m.type].reward_card,
  }));

  return {
    width: balance.board.width,
    height: balance.board.height,
    teams,
    monsters,
    boss: { hp: bossDef.hp, maxHp: bossDef.hp, defense: bossDef.defense, pos: { ...balance.board.boss_position } },
    currentTeam: "A",
    round: 1,
    rng: createRng(seed),
  };
}

export const allChampions = (s: GameState): ChampionState[] => [
  ...s.teams.A.champions,
  ...s.teams.B.champions,
];
