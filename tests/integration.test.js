// Testes de concorrência e integração: 15 clientes simultâneos contra o servidor local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, mutateRoom, setStore } from '../lib/store.js';
import { applyAction, createRoom, joinRoom } from '../lib/roomLogic.js';

test('15 votos simultâneos não se perdem (controle otimista)', async () => {
  const store = new MemoryStore();
  const room = createRoom({ roomName: 'Concorrência' });
  const people = Array.from({ length: 15 }, (_, i) => joinRoom(room, { name: `U${i}` }));
  await store.create(room.id, room);
  const cards = ['1', '2', '3', '5', '8'];
  await Promise.all(
    people.map((p, i) =>
      mutateRoom(store, room.id, (r) =>
        applyAction(r, { type: 'vote', ...p, value: cards[i % cards.length] }),
      ),
    ),
  );
  const { state, version } = await store.get(room.id);
  assert.equal(Object.keys(state.round.votes).length, 15);
  assert.equal(version, 16);
});

// ---------------------------------------------------------------- integração HTTP + SSE

let server;
let base;

before(async () => {
  setStore(new MemoryStore());
  const { startServer } = await import('../dev-server.js');
  server = await startServer(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
});

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/** Cliente SSE mínimo que guarda o último estado recebido. */
async function sseClient(roomId, pid) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events?room=${roomId}&pid=${pid}`, { signal: controller.signal });
  const client = { last: null, presence: [], close: () => controller.abort() };
  (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || !data) continue;
          if (event === 'state') {
            const s = JSON.parse(data);
            if (!client.last || s.version >= client.last.version) client.last = s;
          }
          if (event === 'presence') client.presence = JSON.parse(data);
        }
      }
    } catch {
      /* abortado */
    }
  })();
  return client;
}

const waitFor = async (fn, ms = 3000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

test('integração: 15 participantes simultâneos + 16º recusado', async () => {
  const created = await post('/api/rooms', { roomName: 'Sprint 42', name: 'Facilitadora', deckId: 'fibonacci' });
  assert.equal(created.status, 201);
  const { roomId } = created.data;
  const members = [{ participantId: created.data.participantId, secret: created.data.secret }];

  // 14 pessoas entram ao mesmo tempo
  const joins = await Promise.all(
    Array.from({ length: 14 }, (_, i) => post('/api/action', { roomId, type: 'join', name: `Dev ${i + 1}` })),
  );
  for (const j of joins) {
    assert.equal(j.status, 200, JSON.stringify(j.data));
    members.push({ participantId: j.data.result.participantId, secret: j.data.result.secret });
  }

  const full = await post('/api/action', { roomId, type: 'join', name: 'Atrasado' });
  assert.equal(full.status, 409);
  assert.equal(full.data.code, 'ROOM_FULL');

  const clients = await Promise.all(members.map((m) => sseClient(roomId, m.participantId)));
  assert.ok(await waitFor(() => clients.every((c) => c.presence.length === 15)), 'presença de 15');

  // Todos votam ao mesmo tempo
  const cards = ['3', '5', '8'];
  const votes = await Promise.all(
    members.map((m, i) => post('/api/action', { roomId, ...m, type: 'vote', value: cards[i % 3] })),
  );
  votes.forEach((v) => assert.equal(v.status, 200, JSON.stringify(v.data)));
  assert.ok(await waitFor(() => clients.every((c) => c.last?.round.voteCount === 15)), 'todos veem 15 votos');
  assert.ok(clients.every((c) => c.last.round.votes === null), 'votos ocultos');

  // Facilitadora revela
  const rev = await post('/api/action', { roomId, ...members[0], type: 'reveal' });
  assert.equal(rev.status, 200);
  assert.ok(await waitFor(() => clients.every((c) => c.last?.round.revealed)), 'todos veem revelação');
  const avg = clients[0].last.round.stats.average;
  assert.ok(clients.every((c) => c.last.round.stats.average === avg));
  assert.equal(Object.keys(clients[0].last.round.votes).length, 15);

  // Estado consultado por GET coincide
  const res = await fetch(`${base}/api/room?id=${roomId}&pid=${members[3].participantId}&secret=${members[3].secret}`);
  const got = await res.json();
  assert.equal(got.isMember, true);
  assert.equal(got.state.myVote, '3');

  clients.forEach((c) => c.close());
});

test('integração: erros de validação', async () => {
  const bad = await post('/api/rooms', { roomName: 'X' });
  assert.equal(bad.status, 400);
  const notFound = await fetch(`${base}/api/room?id=ZZZZZZ`);
  assert.equal(notFound.status, 404);
  const invalid = await fetch(`${base}/api/room?id=../etc`);
  assert.equal(invalid.status, 400);
});
