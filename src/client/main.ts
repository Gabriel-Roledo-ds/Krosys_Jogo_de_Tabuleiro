import cardsData from "../../data/cards.json";
import champsData from "../../data/champions.json";
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
let sel: { kind: "card"; uid: string } | { kind: "basic" } | null = null;
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
const board = createBoard($("board"), (x, y) => onCell(x, y));

function allUnits(): any[] {
  const u: any[] = [];
  for (const t of ["A", "B"]) u.push(...view.teams[t].champions.filter((c: any) => c.alive));
  u.push(...view.monsters.filter((m: any) => m.alive), ...view.minions.filter((m: any) => m.alive));
  if (view.boss.alive) u.push(view.boss);
  return u;
}
const unitByUid = (uid: string) => allUnits().find((u) => u.uid === uid) ?? [...view.teams.A.champions, ...view.teams.B.champions].find((c: any) => c.uid === uid);
const mainChamp = () => (view.turn.main ? unitByUid(view.turn.main) : null);
const isMyTurn = () => view.awaiting.team === me && view.awaiting.kind !== "over";
const myAct = () => isMyTurn() && !view.pending && view.turn.phase === "act";

function candidateTargets(): Target[] {
  if (!sel) return [];
  return sel.kind === "basic" ? view.hints.basic?.targets ?? [] : view.hints.targets?.[sel.uid] ?? [];
}
function cellOf(t: Target): Pos | null {
  if (t.uid) { const u = unitByUid(t.uid); return u && (u.alive !== false) ? u.pos : null; }
  if (t.pos) return t.pos;
  if (t.uid2) return unitByUid(t.uid2)?.pos ?? null;
  if (t.dir) { const m = mainChamp(); const owner = sel?.kind === "card" ? unitByUid(view.teams[me!].hand.find((c: any) => c.uid === (sel as any).uid)?.owner) : m; return owner ? { x: owner.pos.x + t.dir.x, y: owner.pos.y + t.dir.y } : null; }
  return null;
}
function describe(t: Target): string {
  const parts: string[] = [];
  const nameOf = (uid?: string) => { const u = uid && unitByUid(uid); return u ? (u.defId ? champs[u.defId].name : u.uid === "boss" ? "Boss" : u.type ? "Monstro" : "Lacaio") : ""; };
  if (t.uid) parts.push(nameOf(t.uid));
  if (t.uid2) parts.push(nameOf(t.uid2));
  if (t.pos) parts.push(`(${t.pos.x},${t.pos.y})`);
  if (t.pos2) parts.push(`→(${t.pos2.x},${t.pos2.y})`);
  if (t.dir) parts.push(`dir ${t.dir.x},${t.dir.y}`);
  return parts.join(" ") || "Confirmar";
}
function submitTarget(t: Target) {
  if (!sel) return;
  if (sel.kind === "basic") act({ type: "basic", target: t });
  else act({ type: "play", card: sel.uid, target: t });
}

function onCell(x: number, y: number) {
  if (!view) return;
  if (sel) {
    const cands = candidateTargets();
    const here = cands.filter((t) => { const c = cellOf(t); return c && c.x === x && c.y === y; });
    if (here.length === 1) return submitTarget(here[0]);
    if (here.length > 1) { chooser = here; return renderActions(); }
    const kind = sel.kind === "basic" ? view.hints.basic?.target : cards[view.teams[me!].hand.find((c: any) => c.uid === (sel as any).uid)?.cardId]?.target;
    if (kind === "cell") return submitTarget({ pos: { x, y } });
    return;
  }
  if (myAct() && view.hints.reach?.some((c: any) => c.pos.x === x && c.pos.y === y)) act({ type: "move", to: { x, y } });
}

function highlights(): Highlights {
  const reach = new Set<string>(), targets = new Set<string>();
  if (sel) for (const t of candidateTargets()) { const c = cellOf(t); if (c) targets.add(key(c.x, c.y)); }
  else if (myAct()) for (const c of view.hints.reach ?? []) reach.add(key(c.pos.x, c.pos.y));
  return { reach, targets, main: view.turn.main };
}

function renderGame() {
  $("lobby").style.display = "none";
  $("game").style.display = "grid";
  board.render(view, highlights());
  renderStatus(); renderTeams(); renderActions(); renderHand();
  $("log").textContent = view.log.join("\n");
  $("log").scrollTop = 1e9;
}

function renderStatus() {
  const t = view.turn;
  let msg: string;
  if (view.winner) msg = view.winner === me ? "🏆 VOCÊ VENCEU!" : "Derrota: o outro time deu o último golpe.";
  else if (view.pending) msg = view.pending.priority === me ? "⚡ Você pode responder com uma carta rápida." : "Aguardando resposta do adversário…";
  else if (t.team === me) msg = ({ draw: "Sua vez: compre uma carta.", choose: "Escolha o campeão principal.", act: "Ação: mova, use cartas e a habilidade básica.", discard: "Mão cheia: descarte uma carta.", boss: "O boss age…" } as any)[t.phase] ?? "";
  else msg = "Vez do adversário…";
  $("status").innerHTML = `<b class="team${me}">Você: equipe ${me}</b> · Rodada ${view.round} · Turno da equipe <b class="team${t.team}">${t.team}</b><div id="msg">${esc(msg)}</div>
    <div>Boss: ${view.boss.hp}/${view.boss.maxHp} PV${view.boss.aura ? " · aura: " + esc(view.boss.aura.cardId) : ""}</div>`;
}

function renderTeams() {
  $("teams").innerHTML = (["A", "B"] as const).map((id) => {
    const t = view.teams[id];
    return `<div><b class="team${id}">Equipe ${id}</b> · mana ${t.mana} · mão ${t.handCount}` +
      t.champions.map((c: any) => `<div>${c.uid === view.turn.main ? "★ " : ""}${champs[c.defId].name} ${c.alive ? `${c.hp}/${c.maxHp}` : "☠"}${c.shield ? ` 🛡${c.shield}` : ""}
        <div class="bar"><i style="width:${c.alive ? (100 * c.hp) / c.maxHp : 0}%"></i></div>
        ${c.statuses.map((s: any) => `<span class="tag">${esc(s.kind)}${s.amount ? " " + s.amount : ""}·${s.remaining}</span>`).join("")}</div>`).join("") + "</div>";
  }).join("<hr>");
}

function renderActions() {
  const A = $("actions");
  const h = view.hints ?? {};
  let html = "";
  if (view.winner) html = `<button onclick="location.reload()">Voltar ao início</button>`;
  else if (chooser) {
    html = "Qual opção?" + chooser.map((t, i) => `<div><button data-i="${i}">${esc(describe(t))}</button></div>`).join("") + `<button id="cancel">Cancelar</button>`;
  } else if (sel) {
    const noCell = candidateTargets().filter((t) => !cellOf(t));
    html = "Clique numa casa destacada." + noCell.map((t, i) => `<div><button data-nc="${i}">${esc(describe(t))}</button></div>`).join("") + `<div><button id="cancel">Cancelar</button></div>`;
  } else if (view.pending && view.pending.priority === me) {
    const top = view.pending.stack[view.pending.stack.length - 1];
    html = `Em jogo: ${esc(cards[top.cardId.replace(/^basic:/, "")]?.name ?? top.cardId)}<div><button id="pass">Passar</button></div>`;
  } else if (isMyTurn() && !view.pending) {
    const ph = view.turn.phase;
    if (ph === "draw" || ph === "choose") {
      html = (ph === "draw" ? "Comprar do baralho de:" : "Campeão principal:") + view.teams[me!].champions.filter((c: any) => c.alive || ph === "draw").map((c: any) =>
        `<div><button data-${ph}="${c.uid}" ${ph === "draw" && view.teams[me!].decks[c.uid]?.draw === 0 ? "disabled" : ""}>${champs[c.defId].name}${ph === "draw" ? ` (${view.teams[me!].decks[c.uid]?.draw} no baralho)` : ""}</button></div>`).join("");
    } else if (ph === "act") {
      const m = mainChamp();
      html = `Principal: <b>${m ? champs[m.defId].name : "?"}</b> · dado ${view.turn.die ?? "-"} · movimento restante ${view.turn.movementLeft}<div class="row">
        <button id="basic" ${h.canBasic ? "" : "disabled"}>${esc(h.basic?.name ?? "Habilidade básica")}</button><button id="end">Encerrar turno</button></div><small>Clique numa casa azul para andar.</small>`;
    } else if (ph === "discard") html = "Clique numa carta da mão para descartar.";
  } else html = "Aguarde…";
  A.innerHTML = html;
  A.querySelectorAll<HTMLElement>("[data-draw]").forEach((b) => (b.onclick = () => act({ type: "draw", champion: b.dataset.draw })));
  A.querySelectorAll<HTMLElement>("[data-choose]").forEach((b) => (b.onclick = () => act({ type: "choose", champion: b.dataset.choose })));
  A.querySelectorAll<HTMLElement>("[data-i]").forEach((b) => (b.onclick = () => submitTarget(chooser![Number(b.dataset.i)])));
  A.querySelectorAll<HTMLElement>("[data-nc]").forEach((b) => (b.onclick = () => submitTarget(candidateTargets().filter((t) => !cellOf(t))[Number(b.dataset.nc)])));
  const on = (id: string, fn: () => void) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  on("cancel", () => { sel = null; chooser = null; renderGame(); });
  on("pass", () => act({ type: "pass" }));
  on("end", () => act({ type: "end" }));
  on("basic", () => { sel = { kind: "basic" }; renderGame(); });
}

function renderHand() {
  const H = $("hand");
  const hand: any[] = view.teams[me!].hand;
  const h = view.hints ?? {};
  H.innerHTML = `<b>Sua mão (${hand.length}) · mana ${view.teams[me!].mana}</b>` + hand.map((c) => {
    const d = cards[c.cardId];
    const own = champs[d.owner]?.name ?? "Monstro";
    const ok = h.playable?.[c.uid];
    return `<div class="card ${ok ? "" : "no"} ${d.fast ? "fast" : ""} ${sel && (sel as any).uid === c.uid ? "sel" : ""}" data-u="${c.uid}"><span class="cost">${d.cost}</span><b>${esc(d.name)}</b> <small>${own}${d.fast ? " · rápida" : ""}<br>${esc(d.text)}</small></div>`;
  }).join("");
  H.querySelectorAll<HTMLElement>(".card").forEach((el) => {
    el.onclick = () => {
      const uid = el.dataset.u!;
      if (h.mustDiscard) return act({ type: "discard", card: uid });
      if (!h.playable?.[uid]) return;
      const cands: Target[] = h.targets?.[uid] ?? [];
      if (cands.length === 1 && !cellOf.call(null, cands[0] as any) && Object.keys(cands[0]).length === 0) return act({ type: "play", card: uid, target: {} });
      sel = { kind: "card", uid };
      chooser = null;
      renderGame();
    };
  });
}

connect();
renderLobby();
