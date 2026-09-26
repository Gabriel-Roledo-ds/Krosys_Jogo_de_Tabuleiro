// Gerador de números aleatórios com seed fixa (mulberry32).
// Mesma seed = mesma partida, o que torna bugs reproduzíveis.
// O estado do gerador fica num número dentro do GameState, então a partida inteira
// pode ser salva e restaurada como JSON.

export interface RngHolder {
  rngState: number;
}

export interface Rng {
  /** Número real em [0, 1). */
  next(): number;
  /** Inteiro em [0, n). */
  int(n: number): number;
  /** Rola um dado de `sides` lados: inteiro em [1, sides]. */
  roll(sides: number): number;
  /** Embaralha uma cópia da lista (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Escolhe um item ao acaso. */
  pick<T>(items: readonly T[]): T;
}

/** Gerador que lê e grava o estado em `holder.rngState`. */
export function rngOf(holder: RngHolder): Rng {
  const rng: Rng = {
    next() {
      holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
      let t = holder.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) {
      return Math.floor(rng.next() * n);
    },
    roll(sides) {
      return rng.int(sides) + 1;
    },
    shuffle(items) {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    pick(items) {
      return items[rng.int(items.length)];
    },
  };
  return rng;
}

/** Gerador independente, para testes. */
export function createRng(seed: number): Rng {
  return rngOf({ rngState: seed >>> 0 });
}
