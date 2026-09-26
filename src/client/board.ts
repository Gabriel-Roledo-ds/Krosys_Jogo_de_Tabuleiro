// Tabuleiro em Phaser: visão de cima, losango, tiles simples em estilo 16-bit
// (placeholders; a arte de verdade vem depois).

import Phaser from "phaser";
import monstersData from "../../data/monsters.json";
import balance from "../../data/balance.json";

const T = 32;
const COLORS = { A: 0x4aa3ff, B: 0xff6b5a };
const INITIAL: Record<string, string> = { atirador: "At", piromante: "Pi", andarilho: "An", enredador: "En", curandeiro: "Cu", arquiteto: "Ar" };
const MONSTER_COLOR: Record<string, number> = { weak: 0x9bd14a, medium: 0xe0b040, strong: 0xd0603a };
const monsterTypes = monstersData.types as unknown as Record<string, { passive: { radius: number } }>;
const N = balance.board.width;

export interface Highlights {
  reach: Set<string>;
  targets: Set<string>;
  /** campeão selecionado para mover (anel dourado) */
  selected: string | null;
  showRadii: boolean;
}

export interface BoardApi {
  render(view: any, hl: Highlights): void;
}

export const key = (x: number, y: number) => `${x},${y}`;

export const inDiamond = (x: number, y: number, w = N, h = N) =>
  (balance.board as { shape?: string }).shape !== "diamond" || Math.abs(x - (w - 1) / 2) + Math.abs(y - (h - 1) / 2) <= (w - 1) / 2;

export function createBoard(parent: HTMLElement, onCell: (x: number, y: number) => void): BoardApi {
  let view: any = null;
  let hl: Highlights = { reach: new Set(), targets: new Set(), selected: null, showRadii: true };
  let gfx: Phaser.GameObjects.Graphics;
  let labels: Phaser.GameObjects.Text[] = [];
  let scene: Phaser.Scene;

  new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: N * T,
    height: N * T,
    backgroundColor: "#0d0a16",
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: {
      create(this: Phaser.Scene) {
        scene = this;
        gfx = this.add.graphics();
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
          const x = Math.floor(p.worldX / T);
          const y = Math.floor(p.worldY / T);
          if (x >= 0 && y >= 0 && x < N && y < N && inDiamond(x, y)) onCell(x, y);
        });
        draw();
      },
    },
  });

  function label(x: number, y: number, text: string, color = "#fff", size = 12) {
    const t = scene.add.text(x, y, text, { fontFamily: "Courier New", fontSize: `${size}px`, color, fontStyle: "bold", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5);
    labels.push(t);
  }

  function hpBar(px: number, py: number, hp: number, max: number) {
    gfx.fillStyle(0x000000, 1).fillRect(px + 2, py + T - 7, T - 4, 5);
    gfx.fillStyle(hp / max > 0.4 ? 0x57d16f : 0xe0504a, 1).fillRect(px + 3, py + T - 6, Math.max(0, Math.round(((T - 6) * hp) / max)), 3);
  }

  /** Zona de alcance (Chebyshev) de um ponto: só casas do losango, com contorno só nas bordas da zona. */
  function zone(cx: number, cy: number, r: number, color: number, alpha: number) {
    const inZone = (x: number, y: number) => Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= r && x >= 0 && y >= 0 && x <= 14 && y <= 14 && inDiamond(x, y);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (!inZone(x, y)) continue;
        gfx.fillStyle(color, alpha).fillRect(x * T, y * T, T, T);
        gfx.lineStyle(2, color, 0.9);
        const px = x * T, py = y * T;
        if (!inZone(x, y - 1)) gfx.lineBetween(px, py + 1, px + T, py + 1);
        if (!inZone(x, y + 1)) gfx.lineBetween(px, py + T - 1, px + T, py + T - 1);
        if (!inZone(x - 1, y)) gfx.lineBetween(px + 1, py, px + 1, py + T);
        if (!inZone(x + 1, y)) gfx.lineBetween(px + T - 1, py, px + T - 1, py + T);
      }
  }

  function draw() {
    if (!gfx) return;
    gfx.clear();
    labels.forEach((l) => l.destroy());
    labels = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (!inDiamond(x, y)) continue;
        const px = x * T;
        const py = y * T;
        const base = (x + y) % 2 ? 0x3f7a3a : 0x448543;
        gfx.fillStyle(base, 1).fillRect(px, py, T, T);
        gfx.fillStyle(0x2f6230, 1).fillRect(px + 6 + ((x * 7) % 9), py + 8 + ((y * 5) % 11), 2, 2);
        gfx.fillStyle(0x5aa056, 1).fillRect(px + 20 - ((y * 3) % 8), py + 22 - ((x * 5) % 9), 2, 2);
      }
    // contorno do losango
    gfx.lineStyle(3, 0x8a7bd0, 1);
    gfx.beginPath();
    gfx.moveTo((N / 2) * T, 0).lineTo(N * T, (N / 2) * T).lineTo((N / 2) * T, N * T).lineTo(0, (N / 2) * T).closePath().strokePath();
    if (!view) return;

    // raios: monstros, boss e aura
    if (hl.showRadii) {
      for (const m of view.monsters) {
        if (m.alive) zone(m.pos.x, m.pos.y, monsterTypes[m.type].passive.radius, MONSTER_COLOR[m.type], 0.13);
      }
      if (view.boss.alive) {
        zone(view.boss.pos.x, view.boss.pos.y, view.boss.range, 0xff3fa4, 0.09);
        if (view.boss.aura?.cardId === "terremoto") zone(view.boss.pos.x, view.boss.pos.y, balance.boss.terremoto_radius, 0xffa040, 0.08);
      }
      for (const s of view.structures) zone(s.pos.x, s.pos.y, s.range, 0x8a6a3a, 0.1);
    }

    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (!inDiamond(x, y)) continue;
        const px = x * T, py = y * T, k = key(x, y);
        if (hl.reach.has(k)) gfx.fillStyle(0x4aa3ff, 0.4).fillRect(px, py, T, T);
        if (hl.targets.has(k)) {
          gfx.fillStyle(0xffd23f, 0.4).fillRect(px, py, T, T);
          gfx.lineStyle(2, 0xffd23f, 1).strokeRect(px + 1, py + 1, T - 2, T - 2);
        }
      }

    for (const g of view.ground) {
      const px = g.pos.x * T, py = g.pos.y * T;
      const c = g.kind === "slow" ? 0x6aa0ff : 0xff7a1a;
      gfx.fillStyle(c, 0.55).fillRect(px + 3, py + 3, T - 6, T - 6);
    }
    for (const s of view.springs) label(s.pos.x * T + T / 2, s.pos.y * T + T / 2, "»", "#7be0ff", 18);
    for (const p of view.portals) for (const q of [p.a, p.b]) gfx.lineStyle(3, 0xb56bff, 1).strokeCircle(q.x * T + T / 2, q.y * T + T / 2, 11);
    for (const t of view.traps) label(t.pos.x * T + T / 2, t.pos.y * T + T / 2, "x", "#ffd23f", 16);
    for (const st of view.structures) {
      gfx.fillStyle(0x8a6a3a, 1).fillRect(st.pos.x * T + 6, st.pos.y * T + 6, T - 12, T - 12);
      label(st.pos.x * T + T / 2, st.pos.y * T + T / 2, "T", "#fff", 12);
    }
    for (const wl of view.walls) {
      const px = wl.pos.x * T, py = wl.pos.y * T;
      gfx.fillStyle(0x7d7d8c, 1).fillRect(px + 1, py + 1, T - 2, T - 2);
      gfx.fillStyle(0xa6a6b8, 1).fillRect(px + 1, py + 1, T - 2, 5);
      gfx.lineStyle(1, 0x3a3a48, 1).strokeRect(px + 1, py + 1, T - 2, T - 2);
      label(px + T / 2, py + T / 2 + 2, String(wl.hp), "#fff", 11);
    }
    const b = view.boss;
    if (b.alive) {
      const px = b.pos.x * T, py = b.pos.y * T;
      if (b.aura) gfx.lineStyle(2, 0xff3fa4, 0.9).strokeCircle(px + T / 2, py + T / 2, T * 0.9);
      gfx.fillStyle(0x5a1a6b, 1).fillRect(px - 4, py - 4, T + 8, T + 8);
      gfx.lineStyle(2, 0xff3fa4, 1).strokeRect(px - 4, py - 4, T + 8, T + 8);
      label(px + T / 2, py + T / 2 - 2, "BOSS", "#ffd0f0", 10);
      hpBar(px, py, b.hp, b.maxHp);
    }
    for (const m of view.monsters) {
      if (!m.alive) continue;
      const px = m.pos.x * T, py = m.pos.y * T;
      gfx.fillStyle(MONSTER_COLOR[m.type], 1).fillCircle(px + T / 2, py + T / 2 - 1, 11);
      gfx.lineStyle(2, 0x000000, 1).strokeCircle(px + T / 2, py + T / 2 - 1, 11);
      label(px + T / 2, py + T / 2 - 1, m.type === "weak" ? "m" : m.type === "medium" ? "M" : "W", "#000", 12);
      hpBar(px, py, m.hp, m.maxHp);
    }
    for (const m of view.minions) {
      if (!m.alive) continue;
      const px = m.pos.x * T, py = m.pos.y * T;
      gfx.fillStyle(0xc0c0c0, 1).fillCircle(px + T / 2, py + T / 2, 7);
      hpBar(px, py, m.hp, m.maxHp);
    }
    for (const id of ["A", "B"] as const) {
      for (const c of view.teams[id].champions) {
        if (!c.alive) continue;
        const px = c.pos.x * T, py = c.pos.y * T;
        const done = id === view.turn.team && view.turn.activated.includes(c.uid) && view.turn.main !== c.uid;
        gfx.fillStyle(0x000000, 1).fillRect(px + 3, py + 3, T - 6, T - 8);
        gfx.fillStyle(COLORS[id], done ? 0.55 : 1).fillRect(px + 5, py + 5, T - 10, T - 12);
        gfx.fillStyle(0xffffff, 0.35).fillRect(px + 5, py + 5, T - 10, 4);
        if (c.uid === hl.selected) gfx.lineStyle(2, 0xffd23f, 1).strokeRect(px + 1, py + 1, T - 2, T - 2);
        if (c.shield > 0) gfx.lineStyle(2, 0x7be0ff, 1).strokeRect(px + 3, py + 3, T - 6, T - 8);
        label(px + T / 2, py + T / 2 - 3, INITIAL[c.defId] ?? "??", "#fff", 11);
        hpBar(px, py, c.hp, c.maxHp);
        if (c.statuses.some((s: any) => s.negative)) label(px + T - 5, py + 6, "!", "#ff0", 12);
      }
    }
  }

  return {
    render(v, h) {
      view = v;
      hl = h;
      if (scene) draw();
    },
  };
}
