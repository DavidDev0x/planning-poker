// Handlers HTTP compartilhados entre as Vercel Functions (api/*.js) e o servidor local.
// Usam apenas a API básica do Node (req/res), compatível com os dois ambientes.

import {
  RoomError,
  applyAction,
  createRoom,
  joinRoom,
  normalizeRoomId,
  sanitizeRoom,
} from './roomLogic.js';
import { getStore, mutateRoom, readSupabaseEnv } from './store.js';

const MAX_BODY = 64 * 1024;

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RoomError('Requisição muito grande.', 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function wrap(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return sendJson(res, 405, { error: 'Método não permitido.' });
    }
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof RoomError) {
        return sendJson(res, err.status, { error: err.message, code: err.code });
      }
      if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'JSON inválido.' });
      console.error(err);
      return sendJson(res, 500, { error: 'Erro interno do servidor.' });
    }
  };
}

function requireRoomId(value) {
  const id = normalizeRoomId(value);
  if (!id) throw new RoomError('Código de sala inválido.', 400, 'INVALID_ROOM');
  return id;
}

// GET /api/config → informa ao navegador como se conectar ao tempo real.
export const configHandler = wrap(['GET'], async (_req, res) => {
  const env = readSupabaseEnv();
  if (env.configured) {
    return sendJson(res, 200, { mode: 'supabase', supabaseUrl: env.url, supabaseKey: env.publicKey });
  }
  if (process.env.VERCEL) {
    return sendJson(res, 500, {
      error: 'Supabase não configurado. Veja o README para definir as variáveis de ambiente.',
      code: 'NOT_CONFIGURED',
    });
  }
  return sendJson(res, 200, { mode: 'local' });
});

// POST /api/rooms → cria uma sala e já inclui o criador como facilitador.
export const createRoomHandler = wrap(['POST'], async (req, res) => {
  const body = await readBody(req);
  const store = getStore();
  const now = Date.now();
  const roomName = body.roomName || body.name;
  const userName = body.userName || (body.roomName ? body.name : undefined);
  let room;
  let creds;
  for (let i = 0; i < 5; i++) {
    room = createRoom({ roomName, deckId: body.deckId, customCards: body.customCards }, now);
    creds = joinRoom(room, { name: userName, role: 'facilitator' }, now);
    if (await store.create(room.id, room)) break;
    room = null;
  }
  if (!room) throw new RoomError('Não foi possível gerar um código de sala. Tente novamente.', 503);
  // Limpeza oportunista de salas abandonadas (não bloqueia a resposta em caso de erro).
  store.cleanup().catch(() => {});
  sendJson(res, 201, {
    roomId: room.id,
    participantId: creds.participantId,
    secret: creds.secret,
    state: sanitizeRoom(room, { version: 1, viewerId: creds.participantId, now }),
  });
});

// GET /api/room?id=XXXX&pid=...&secret=... → estado atual (com o seu voto, se autenticado).
export const getRoomHandler = wrap(['GET'], async (req, res) => {
  const q = getQuery(req);
  const roomId = requireRoomId(q.id);
  const rec = await getStore().get(roomId);
  if (!rec) throw new RoomError('Sala não encontrada.', 404, 'ROOM_NOT_FOUND');
  const me = rec.state.participants.find((p) => p.id === q.pid && p.secret === q.secret);
  sendJson(res, 200, {
    state: sanitizeRoom(rec.state, { version: rec.version, viewerId: me ? me.id : null }),
    isMember: Boolean(me),
  });
});

// POST /api/action → aplica uma ação e publica o novo estado para a sala.
export const actionHandler = wrap(['POST'], async (req, res) => {
  const body = await readBody(req);
  const roomId = requireRoomId(body.roomId);
  if (typeof body.type !== 'string') throw new RoomError('Ação inválida.');
  const store = getStore();
  const now = Date.now();
  const { state, version, result } = await mutateRoom(store, roomId, (room) =>
    applyAction(room, body, now),
  );
  const viewerId = body.type === 'join' ? result.participantId : body.participantId;
  await store.publish(roomId, 'state', sanitizeRoom(state, { version, now }));
  sendJson(res, 200, {
    result,
    state: sanitizeRoom(state, { version, viewerId: body.type === 'leave' ? null : viewerId, now }),
  });
});
