// Visão limitada por campeão, bloqueada por obstáculos (pedido do dono do projeto,
// 02/10/2026): cada campeão só vê um raio de casas ao redor de si, e isso é
// interrompido por obstáculos sólidos no caminho. Sem obstáculos, o raio vale
// inteiro. Design-only, sobre o tabuleiro hexagonal (hexGrid.ts) — não ligado ao
// motor ainda. Ver regras-e-decisoes.md §20.
//
// Abordagem: pra cada casa dentro do raio, traça a linha entre o centro e ela
// (hexLine) e marca como visível só se nenhuma casa sólida no meio do caminho
// bloquear antes de chegar lá. A própria casa-alvo é sempre visível mesmo se for
// sólida (dá pra ver a parede, só não o que está atrás dela) — mesma regra que o
// alcance de cartas já usa no losango (src/engine/board.ts).

import { hexDistance, hexesInRadius, hexLine, type Hex } from "./hexGrid";

export interface VisionContext {
  origin: Hex;
  radius: number;
  /** Verdadeiro se a casa existe no tabuleiro (fora disso não é nem testada). */
  inBounds: (h: Hex) => boolean;
  /** Verdadeiro se a casa bloqueia a visão de quem está atrás dela. */
  isSolid: (h: Hex) => boolean;
}

/** Visibilidade de uma casa: enxerga agora, já viu antes (neblina) ou nunca viu. */
export type Visibility = "visible" | "explored" | "unseen";

/**
 * Casas visíveis a partir de `origin`, dado o raio de visão e os obstáculos.
 * Não depende de memória entre turnos — isso (a neblina "explored") é tratado por
 * quem chama, comparando o resultado de turnos diferentes.
 */
export function computeVisibleHexes(ctx: VisionContext): Hex[] {
  const visible: Hex[] = [];
  for (const h of hexesInRadius(ctx.origin, ctx.radius)) {
    if (!ctx.inBounds(h)) continue;
    if (hexDistance(ctx.origin, h) === 0) {
      visible.push(h);
      continue;
    }
    const path = hexLine(ctx.origin, h);
    let blocked = false;
    for (const cell of path) {
      if (cell.q === h.q && cell.r === h.r) break; // chegou na casa-alvo: sempre visível, mesmo sólida
      if (ctx.isSolid(cell)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) visible.push(h);
  }
  return visible;
}

/**
 * Combina o que é visível agora com o que já foi visto antes (memória de neblina),
 * pra dar o status de cada casa já explorada. Casas nunca retornadas por nenhuma
 * chamada anterior simplesmente não aparecem aqui (ficam "unseen" por omissão).
 */
export function mergeVisionMemory(
  visibleNow: Hex[],
  previouslyExplored: ReadonlySet<string>,
): { visible: Hex[]; explored: Hex[] } {
  const visibleKeys = new Set(visibleNow.map((h) => `${h.q},${h.r}`));
  const explored = [...previouslyExplored]
    .filter((key) => !visibleKeys.has(key))
    .map((key) => {
      const [q, r] = key.split(",").map(Number);
      return { q, r };
    });
  return { visible: visibleNow, explored };
}
