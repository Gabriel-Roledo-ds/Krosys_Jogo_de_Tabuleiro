// Gerador de números aleatórios com seed fixa (mulberry32).
// Mesma seed = mesma partida, o que torna bugs reproduzíveis.

export interface Rng {
  /** Estado interno, para salvar e restaurar a partida. */
  state: number;
  /** Número real em [0, 1). */
  next(): number;
  /** Inteiro em [0, n). */
  int(n: number): number;
  /** Rola um dado de `sides` lados: inteiro em [1, sides]. */
  roll(sides: number): number;
  /** Embaralha uma cópia da lista (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  const rng: Rng = {
    state: seed >>> 0,
    next() {
      rng.state = (rng.state + 0x6d2b79f5) >>> 0;
      let t = rng.state;
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
  };
  return rng;
}
