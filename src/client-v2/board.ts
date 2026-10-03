// Tabuleiro hexagonal (roster v2) em Phaser: visão de cima, hexágonos "pointy-top"
// em coordenadas axiais {q,r}, tiles placeholder (mesmo nível de acabamento do
// board.ts do MVP — a arte de verdade vem depois).
//
// src/design/hexGrid.ts não exporta uma conversão axial→pixel (é geometria
// "design-only" hoje, ver o cabeçalho do arquivo), então a conversão padrão
// (Red Blob Games, orientação "pointy") está implementada aqui mesmo.

import Phaser from "phaser";
import hexBoardData from "../../data/hex_board.json";
import monstersMapData from "../../data/monsters_map.json";
import { zoneSide } from "../design/monsterPlacement";

const SIZE = 18; // raio do hexágono em pixels
const SQRT3 = Math.sqrt(3);
const COLORS = { A: 0x4aa3ff, B: 0xff6b5a };
const LEVEL_COLOR: Record<number, number> = { 1: 0x9bd14a, 2: 0xe0b040, 3: 0xd0603a };
const monsterTypes = (monstersMapData as any).types as Record<
  string,
  { name: string; level: number; zone: string; reaction: { options: { range: number | string }[] } }
>;

/**
 * Alcance de revide da criatura, pro desenho do raio no tabuleiro (03/10/2026,
 * pedido do dono do projeto — ver "alcance de revide" em engine-v2/monsters.ts).
 * Convenção dos dados (monsterReaction.ts): a 1ª opção listada é sempre a de
 * dano/agressiva, então `options[0].range` é o alcance que de fato ameaça
 * quem atacou (a 2ª opção, quando existe, costuma ser autobuff "self" ou fuga,
 * nenhuma delas mira no atacante). Hoje nenhum `options[0]` é "self" nos dados
 * (conferido: todos numéricos, 1 a 3) — se algum dia existir, cai no `?? 1`.
 */
function monsterReactionRange(typeId: string): number {
  const r = monsterTypes[typeId]?.reaction?.options?.[0]?.range;
  return typeof r === "number" ? r : 1;
}
// Cor do guardião de templo antes de reivindicado — mística, nem A nem B, pra
// não confundir com o dono de uma equipe (regras-e-decisoes.md §21).
const TEMPLE_UNCLAIMED_COLOR = 0xd4af37;
// Paleta por zona (claude/monstros-mapa.md/claude/estetica-visual.md): Vale
// Selvagem (verde, mesma cor que o tabuleiro sempre usou) vs. Terra
// Petrificada (pedra/terra áspera, cinza-amarronzado) — mesmo critério de
// partição de `zoneSide` (src/design/monsterPlacement.ts, a diagonal entre as
// duas pontas agudas do rombo), reaproveitado aqui sem duplicar a fórmula.
const ZONE_COLOR: Record<ReturnType<typeof zoneSide>, [number, number]> = {
  vale_selvagem: [0x3f7a3a, 0x448543],
  terra_petrificada: [0x6b5a44, 0x72624c],
};

export interface Hex { q: number; r: number }

export const key = (q: number, r: number) => `${q},${r}`;

const board = hexBoardData as { q_size: number; r_size: number };

/** Centro em pixel de uma casa axial (pointy-top, origem em 0,0, sem deslocamento). */
export function hexToPixel(h: Hex): { x: number; y: number } {
  return { x: SIZE * (SQRT3 * h.q + (SQRT3 / 2) * h.r), y: SIZE * 1.5 * h.r };
}

/** Os 6 vértices do hexágono "pointy-top" centrado em (cx,cy). */
function hexCorners(cx: number, cy: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const deg = 60 * i - 30;
    const rad = (Math.PI / 180) * deg;
    pts.push([cx + SIZE * Math.cos(rad), cy + SIZE * Math.sin(rad)]);
  }
  return pts;
}

// Margem pra nenhum hexágono ficar cortado nas bordas do canvas.
const MARGIN = SIZE * 2;
const boardWidth = SIZE * SQRT3 * (board.q_size + board.r_size / 2) + MARGIN * 2;
const boardHeight = SIZE * 1.5 * board.r_size + MARGIN * 2;

function toCanvas(h: Hex): { x: number; y: number } {
  const p = hexToPixel(h);
  return { x: p.x + MARGIN, y: p.y + MARGIN };
}

/**
 * Casa axial mais próxima de um ponto em pixel (canvas) — usado pro clique no
 * tabuleiro. Arredondamento em coordenadas cúbicas (Red Blob Games): dos 3
 * componentes (x=q, y=-q-r, z=r), o que tiver o MAIOR erro de arredondamento
 * é recalculado a partir dos outros dois, pra manter x+y+z=0 depois de
 * arredondar cada um separadamente.
 *
 * [Achado corrigido 03/10/2026, item 25 do KANBAN]: faltava o `else` que
 * corrige `rz` quando o erro de z era o maior dos três (cobria só os casos
 * "x é o maior" e "y é o maior", nunca "z é o maior") — pros ~1/3 dos
 * cliques onde isso acontecia, a função devolvia a casa VIZINHA à clicada,
 * não a clicada de verdade. Na prática, isso fazia o clique parecer não
 * "pegar" alvos de carta/básica nem monstros com frequência (relatado pelo
 * dono do projeto como "não consigo mirar nos monstros"/"cartas de
 * habilidade com problema") — o alvo certo às vezes ficava fora da casa
 * clicada, então `onCell(q, r)` nunca recebia a casa que o jogador via na
 * tela.
 */
function pixelToHex(px: number, py: number): Hex {
  const x = (px - MARGIN) / SIZE;
  const y = (py - MARGIN) / SIZE;
  const qf = (SQRT3 / 3) * x - (1 / 3) * y;
  const rf = (2 / 3) * y;
  const zf = -qf - rf; // y cúbico (x=qf, y=zf, z=rf) — "zf" aqui é só pra não colidir com a var `y` em pixels
  let rx = Math.round(qf), ry = Math.round(zf), rz = Math.round(rf);
  const dx = Math.abs(rx - qf), dy = Math.abs(ry - zf), dz = Math.abs(rz - rf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export interface Highlights {
  reach: Set<string>;
  targets: Set<string>;
  selected: string | null;
  /**
   * Botão de ligar/desligar o raio de revide das criaturas no mapa (voltou em
   * 03/10/2026 — existia no MVP original como checkbox "mostrar raios no
   * mapa", nunca tinha sido portado pro cliente v2). Padrão: ligado.
   */
  showMonsterRadii?: boolean;
}

export interface BoardApi {
  render(view: any, hl: Highlights): void;
  /** Controles de câmera (03/10/2026) — botões no painel, além de roda do mouse/arrastar no mapa. */
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
}

// Janela fixa da câmera (03/10/2026, pedido do dono do projeto, junto com o
// pedido de dobrar o tabuleiro: "pra não ficar muito pequeno, implemente uma
// câmera que possa dar zoom e ser controlada pelo jogador"). Antes, o jogo
// Phaser nascia do tamanho do MAPA inteiro (boardWidth/boardHeight) e só
// dependia do CSS (Scale.FIT) pra encolher isso no espaço disponível — um
// mapa maior virava só um desenho menor, sem jeito de aproximar. Agora o
// "mundo" do Phaser (onde os hexágonos são desenhados) continua do tamanho
// real do mapa, mas o JOGO (viewport visível) é uma janela de tamanho fixo
// — a câmera (scene.cameras.main) é quem decide que pedaço do mundo mostrar,
// com zoom e posição ajustáveis pelo jogador (roda do mouse + arrastar).
const VIEWPORT_W = 960;
const VIEWPORT_H = 680;
const MAX_ZOOM = 2.5;

export function createBoard(parent: HTMLElement, onCell: (q: number, r: number) => void): BoardApi {
  let view: any = null;
  let hl: Highlights = { reach: new Set(), targets: new Set(), selected: null, showMonsterRadii: true };
  let gfx: Phaser.GameObjects.Graphics;
  let labels: Phaser.GameObjects.Text[] = [];
  let scene: Phaser.Scene;
  let cam: Phaser.Cameras.Scene2D.Camera;
  let minZoom = 1;
  let fitZoom = 1;

  new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: VIEWPORT_W,
    height: VIEWPORT_H,
    backgroundColor: "#0d0a16",
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: {
      create(this: Phaser.Scene) {
        scene = this;
        gfx = this.add.graphics();
        cam = this.cameras.main;
        cam.setBounds(0, 0, boardWidth, boardHeight);
        fitZoom = Math.min(VIEWPORT_W / boardWidth, VIEWPORT_H / boardHeight, 1);
        minZoom = fitZoom * 0.6; // ainda dá pra afastar um pouco além do "caber tudo"
        cam.setZoom(fitZoom);
        cam.centerOn(boardWidth / 2, boardHeight / 2);

        // Zoom com a roda do mouse, centrado no ponteiro (dá pra aproximar
        // exatamente onde o jogador está olhando, não só no centro).
        this.input.on("wheel", (p: Phaser.Input.Pointer, _go: unknown, _dx: number, dy: number) => {
          const next = Phaser.Math.Clamp(cam.zoom - dy * 0.0012, minZoom, MAX_ZOOM);
          if (next === cam.zoom) return;
          const before = cam.getWorldPoint(p.x, p.y);
          cam.setZoom(next);
          const after = cam.getWorldPoint(p.x, p.y);
          cam.scrollX += before.x - after.x;
          cam.scrollY += before.y - after.y;
        });

        // Arrastar pra mover a câmera — só conta como arrasto (não clique na
        // casa) se o ponteiro andou mais que um pouco entre o down e o up,
        // senão todo clique normal viraria um "arrasto de 1px" sem querer.
        let dragFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
        let dragged = false;
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
          dragFrom = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
          dragged = false;
        });
        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
          if (!p.isDown || !dragFrom) return;
          const dx = p.x - dragFrom.x, dy = p.y - dragFrom.y;
          if (!dragged && Math.hypot(dx, dy) < 5) return;
          dragged = true;
          cam.scrollX = dragFrom.scrollX - dx / cam.zoom;
          cam.scrollY = dragFrom.scrollY - dy / cam.zoom;
        });
        this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
          if (!dragged) {
            const h = pixelToHex(p.worldX, p.worldY);
            if (h.q >= 0 && h.r >= 0 && h.q < board.q_size && h.r < board.r_size) onCell(h.q, h.r);
          }
          dragFrom = null;
          dragged = false;
        });

        draw();
      },
    },
  });

  /** Reseta a câmera pra enquadrar o mapa inteiro de novo (botão "centralizar"). */
  function resetView(): void {
    if (!cam) return;
    cam.setZoom(fitZoom);
    cam.centerOn(boardWidth / 2, boardHeight / 2);
  }

  function zoomBy(factor: number): void {
    if (!cam) return;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, minZoom, MAX_ZOOM));
  }

  function label(x: number, y: number, text: string, color = "#fff", size = 11) {
    const t = scene.add.text(x, y, text, { fontFamily: "Courier New", fontSize: `${size}px`, color, fontStyle: "bold", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5);
    labels.push(t);
  }

  function hexPoly(h: Hex, fill: number, alpha: number, strokeColor?: number, strokeAlpha = 1) {
    const { x, y } = toCanvas(h);
    const pts = hexCorners(x, y);
    gfx.fillStyle(fill, alpha);
    gfx.beginPath();
    gfx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i][0], pts[i][1]);
    gfx.closePath();
    gfx.fillPath();
    if (strokeColor !== undefined) {
      gfx.lineStyle(2, strokeColor, strokeAlpha);
      gfx.strokePath();
    }
  }

  function hpBar(cx: number, cy: number, hp: number, max: number) {
    const w = SIZE * 1.1;
    gfx.fillStyle(0x000000, 1).fillRect(cx - w / 2, cy + SIZE * 0.55, w, 5);
    gfx.fillStyle(hp / max > 0.4 ? 0x57d16f : 0xe0504a, 1).fillRect(cx - w / 2 + 1, cy + SIZE * 0.55 + 1, Math.max(0, Math.round(((w - 2) * hp) / max)), 3);
  }

  /** Triângulo apontando pra cima, centrado em (cx,cy) — ícone de perigo/gatilho instantâneo (armadilha, mola, marca etc.), pra distinguir de área contínua (círculo). */
  function triangle(cx: number, cy: number, r: number, fill: number, alpha: number, strokeColor?: number) {
    const pts: [number, number][] = [0, 1, 2].map((i) => {
      const deg = -90 + 120 * i;
      const rad = (Math.PI / 180) * deg;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    });
    gfx.fillStyle(fill, alpha);
    gfx.beginPath();
    gfx.moveTo(pts[0][0], pts[0][1]);
    gfx.lineTo(pts[1][0], pts[1][1]);
    gfx.lineTo(pts[2][0], pts[2][1]);
    gfx.closePath();
    gfx.fillPath();
    if (strokeColor !== undefined) gfx.lineStyle(1.5, strokeColor, 1).strokePath();
  }

  function zone(center: Hex, radius: number, color: number, alpha: number) {
    for (let dq = -radius; dq <= radius; dq++) {
      const rMin = Math.max(-radius, -dq - radius);
      const rMax = Math.min(radius, -dq + radius);
      for (let dr = rMin; dr <= rMax; dr++) {
        const h = { q: center.q + dq, r: center.r + dr };
        if (h.q < 0 || h.r < 0 || h.q >= board.q_size || h.r >= board.r_size) continue;
        hexPoly(h, color, alpha);
      }
    }
  }

  // Neblina de guerra (regras-e-decisoes.md §20/claude/estetica-visual.md): o
  // servidor já manda só o que a equipe de quem está vendo conhece (filtragem
  // de monstro/parede/chão em view-v2.ts); falta o CLIENTE representar visualmente
  // as 3 camadas pra quem está jogando (espectador — view.vision null — sempre
  // vê tudo, sem neblina): visível agora (tile normal), já explorado mas fora
  // de alcance no momento (esmaecido) e nunca visto (escurecido quase preto).
  // Puramente efeito de código (sem asset nenhum) — exatamente o que o doc de
  // estética lista como "o que dá pra fazer sem arte pronta".
  function visionSets(): { visible: Set<string>; explored: Set<string> } | null {
    if (!view?.vision) return null;
    const visible = new Set<string>((view.vision.visible as Hex[]).map((h) => key(h.q, h.r)));
    const explored = new Set<string>((view.vision.explored as Hex[]).map((h) => key(h.q, h.r)));
    return { visible, explored };
  }

  function draw() {
    if (!gfx) return;
    gfx.clear();
    labels.forEach((l) => l.destroy());
    labels = [];
    const vis = visionSets();
    for (let q = 0; q < board.q_size; q++)
      for (let r = 0; r < board.r_size; r++) {
        const zc = ZONE_COLOR[zoneSide({ q, r })];
        const base = (q + r) % 2 ? zc[0] : zc[1];
        const k = key(q, r);
        if (!vis || vis.visible.has(k)) {
          hexPoly({ q, r }, base, 1, 0x2a5a2a, 0.4);
        } else if (vis.explored.has(k)) {
          // Esmaecido: já visto antes, mas fora do alcance de visão agora.
          hexPoly({ q, r }, base, 0.45, 0x2a5a2a, 0.2);
        } else {
          // Nunca visto: quase preto, sem traço de borda (nada a destacar).
          hexPoly({ q, r }, 0x050208, 1);
        }
      }
    if (!view) return;

    // Alcance do boss, sempre visível (não depende do botão de raio de criatura).
    if (view.boss.alive) zone(view.boss.pos, view.boss.range, 0xff3fa4, 0.08);

    // Raio de revide das criaturas (03/10/2026, botão de volta — ver
    // Highlights.showMonsterRadii): mostra até onde cada criatura viva
    // consegue bater de volta (engine-v2/monsters.ts, "alcance de revide").
    // Atacar de fora desse raio não sofre contra-ataque — o raio é o que
    // diferencia valer a pena atacar de longe ou não.
    if (hl.showMonsterRadii) {
      for (const m of view.monsters as any[]) {
        if (!m.alive) continue;
        zone(m.pos, monsterReactionRange(m.typeId), LEVEL_COLOR[m.level] ?? 0x9bd14a, 0.12);
      }
    }

    for (let q = 0; q < board.q_size; q++)
      for (let r = 0; r < board.r_size; r++) {
        const k = key(q, r);
        if (hl.reach.has(k)) hexPoly({ q, r }, 0x4aa3ff, 0.4);
        if (hl.targets.has(k)) hexPoly({ q, r }, 0xffd23f, 0.4, 0xffd23f, 1);
      }

    // Efeitos de chão (hazards.ts/tick.ts): área contínua (dano/veneno/lentidão por
    // rodada, ou terreno que só encarece movimento) desenhada como círculo; gatilho
    // de uma vez (armadilha/mola/marca/muro de chamas) como triângulo — a FORMA
    // já diferencia "fica aqui e dói com o tempo" de "pisa e dispara uma vez",
    // sem precisar de 8 ícones desenhados à mão (ainda não há arte própria por
    // tipo — ver claude/estetica-visual.md).
    const AREA_GROUND: Record<string, number> = { fire: 0xff7a1a, venom: 0x7a3fb0, venom_terrain: 0x5a2a80, slow: 0x3fa0d0 };
    const TRIGGER_GROUND: Record<string, number> = { trap: 0xc0304a, spring: 0x3fd0c0, fire_wall: 0xff3f1a, mark: 0xffd23f };
    for (const g of view.ground as any[]) {
      const { x, y } = toCanvas(g.pos);
      if (g.kind in AREA_GROUND) {
        gfx.fillStyle(AREA_GROUND[g.kind], 0.55).fillCircle(x, y, SIZE * 0.55);
      } else {
        const c = TRIGGER_GROUND[g.kind] ?? 0x999999;
        triangle(x, y, SIZE * 0.5, c, 0.75, 0x000000);
      }
    }
    for (const wl of view.walls as any[]) {
      const { x, y } = toCanvas(wl.pos);
      gfx.fillStyle(0x7d7d8c, 1).fillCircle(x, y, SIZE * 0.7);
      // Pilar ★★★ do Dorin (blocksRangedAttacks): anel extra pra marcar que
      // também bloqueia ataque à distância, não só movimento (regras-e-decisoes.md §7).
      gfx.lineStyle(wl.blocksRangedAttacks ? 3 : 1, wl.blocksRangedAttacks ? 0xffd23f : 0x3a3a48, 1).strokeCircle(x, y, SIZE * 0.7);
      label(x, y, String(wl.hp), "#fff", 11);
    }
    // Torre de Vigia (Dorin, create_structure — regras-e-decisoes.md §10): forma de
    // torre (base + ameia triangular), cor da equipe dona, com o alcance de dano
    // por rodada marcado como anel fraco (mesma convenção do raio do boss acima).
    for (const st of (view.structures ?? []) as any[]) {
      const { x, y } = toCanvas(st.pos);
      zone(st.pos, st.range, COLORS[st.team as "A" | "B"], 0.06);
      gfx.fillStyle(0x4a4038, 1).fillRect(x - SIZE * 0.45, y - SIZE * 0.1, SIZE * 0.9, SIZE * 0.75);
      triangle(x, y - SIZE * 0.35, SIZE * 0.55, COLORS[st.team as "A" | "B"], 1, 0x000000);
      label(x, y + SIZE * 0.3, "TOR", "#fff", 8);
    }
    // Portal (Dorin): par de anéis roxos giratórios (estático aqui) ligados por
    // uma linha pontilhada — a MESMA cor nas duas pontas deixa claro que são um
    // par, sem precisar de rótulo repetido.
    for (const p of (view.portals ?? []) as any[]) {
      const pa = toCanvas(p.a);
      const pb = toCanvas(p.b);
      gfx.lineStyle(1, 0xb060ff, 0.35);
      gfx.beginPath();
      gfx.moveTo(pa.x, pa.y);
      gfx.lineTo(pb.x, pb.y);
      gfx.strokePath();
      for (const pt of [pa, pb]) {
        gfx.lineStyle(2, 0xb060ff, 1).strokeCircle(pt.x, pt.y, SIZE * 0.5);
        gfx.lineStyle(1, 0xe0c0ff, 0.6).strokeCircle(pt.x, pt.y, SIZE * 0.3);
      }
    }
    // Explosão retardada (Ignira, delayed_damage): círculo de alerta pulsante
    // (estático — sem loop de frame ainda) com a contagem regressiva no centro,
    // e a área que vai ser atingida marcada fraca por baixo.
    for (const d of (view.delayedDamages ?? []) as any[]) {
      const { x, y } = toCanvas(d.pos);
      if (d.radius > 0) zone(d.pos, d.radius, 0xff3f1a, 0.1);
      gfx.lineStyle(2, 0xff3f1a, 0.9).strokeCircle(x, y, SIZE * 0.4);
      label(x, y, String(d.roundsLeft), "#ff9a6a", 12);
    }

    const b = view.boss;
    if (b.alive) {
      const { x, y } = toCanvas(b.pos);
      if (b.aura) gfx.lineStyle(2, 0xff3fa4, 0.9).strokeCircle(x, y, SIZE * 1.15);
      gfx.fillStyle(0x5a1a6b, 1).fillCircle(x, y, SIZE * 0.95);
      gfx.lineStyle(2, 0xff3fa4, 1).strokeCircle(x, y, SIZE * 0.95);
      label(x, y - 2, "BOSS", "#ffd0f0", 9);
      hpBar(x, y, b.hp, b.maxHp);
    }
    // Templos de bênção (regras-e-decisoes.md §21): guardião vivo ganha um halo
    // de luz mística (cor fixa, nem A nem B); reivindicado, o halo vira a cor da
    // equipe dona e o guardião é substituído por um marco sóbrio ("santuário
    // selado"). Nunca escondido por neblina — desenhado por cima de qualquer
    // camada de fog, igual ao boss.
    for (const t of (view.temples ?? []) as any[]) {
      const { x, y } = toCanvas(t.pos);
      const claimColor = t.claimedBy ? COLORS[t.claimedBy as "A" | "B"] : TEMPLE_UNCLAIMED_COLOR;
      // Halo em anéis concêntricos de alpha decrescente — "radiância" estática,
      // sem precisar de animação por frame.
      gfx.lineStyle(1, claimColor, 0.25).strokeCircle(x, y, SIZE * 1.6);
      gfx.lineStyle(1, claimColor, 0.4).strokeCircle(x, y, SIZE * 1.3);
      if (t.alive) {
        gfx.fillStyle(0x241433, 1).fillCircle(x, y, SIZE * 0.95);
        gfx.lineStyle(3, claimColor, 1).strokeCircle(x, y, SIZE * 0.95);
        label(x, y - 2, "TPL", "#f0e0ff", 9);
        label(x, y + SIZE * 0.95 + 9, t.godName, claimColor === TEMPLE_UNCLAIMED_COLOR ? "#d4af37" : `#${claimColor.toString(16).padStart(6, "0")}`, 9);
        hpBar(x, y, t.hp, t.maxHp);
      } else {
        gfx.fillStyle(0x1a1020, 1).fillCircle(x, y, SIZE * 0.8);
        gfx.lineStyle(2, claimColor, 0.8).strokeCircle(x, y, SIZE * 0.8);
        label(x, y, "⛊", `#${claimColor.toString(16).padStart(6, "0")}`, 14);
        label(x, y + SIZE * 0.8 + 9, t.godName, `#${claimColor.toString(16).padStart(6, "0")}`, 9);
      }
    }

    for (const m of view.monsters as any[]) {
      if (!m.alive) continue;
      const { x, y } = toCanvas(m.pos);
      const t = monsterTypes[m.typeId];
      gfx.fillStyle(LEVEL_COLOR[m.level] ?? 0x9bd14a, 1).fillCircle(x, y - 1, SIZE * 0.5);
      gfx.lineStyle(2, 0x000000, 1).strokeCircle(x, y - 1, SIZE * 0.5);
      label(x, y - 1, t?.name?.slice(0, 2).toUpperCase() ?? "??", "#000", 10);
      hpBar(x, y, m.hp, m.maxHp);
    }
    for (const m of view.minions as any[]) {
      if (!m.alive) continue;
      const { x, y } = toCanvas(m.pos);
      gfx.fillStyle(0xc0c0c0, 1).fillCircle(x, y, SIZE * 0.35);
      hpBar(x, y, m.hp, m.maxHp);
    }
    for (const id of ["A", "B"] as const) {
      for (const c of view.teams[id].champions as any[]) {
        if (!c.alive) continue;
        const { x, y } = toCanvas(c.pos);
        const done = id === view.turn.team && view.turn.activated.includes(c.uid) && view.turn.main !== c.uid;
        gfx.fillStyle(0x000000, 1).fillCircle(x, y, SIZE * 0.62);
        gfx.fillStyle(COLORS[id], done ? 0.55 : 1).fillCircle(x, y, SIZE * 0.52);
        if (c.uid === hl.selected) gfx.lineStyle(2, 0xffd23f, 1).strokeCircle(x, y, SIZE * 0.62);
        if (c.shield > 0) gfx.lineStyle(2, 0x7be0ff, 1).strokeCircle(x, y, SIZE * 0.52);
        label(x, y - 3, (c.defId as string).slice(0, 2).toUpperCase(), "#fff", 11);
        hpBar(x, y, c.hp, c.maxHp);
        if ((c.statuses as any[]).some((s) => s.negative)) label(x + SIZE * 0.5, y - SIZE * 0.5, "!", "#ff0", 12);
      }
    }
  }

  return {
    render(v, h) {
      view = v;
      hl = h;
      if (scene) draw();
    },
    zoomIn() { zoomBy(1.25); },
    zoomOut() { zoomBy(0.8); },
    resetView,
  };
}
