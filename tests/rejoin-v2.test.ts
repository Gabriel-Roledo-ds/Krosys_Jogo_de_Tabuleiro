// Teste de reconexão com dois clientes WebSocket DE VERDADE (não mock), contra o
// servidor v2 de verdade (src/server/index-v2.ts) — item 41 do KANBAN. Sobe o
// servidor numa porta efêmera (porta 0, o sistema operacional escolhe uma livre),
// conecta dois clientes `ws`, joga uma partida de verdade até o meio, desconecta
// um dos dois (fecha o socket sem avisar, simulando queda de conexão/aba fechada)
// e reconecta com "rejoin" + o token recebido no "joined" original — confirmando
// que o jogador retomado volta a ver o estado real da partida e consegue agir.

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServerV2 } from "../src/server/index-v2";
import type { AddressInfo } from "node:net";

/**
 * Embrulha um WebSocket cliente guardando TODA mensagem recebida numa fila, desde a
 * conexão. Sem isso, um `await` entre duas mensagens perde a seguinte quando o servidor
 * emite várias em sequência síncrona (um broadcast manda lobby+state de uma vez) antes do
 * teste religar um novo listener — a fila absorve isso.
 *
 * `next(predicate)` exige um PREDICADO específico sobre o CONTEÚDO da mensagem, nunca só
 * o tipo (`m.t === "lobby"`) — um filtro só por tipo combina com uma mensagem antiga e
 * ainda não consumida da fila (ex. o "lobby" do broadcast de entrada na sala, disparado
 * bem antes do "lobby" de verdade que confirma um setComp), fazendo o teste seguir adiante
 * acreditando ter confirmação de algo que o servidor ainda nem processou.
 */
let clientCounter = 0;

class Client {
  private queue: any[] = [];
  private waiters: ((msg: any) => void)[] = [];
  readonly ws: WebSocket;
  readonly label = `c${++clientCounter}`;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  static async connect(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new Client(ws);
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Consome (e descarta) mensagens da fila até achar uma que satisfaça o predicado. */
  async next(predicate: (m: any) => boolean = () => true, timeoutMs = 5000): Promise<any> {
    for (;;) {
      const msg = await this.pop(timeoutMs);
      if (predicate(msg)) return msg;
    }
  }

  private pop(timeoutMs: number): Promise<any> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(onMsg);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`Timeout esperando mensagem do servidor v2 (${this.label})`));
      }, timeoutMs);
      const onMsg = (msg: any) => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.waiters.push(onMsg);
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe("reconexão com dois clientes reais (servidor v2)", () => {
  let server: ReturnType<typeof createServerV2> | null = null;
  const clients: Client[] = [];

  async function connect(url: string): Promise<Client> {
    const c = await Client.connect(url);
    clients.push(c);
    return c;
  }

  afterEach(async () => {
    for (const c of clients) if (c.ws.readyState === c.ws.OPEN) c.close();
    clients.length = 0;
    if (server) {
      await new Promise<void>((resolve) => server!.wss.close(() => resolve()));
      await new Promise<void>((resolve) => server!.http.close(() => resolve()));
      server = null;
    }
  });

  it("jogador que cai no meio da partida reconecta com o token e retoma o estado real", async () => {
    server = createServerV2({ port: 0 });
    const port = (server.http.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await connect(url);
    a.send({ t: "create", name: "Jogador 1" });
    const joinedA = await a.next((m) => m.t === "joined");
    expect(joinedA.team).toBe("A");
    const code = joinedA.code as string;

    let b = await connect(url);
    b.send({ t: "join", code, name: "Jogador 2" });
    const joinedB = await b.next((m) => m.t === "joined");
    expect(joinedB.team).toBe("B");
    const tokenB = joinedB.token as string;

    // escolhe campeões (mesmas composições usadas na simulação, tests/sim-v2.test.ts) — o
    // predicado confere o próprio conteúdo do lobby (comp já preenchido), não só o tipo,
    // porque já existe um "lobby" mais antigo (do broadcast de entrada) ainda na fila.
    a.send({ t: "setComp", comp: ["niara", "varek", "selene"] });
    await a.next((m) => m.t === "lobby" && m.lobby.seats.A?.comp?.length === 3);
    b.send({ t: "setComp", comp: ["borak", "dorin", "aurelia"] });
    await b.next((m) => m.t === "lobby" && m.lobby.seats.B?.comp?.length === 3);

    a.send({ t: "start" });
    const stateA1 = await a.next((m) => m.t === "state");
    const stateB1 = await b.next((m) => m.t === "state");
    expect(stateA1.view.round).toBe(1);
    expect(stateB1.view.round).toBe(1);

    // B cai (fecha o socket sem mandar nada — igual a aba fechada/rede caindo)
    b.close();
    await new Promise((r) => setTimeout(r, 50));

    // A continua jogando sozinho nesse meio tempo (só confirma que a sala não travou)
    a.send({ t: "ping" });
    expect((await a.next((m) => m.t === "pong")).t).toBe("pong");

    // B reconecta com um socket NOVO e o token recebido no "joined" original
    b = await connect(url);
    b.send({ t: "rejoin", code, token: tokenB });
    const rejoinedB = await b.next((m) => m.t === "joined");
    expect(rejoinedB.team).toBe("B");
    expect(rejoinedB.token).toBe(tokenB);

    // o estado devolvido na reconexão é o estado REAL da partida (não um lobby vazio)
    const stateB2 = await b.next((m) => m.t === "state");
    expect(stateB2.view.round).toBeGreaterThanOrEqual(1);
    expect(stateB2.view.teams.B.champions).toHaveLength(3);
    expect(stateB2.view.teams.B.champions.map((c: any) => c.defId).sort()).toEqual(["aurelia", "borak", "dorin"]);

    // depois de reconectar, B age de novo normalmente (sem erro de "sala não encontrada"/token inválido)
    b.send({ t: "ping" });
    expect((await b.next((m) => m.t === "pong")).t).toBe("pong");
  });

  it("token errado na reconexão não assume o lugar de outro jogador", async () => {
    server = createServerV2({ port: 0 });
    const port = (server.http.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await connect(url);
    a.send({ t: "create", name: "Jogador 1" });
    const joinedA = await a.next((m) => m.t === "joined");
    const code = joinedA.code as string;

    const intruder = await connect(url);
    intruder.send({ t: "rejoin", code, token: "token-que-nao-existe" });
    const rejected = await intruder.next();
    expect(rejected.t).toBe("rejoin_failed");
  });

  it("sala inexistente na reconexão devolve rejoin_failed, sem derrubar o servidor", async () => {
    server = createServerV2({ port: 0 });
    const port = (server.http.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const c = await connect(url);
    c.send({ t: "rejoin", code: "ZZZZ", token: "qualquer" });
    const resp = await c.next();
    expect(resp.t).toBe("rejoin_failed");
  });
});
