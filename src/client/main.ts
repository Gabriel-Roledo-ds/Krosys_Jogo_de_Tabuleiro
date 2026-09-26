import cardsData from "../../data/cards.json";
import champsData from "../../data/champions.json";
import monstersData from "../../data/monsters.json";
import bossData from "../../data/boss.json";
import { createBoard, key, type Highlights } from "./board";

type Pos = { x: number; y: number };
type Target = { uid?: string; uid2?: string; pos?: Pos; pos2?: Pos; dir?: Pos };

const cards: Record<string, any> = {};
for (const c of (Array.isArray(cardsData) ? cardsData : (cardsData as any).cards) as any[]) cards[c.id] = c;
const champs: Record<string, any> = {};
for (const c of champsData as any[]) champs[c.id] = c;

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------- conexão ----------
let ws: WebSocket;
let session: { code: string; token: string } | null = null;
let me: "A" | "B" | null = null;
let lobby: any = null;
let view: any = null;
let myComp: string[] = [];
let sel: { kind: "card"; uid: string } | { kind: "basic"; champion: string } | null = null;
let moving: string | null = null;
let showRadii = true;
let chooser: Target[] | null = null;
let name = localStorage.getItem("krosys:name") ?? "";

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("krosys:session") ?? "null");
      if (saved) ws.send(JSON.stringify({ t: "rejoin", ...saved }));
    } catch { /* sem sessão salva */ }
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case "joined":
        session = { code: m.code, token: m.token };
        me = m.team;
        sessionStorage.setItem("krosys:session", JSON.stringify(session));
        break;
      case "rejoin_failed":
        sessionStorage.removeItem("krosys:session");
        break;
      case "lobby":
        lobby = m.lobby;
        renderLobby();
        break;
      case "state":
        view = m.view;
        sel = null;
        chooser = null;
        renderGame();
        break;
      case "error":
        $("err").textContent = m.msg;
        lobbyErr(m.msg);
        break;
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}
const send = (o: unknown) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const act = (action: unknown) => { $("err").textContent = ""; send({ t: "action", action }); };
setInterval(() => send({ t: "ping" }), 25000);

// ---------- lobby ----------
function lobbyErr(msg: string) { const e = document.getElementById("lobbyerr"); if (e) e.textContent = msg; }

function renderLobby() {
  $("lobby").style.display = view ? "none" : "block";
  $("game").style.display = view ? "grid" : "none";
  if (view) return;
  const L = $("lobby");
  if (!lobby) {
    L.innerHTML = `<h1>KRÓSYS</h1>
      <p>Duas equipes de três campeões disputam o último golpe no boss.</p>
      <div class="row"><input id="nm" placeholder="Seu nome" maxlength="20" value="${esc(name)}"></div>
      <div class="row"><button id="create">Criar sala</button></div>
      <div class="row"><input id="code" placeholder="Código da sala" maxlength="6" style="text-transform:uppercase"><button id="join">Entrar</button></div>
      <div id="lobbyerr" style="color:#ff8a8a"></div>`;
    const nm = () => { name = (($("nm") as HTMLInputElement).value || "").trim(); localStorage.setItem("krosys:name", name); return name; };
    $("create").onclick = () => send({ t: "create", name: nm() });
    $("join").onclick = () => send({ t: "join", code: ($("code") as HTMLInputElement).value.trim(), name: nm() });
    return;
  }
  const seat = (t: "A" | "B") => {
    const s = lobby.seats[t];
    return s ? `${esc(s.name)}${s.bot ? " (bot)" : ""} ${s.comp ? "✔ pronto" : "escolhendo…"}` : "<i>vaga</i>";
  };
  const mineComp: string[] = lobby.seats[lobby.me]?.comp ?? myComp;
  const pick = Object.values(champs).map((c: any) =>
    `<div class="champ ${mineComp.includes(c.id) || myComp.includes(c.id) ? "sel" : ""}" data-c="${c.id}"><b>${c.name}</b><br><small>${c.role}<br>HP ${c.hp} · Def ${c.defense}</small></div>`).join("");
  L.innerHTML = `<h1>KRÓSYS</h1>
    <p>Sala <b style="font-size:22px;color:#f2c14e">${lobby.code}</b> — passe o código para o seu amigo.</p>
    <p><span class="teamA">Equipe A:</span> ${seat("A")}<br><span class="teamB">Equipe B:</span> ${seat("B")}</p>
    <p>Escolha 3 campeões diferentes (${myComp.length}/3):</p>
    <div class="row" id="pick">${pick}</div>
    <div class="row">
      ${lobby.me === "A" && !lobby.seats.B ? `<button id="bot">Jogar contra o bot</button>` : ""}
      ${lobby.me === "A" ? `<button id="start">Começar partida</button>` : "<i>Aguardando o criador da sala começar…</i>"}
    </div><div id="lobbyerr" style="color:#ff8a8a"></div>`;
  document.querySelectorAll<HTMLElement>(".champ").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.c!;
      myComp = myComp.includes(id) ? myComp.filter((x) => x !== id) : [...myComp, id].slice(-3);
      if (myComp.length === 3) send({ t: "setComp", comp: myComp });
      renderLobby();
    };
  });
  const bot = document.getElementById("bot"); if (bot) bot.onclick = () => send({ t: "addBot" });
  const st = document.getElementById("start"); if (st) st.onclick = () => send({ t: "start" });
}

// ---------- jogo ----------
const monsterTypes = monstersData.types as Record<string, any>;
const bossCards: Record<string, any> = {};
for (const c of (bossData as any).deck) bossCards[c.id] = c;

const STATUS: Record<string, string> = { mark: "Marca", move_penalty: "Lentidão", immobilized: "Imobilizado", stunned: "Atordoado", silenced: "Silenciado", hot: "Cura contínua", link: "Elo", control_immune: "Imune a controle" };
const STATUS_HELP: Record<string, string> = {
  mark: "recebe dano extra de qualquer fonte", move_penalty: "perde casas de movimento", immobilized: "não pode se mover",
  stunned: "não usa cartas nem a básica", silenced: "não usa cartas", hot: "cura no fim de cada rodada", link: "divide o dano com o parceiro", control_immune: "não sofre novo controle",
};
const PASSIVE: Record<string, string> = {
  atirador: "Olho Treinado: +1 de dano em alvos a 3 ou mais casas.",
  piromante: "Pele em Brasa: imune a fogo, pode pisar em chamas sem dano.",
  andarilho: "Pés Leves: atravessa aliados e ignora casas lentas.",
  enredador: "Presença Sufocante: inimigos adjacentes têm -1 de movimento.",
  curandeiro: "Vida Compartilhada: toda cura que dá também cura 1 nele.",
  arquiteto: "Engenheiro: atravessa as próprias paredes; suas estruturas têm +2 de vida.",
};
const BASIC_TEXT: Record<string, string> = {
  atirador: "Dano 2 em um alvo.", piromante: "Dano 1 de fogo em uma casa.", andarilho: "+1 de movimento; +1 de mana se andar 5 ou mais.",
  enredador: "Alvo perde 2 de movimento no próximo turno dele.", curandeiro: "Cura 1 de vida em um aliado.", arquiteto: "Cria uma parede fraca (2 de vida).",
};
const MONSTER_EFFECT: Record<string, string> = {
  regen_per_round: "Regenera 1 de vida por rodada.", thorns_adjacent: "Reflete 1 de dano em quem bate de perto.", slow_aura_adjacent: "Quem está adjacente perde 1 de movimento.",
};
const durText = (s: any) => `${s.remaining} ${s.unit === "rounds" ? (s.remaining === 1 ? "rodada" : "rodadas") : s.remaining === 1 ? "turno do campeão" : "turnos do campeão"}`;
const champName = (u: any) => champs[u.defId]?.name ?? "?";
const unitName = (u: any) => (u.defId ? `${champName(u)} (${u.team})` : u.uid === "boss" ? "Boss" : u.type ? `${monsterTypes[u.type].name} (${u.uid.slice(0, 3)})` : "Lacaio do Boss");

const board = createBoard($("board"), (x, y) => onCell(x, y));
($("radii") as HTMLInputElement).onchange = (e) => { showRadii = (e.target as HTMLInputElement).checked; if (view) renderGame(); };

function allUnits(): any[] {
  const u: any[] = [];
  for (const t of ["A", "B"]) u.push(...view.teams[t].champions.filter((c: any) => c.alive));
  u.push(...view.monsters.filter((m: any) => m.alive), ...view.minions.filter((m: any) => m.alive));
  if (view.boss.alive) u.push(view.boss);
  return u;
}
const unitByUid = (uid: string) => allUnits().find((u) => u.uid === uid) ?? [...view.teams.A.champions, ...view.teams.B.champions].find((c: any) => c.uid === uid);
const unitAt = (x: number, y: number) => allUnits().find((u) => u.pos.x === x && u.pos.y === y);
const isMyTurn = () => view.awaiting.team === me && view.awaiting.kind !== "over";
const myAct = () => isMyTurn() && !view.pending && view.turn.phase === "act";
const hints = () => view.hints ?? {};

function candidateTargets(): Target[] {
  if (!sel) return [];
  return sel.kind === "basic" ? hints().basics?.[sel.champion]?.targets ?? [] : hints().targets?.[sel.uid] ?? [];
}
function selOwner(): any {
  if (!sel) return null;
  if (sel.kind === "basic") return unitByUid(sel.champion);
  const card = view.teams[me!].hand.find((c: any) => c.uid === (sel as any).uid);
  return card ? unitByUid(card.owner) : null;
}
function cellOf(t: Target): Pos | null {
  if (t.uid) { const u = unitByUid(t.uid); return u && u.alive !== false ? u.pos : null; }
  if (t.pos) return t.pos;
  if (t.uid2) return unitByUid(t.uid2)?.pos ?? null;
  if (t.dir) { const o = selOwner(); return o ? { x: o.pos.x + t.dir.x, y: o.pos.y + t.dir.y } : null; }
  return null;
}
function describe(t: Target): string {
  const parts: string[] = [];
  const nameOf = (uid?: string) => { const u = uid && unitByUid(uid); return u ? unitName(u) : ""; };
  if (t.uid) parts.push(nameOf(t.uid));
  if (t.uid2) parts.push(nameOf(t.uid2));
  if (t.pos) parts.push(`(${t.pos.x},${t.pos.y})`);
  if (t.pos2) parts.push(`→(${t.pos2.x},${t.pos2.y})`);
  if (t.dir) parts.push(`direção ${t.dir.x},${t.dir.y}`);
  return parts.join(" ") || "Confirmar";
}
function submitTarget(t: Target) {
  if (!sel) return;
  if (sel.kind === "basic") act({ type: "basic", champion: sel.champion, target: t });
  else act({ type: "play", card: sel.uid, target: t });
}

function onCell(x: number, y: number) {
  if (!view) return;
  if (sel) {
    const cands = candidateTargets();
    const here = cands.filter((t) => { const c = cellOf(t); return c && c.x === x && c.y === y; });
    if (here.length === 1) return submitTarget(here[0]);
    if (here.length > 1) { chooser = here; return renderActions(); }
    const kind = sel.kind === "basic" ? hints().basics?.[sel.champion]?.target : cards[view.teams[me!].hand.find((c: any) => c.uid === (sel as any).uid)?.cardId]?.target;
    if (kind === "cell") return submitTarget({ pos: { x, y } });
    const u = unitAt(x, y);
    if (u) openModal(u.uid);
    return;
  }
  if (myAct() && moving && hints().reach?.[moving]?.some((c: any) => c.pos.x === x && c.pos.y === y)) return act({ type: "move", champion: moving, to: { x, y } });
  const u = unitAt(x, y);
  if (u) openModal(u.uid);
}

function highlights(): Highlights {
  const reach = new Set<string>(), targets = new Set<string>();
  if (sel) for (const t of candidateTargets()) { const c = cellOf(t); if (c) targets.add(key(c.x, c.y)); }
  else if (myAct() && moving) for (const c of hints().reach?.[moving] ?? []) reach.add(key(c.pos.x, c.pos.y));
  return { reach, targets, selected: sel ? null : moving, showRadii };
}

function pickMoving() {
  if (!myAct()) { moving = null; return; }
  const r = hints().reach ?? {};
  if (moving && r[moving]?.length) return;
  const main = view.turn.main;
  if (main && r[main]?.length) { moving = main; return; }
  moving = Object.keys(r).find((u) => r[u].length && !view.turn.activated.includes(u)) ?? null;
}

function renderGame() {
  $("lobby").style.display = "none";
  $("game").style.display = "grid";
  pickMoving();
  board.render(view, highlights());
  renderStatus(); renderTeams(); renderActions(); renderHand(); renderLog(); renderEffects();
  if (modalUid) openModal(modalUid);
}

// ---------- painéis ----------
function renderStatus() {
  const t = view.turn;
  let msg: string;
  if (view.winner) msg = view.winner === me ? "🏆 VOCÊ VENCEU!" : "Derrota: o outro time deu o último golpe.";
  else if (view.pending) msg = view.pending.priority === me ? "⚡ Você pode responder com uma carta rápida." : "Aguardando resposta do adversário…";
  else if (t.team === me) msg = ({ draw: "Sua vez: compre uma carta.", act: "Ação: mova cada campeão uma vez, use cartas e uma habilidade básica.", discard: "Mão cheia: descarte uma carta.", boss: "O boss age…" } as any)[t.phase] ?? "";
  else msg = "Vez do adversário…";
  $("status").innerHTML = `<b class="team${me}">Você: equipe ${me}</b> · Rodada ${view.round} · Turno da equipe <b class="team${t.team}">${t.team}</b>
    <div id="msg">${esc(msg)}</div>
    <div>${t.phase === "act" ? `🎲 Dado do turno: <b>${t.die}</b> · ` : ""}Boss: ${view.boss.hp}/${view.boss.maxHp} PV${view.boss.aura ? " · aura: " + esc(bossCards[view.boss.aura.cardId]?.name ?? view.boss.aura.cardId) : ""}</div>`;
}

function renderTeams() {
  $("teams").innerHTML = (["A", "B"] as const).map((id) => {
    const t = view.teams[id];
    return `<div><b class="team${id}">Equipe ${id}</b> · mana ${t.mana} · mão ${t.handCount}` +
      t.champions.map((c: any) => {
        const moved = id === view.turn.team && view.turn.activated.includes(c.uid);
        return `<div class="clk" data-u="${c.uid}" style="cursor:pointer">${moved ? "✔ " : ""}${champs[c.defId].name} ${c.alive ? `${c.hp}/${c.maxHp}` : `☠ volta em ${c.outTurns} turno(s)`}${c.shield ? ` 🛡${c.shield}` : ""}
        <div class="bar"><i style="width:${c.alive ? (100 * c.hp) / c.maxHp : 0}%"></i></div>
        ${c.statuses.map((s: any) => `<span class="tag">${esc(STATUS[s.kind] ?? s.kind)}${s.amount ? " " + s.amount : ""}·${s.remaining}</span>`).join("")}</div>`;
      }).join("") + "</div>";
  }).join("<hr>");
  document.querySelectorAll<HTMLElement>("#teams .clk").forEach((el) => (el.onclick = () => openModal(el.dataset.u!)));
}

function renderActions() {
  const A = $("actions");
  const h = hints();
  let html = "";
  if (view.winner) html = `<button onclick="location.reload()">Voltar ao início</button>`;
  else if (chooser) {
    html = "Qual opção?" + chooser.map((t, i) => `<div><button data-i="${i}">${esc(describe(t))}</button></div>`).join("") + `<button id="cancel">Cancelar</button>`;
  } else if (sel) {
    const noCell = candidateTargets().filter((t) => !cellOf(t));
    html = "Clique numa casa destacada." + noCell.map((t, i) => `<div><button data-nc="${i}">${esc(describe(t))}</button></div>`).join("") + `<div><button id="cancel">Cancelar</button></div>`;
  } else if (view.pending && view.pending.priority === me) {
    const top = view.pending.stack[view.pending.stack.length - 1];
    const topName = top.cardId.startsWith("basic:") ? champs[top.cardId.slice(6)]?.basic.name : cards[top.cardId]?.name ?? bossCards[top.cardId]?.name ?? top.cardId;
    html = `Em jogo: ${esc(topName)}<div><button id="pass">Passar</button></div>`;
  } else if (isMyTurn() && !view.pending) {
    const ph = view.turn.phase;
    if (ph === "draw") {
      html = "Comprar do baralho de:" + view.teams[me!].champions.filter((c: any) => c.alive).map((c: any) =>
        `<div><button data-draw="${c.uid}" ${view.teams[me!].decks[c.uid]?.draw + view.teams[me!].decks[c.uid]?.discard === 0 ? "disabled" : ""}>${champs[c.defId].name} (${view.teams[me!].decks[c.uid]?.draw} no baralho)</button></div>`).join("");
      if (h.canSkipDraw) html += `<div><button id="skipdraw">Não comprar (mão cheia)</button></div>`;
    } else if (ph === "act") {
      const mine = view.teams[me!].champions.filter((c: any) => c.alive);
      const rows = mine.map((c: any) => {
        const r = h.reach?.[c.uid];
        const canStay = (h.canStay ?? []).includes(c.uid);
        const activeNow = view.turn.main === c.uid;
        const state = activeNow ? `movendo (${view.turn.movementLeft} restantes)` : view.turn.activated.includes(c.uid) ? "já se moveu" : "pode mover";
        return `<div class="row2"><b>${champs[c.defId].name}</b> <small>${state}</small><div class="row">
          ${r?.length ? `<button data-mv="${c.uid}" ${moving === c.uid ? 'style="border-color:#f2c14e"' : ""}>Mover</button>` : ""}
          ${canStay ? `<button data-stay="${c.uid}">Ficar parado</button>` : ""}
          ${h.basics?.[c.uid] ? `<button data-basic="${c.uid}">${esc(h.basics[c.uid].name)}</button>` : ""}</div></div>`;
      }).join("");
      html = `${rows}<div class="row"><button id="end">Encerrar turno</button></div><small>Cada campeão se move uma vez (até ${view.turn.die} casas). Só uma habilidade básica por turno${view.turn.basicUsed ? " — já usada" : ""}. Clique num campeão ou monstro no mapa para ver detalhes.</small>`;
    } else if (ph === "discard") html = "Clique numa carta da mão para descartar.";
  } else html = "Aguarde…";
  A.innerHTML = html;
  const on = (id: string, fn: () => void) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  A.querySelectorAll<HTMLElement>("[data-draw]").forEach((b) => (b.onclick = () => act({ type: "draw", champion: b.dataset.draw })));
  A.querySelectorAll<HTMLElement>("[data-i]").forEach((b) => (b.onclick = () => submitTarget(chooser![Number(b.dataset.i)])));
  A.querySelectorAll<HTMLElement>("[data-nc]").forEach((b) => (b.onclick = () => submitTarget(candidateTargets().filter((t) => !cellOf(t))[Number(b.dataset.nc)])));
  A.querySelectorAll<HTMLElement>("[data-mv]").forEach((b) => (b.onclick = () => { moving = b.dataset.mv!; renderGame(); }));
  A.querySelectorAll<HTMLElement>("[data-stay]").forEach((b) => (b.onclick = () => act({ type: "stay", champion: b.dataset.stay })));
  A.querySelectorAll<HTMLElement>("[data-basic]").forEach((b) => (b.onclick = () => { sel = { kind: "basic", champion: b.dataset.basic! }; renderGame(); }));
  on("cancel", () => { sel = null; chooser = null; renderGame(); });
  on("pass", () => act({ type: "pass" }));
  on("end", () => act({ type: "end" }));
  on("skipdraw", () => act({ type: "skipDraw" }));
}

function renderHand() {
  const H = $("hand");
  const hand: any[] = view.teams[me!].hand;
  const h = hints();
  H.innerHTML = `<b>Sua mão (${hand.length}) · mana ${view.teams[me!].mana}</b>` + hand.map((c) => {
    const d = cards[c.cardId];
    const own = champs[d.owner]?.name ?? "Monstro";
    const ok = h.playable?.[c.uid];
    return `<div class="card ${ok || h.mustDiscard ? "" : "no"} ${d.fast ? "fast" : ""} ${sel && (sel as any).uid === c.uid ? "sel" : ""}" data-u="${c.uid}"><span class="cost">${d.cost}</span><b>${esc(d.name)}</b> <small>${own}${d.fast ? " · rápida" : ""}<br>${esc(d.text)}</small></div>`;
  }).join("");
  H.querySelectorAll<HTMLElement>(".card").forEach((el) => {
    el.onclick = () => {
      const uid = el.dataset.u!;
      if (h.mustDiscard) return act({ type: "discard", card: uid });
      if (!h.playable?.[uid]) return;
      const cands: Target[] = h.targets?.[uid] ?? [];
      if (cands.length === 1 && Object.keys(cands[0]).length === 0) return act({ type: "play", card: uid, target: {} });
      sel = { kind: "card", uid };
      chooser = null;
      renderGame();
    };
  });
}

function renderLog() {
  const L = $("log");
  const atBottom = L.scrollTop + L.clientHeight >= L.scrollHeight - 30;
  L.innerHTML = (view.log as string[]).map((line) => {
    let cls = "sys";
    if (/^Turno da equipe/.test(line)) cls = "turn";
    else if (/sofre \d+ de dano/.test(line)) cls = "dmg";
    else if (/recupera|ganha .* de escudo|cura/.test(line)) cls = "heal";
    else if (/entra no (raio|alcance)|entra no Muro|pisa|atravessa/.test(line)) cls = "zone";
    else if (/ataca|ativa|usa /.test(line)) cls = "atk";
    return `<div class="${cls}">${esc(line)}</div>`;
  }).join("");
  if (atBottom) L.scrollTop = L.scrollHeight;
}

function renderEffects() {
  const E: string[] = [];
  const add = (cls: string, text: string) => E.push(`<div class="e ${cls}">${text}</div>`);
  for (const id of ["A", "B"] as const) {
    for (const c of view.teams[id].champions) {
      if (!c.alive) { add("neutral", `${esc(unitName(c))}: fora da partida, volta em ${c.outTurns} turno(s) da equipe`); continue; }
      for (const s of c.statuses) add(s.negative ? "bad" : "good", `<b>${esc(unitName(c))}</b>: ${esc(STATUS[s.kind] ?? s.kind)}${s.amount ? " " + s.amount : ""} — ${durText(s)}${s.fresh ? " (começa no próximo turno)" : ""}`);
      if (c.shield) add("good", `<b>${esc(unitName(c))}</b>: escudo ${c.shield}${c.reflect ? ` (reflete ${c.reflect})` : ""} até ser gasto`);
      if (c.untargetable) add("good", `<b>${esc(unitName(c))}</b>: intocável até o fim do próprio turno`);
    }
  }
  for (const m of [...view.monsters, ...view.minions]) for (const s of m.statuses ?? []) add("bad", `<b>${esc(unitName(m))}</b>: ${esc(STATUS[s.kind] ?? s.kind)} — ${durText(s)}`);
  const b = view.boss;
  for (const s of b.statuses ?? []) add("bad", `<b>Boss</b>: ${esc(STATUS[s.kind] ?? s.kind)} — ${durText(s)}`);
  if (b.aura) add("bad", `<b>Aura do Boss: ${esc(bossCards[b.aura.cardId]?.name ?? b.aura.cardId)}</b> — ${esc(bossCards[b.aura.cardId]?.text ?? "")}${b.aura.cardsLeft !== undefined ? ` (${b.aura.cardsLeft} cartas restantes)` : " (até outra aura substituir)"}`);
  if (b.damageReduction) add("bad", `<b>Boss</b>: ignora ${b.damageReduction} de dano até a próxima ativação`);
  const groups: Record<string, { n: number; min: number; dmg: number }> = {};
  for (const g of view.ground) {
    const k = g.kind;
    const gr = (groups[k] ??= { n: 0, min: 99, dmg: g.damage });
    gr.n++; gr.min = Math.min(gr.min, g.remaining);
  }
  const gname: Record<string, string> = { fire: "Chão em chamas", fire_wall: "Muro de chamas", slow: "Teia (casas lentas)" };
  for (const [k, gr] of Object.entries(groups)) add("neutral", `${gname[k] ?? k}: ${gr.n} casa(s), ${gr.dmg} de dano, até ${gr.min} rodada(s)`);
  if (view.walls.length) add("neutral", `Paredes: ${view.walls.length} (a mais frágil dura ${Math.min(...view.walls.map((w: any) => w.remaining ?? 99))} rodada(s))`);
  for (const p of view.portals) add("neutral", `Portal (${p.a.x},${p.a.y}) ⇄ (${p.b.x},${p.b.y}): ${p.remaining} rodada(s)`);
  for (const sp of view.springs) add("neutral", `Mola em (${sp.pos.x},${sp.pos.y}): ${sp.remaining} rodada(s)`);
  for (const st of view.structures) add("neutral", `Torre de Vigia (${st.pos.x},${st.pos.y}): ${st.damage} de dano por rodada no alcance ${st.range}`);
  for (const t of view.traps) add("good", `Sua armadilha em (${t.pos.x},${t.pos.y}) (${t.damage} de dano)`);
  for (const w of view.watches) add("good", `Sua Vigia: ${w.damage ?? ""} de dano ao próximo inimigo no alcance ${w.range}`);
  const buff = view.teams[me!].nextCardBuff;
  if (buff) add("good", `Mira Total: próxima carta +${buff.range} alcance, +${buff.damage} dano`);
  $("effects").innerHTML = E.join("") || `<div class="e neutral">Nenhum efeito ativo.</div>`;
}

// ---------- modal de informações ----------
let modalUid: string | null = null;
function closeModal() { modalUid = null; $("modal").style.display = "none"; }
$("modal").onclick = (e) => { if (e.target === $("modal")) closeModal(); };

function openModal(uid: string) {
  const u = unitByUid(uid);
  if (!u) return closeModal();
  modalUid = uid;
  let h = "";
  const statuses = (list: any[]) => list?.length
    ? list.map((s) => `<div class="row2">• <b>${esc(STATUS[s.kind] ?? s.kind)}${s.amount ? " " + s.amount : ""}</b> — ${durText(s)}${s.fresh ? " (começa no próximo turno)" : ""}<div class="sub">${esc(STATUS_HELP[s.kind] ?? "")}</div></div>`).join("")
    : `<div class="sub">Nenhum efeito ativo.</div>`;
  const btns: string[] = [];
  if (u.defId) {
    const d = champs[u.defId];
    const own = u.team === me;
    h += `<h2>${esc(d.name)} <span class="team${u.team}">(equipe ${u.team})</span></h2><div class="sub">${esc(d.role)}</div>`;
    h += `<div class="row2">Vida ${u.hp}/${u.maxHp} · Defesa ${u.defense}${u.shield ? ` · Escudo ${u.shield}` : ""}</div>`;
    h += `<div class="row2"><b>Passiva</b><div class="sub">${esc(PASSIVE[u.defId] ?? d.passive.name)}</div></div>`;
    h += `<div class="row2"><b>Básica: ${esc(d.basic.name)}</b> (alcance ${d.basic.range === "self" ? "pessoal" : d.basic.range})<div class="sub">${esc(BASIC_TEXT[u.defId] ?? "")}</div></div>`;
    if (u.untargetable) h += `<div class="row2">Intocável até o fim do próprio turno.</div>`;
    if (own && view.teams[u.team].decks[u.uid]) h += `<div class="sub">Baralho: ${view.teams[u.team].decks[u.uid].draw} para comprar, ${view.teams[u.team].decks[u.uid].discard} no descarte.</div>`;
    h += `<div class="row2"><b>Efeitos ativos</b>${statuses(u.statuses)}</div>`;
    if (own && myAct()) {
      const r = hints().reach?.[u.uid];
      if (r?.length) btns.push(`<button data-x="mv">Mover este campeão</button>`);
      if ((hints().canStay ?? []).includes(u.uid)) btns.push(`<button data-x="stay">Ficar parado (gasta o movimento${u.statuses.some((s: any) => s.kind === "immobilized") ? " e se solta" : ""})</button>`);
      if (hints().basics?.[u.uid]) btns.push(`<button data-x="basic">Usar ${esc(hints().basics[u.uid].name)}</button>`);
    }
  } else if (u.type) {
    const t = monsterTypes[u.type];
    h += `<h2>${esc(t.name)}</h2><div class="sub">Monstro (${esc(u.uid)})</div>`;
    h += `<div class="row2">Vida ${u.hp}/${u.maxHp} · Defesa ${u.defense}</div>`;
    h += `<div class="row2"><b>Ataque</b>: ${t.attack} de dano em quem terminar o movimento a até ${t.range} casa(s) dele.<div class="sub">O raio está marcado no mapa.</div></div>`;
    h += `<div class="row2"><b>Efeito contínuo</b><div class="sub">${esc(MONSTER_EFFECT[t.continuous_effect.type] ?? t.continuous_effect.type)}</div></div>`;
    h += `<div class="row2"><b>Recompensa</b>: carta "${esc(cards[t.reward_card]?.name ?? t.reward_card)}" para quem der o último golpe.</div>`;
    h += `<div class="row2"><b>Efeitos ativos</b>${statuses(u.statuses)}</div>`;
  } else if (u.uid === "boss") {
    h += `<h2>Boss</h2><div class="sub">Quem der o último golpe vence.</div><div class="row2">Vida ${u.hp}/${u.maxHp} · Defesa ${u.defense}</div>`;
    h += `<div class="row2"><b>Ativação</b>: no início do turno de quem tiver um campeão a até ${u.range} casas dele, o boss compra uma carta.<div class="sub">Baralho do boss: ${u.deck} cartas.</div></div>`;
    if (u.aura) h += `<div class="row2"><b>Aura ativa: ${esc(bossCards[u.aura.cardId]?.name ?? u.aura.cardId)}</b><div class="sub">${esc(bossCards[u.aura.cardId]?.text ?? "")}</div></div>`;
    h += `<div class="row2"><b>Efeitos ativos</b>${statuses(u.statuses)}</div>`;
  } else {
    h += `<h2>Lacaio do Boss</h2><div class="row2">Vida ${u.hp}/${u.maxHp} · ataca com ${u.damage} de dano quem estiver adjacente.</div>`;
  }
  $("modalbox").innerHTML = h + `<div class="row" style="margin-top:10px">${btns.join("")}<button id="mclose">Fechar</button></div>`;
  $("modal").style.display = "flex";
  $("mclose").onclick = closeModal;
  document.querySelectorAll<HTMLElement>("#modalbox [data-x]").forEach((b) => (b.onclick = () => {
    const x = b.dataset.x;
    closeModal();
    if (x === "mv") { moving = uid; sel = null; renderGame(); }
    else if (x === "stay") act({ type: "stay", champion: uid });
    else if (x === "basic") { sel = { kind: "basic", champion: uid }; renderGame(); }
  }));
}

connect();
renderLobby();
