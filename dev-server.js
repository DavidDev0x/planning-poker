// Servidor de desenvolvimento local (Node puro, sem dependências).
// - Serve os arquivos de public/ e as mesmas rotas /api/* usadas na Vercel.
// - Sem Supabase configurado, usa armazenamento em memória e SSE (/api/events)
//   para simular o tempo real e a presença (online/offline).
//
// Uso: npm run dev   (porta padrão 3000; altere com PORT=xxxx)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionHandler,
  configHandler,
  createRoomHandler,
  getRoomHandler,
  sendJson,
} from './lib/handlers.js';
import { getStore } from './lib/store.js';
import { normalizeRoomId } from './lib/roomLogic.js';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const API = {
  '/api/config': configHandler,
  '/api/rooms': createRoomHandler,
  '/api/room': getRoomHandler,
  '/api/action': actionHandler,
};

// ---------------------------------------------------------------- presença (SSE)

/** roomId → Map(connectionId → { res, pid }) */
const presence = new Map();
let connectionSeq = 0;

function onlineIds(roomId) {
  const conns = presence.get(roomId);
  return conns ? [...new Set([...conns.values()].map((c) => c.pid).filter(Boolean))] : [];
}

function broadcastPresence(roomId) {
  const conns = presence.get(roomId);
  if (!conns) return;
  const data = `event: presence\ndata: ${JSON.stringify(onlineIds(roomId))}\n\n`;
  for (const c of conns.values()) c.res.write(data);
}

function handleEvents(req, res, url) {
  const store = getStore();
  if (store.kind !== 'memory') return sendJson(res, 404, { error: 'Use o Supabase Realtime.' });
  const roomId = normalizeRoomId(url.searchParams.get('room'));
  if (!roomId) return sendJson(res, 400, { error: 'Sala inválida.' });
  const pid = url.searchParams.get('pid') || null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');

  const id = ++connectionSeq;
  if (!presence.has(roomId)) presence.set(roomId, new Map());
  presence.get(roomId).set(id, { res, pid });

  const unsubscribe = store.subscribe(roomId, ({ event, payload }) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  });
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  broadcastPresence(roomId);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    const conns = presence.get(roomId);
    conns?.delete(id);
    if (conns && conns.size === 0) presence.delete(roomId);
    broadcastPresence(roomId);
  });
}

// ---------------------------------------------------------------- estáticos

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (/^\/room\/[^/]+\/?$/.test(rel)) rel = '/room.html';
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR.replace(/[\\/]$/, '') + sep) && filePath !== PUBLIC_DIR) {
    return sendJson(res, 403, { error: 'Proibido.' });
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    const body = await readFile(join(PUBLIC_DIR, '404.html')).catch(() => 'Não encontrado');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }
}

// ---------------------------------------------------------------- servidor

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/events') return handleEvents(req, res, url);
    const handler = API[url.pathname];
    if (handler) return handler(req, res);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Rota não encontrada.' });
    return serveStatic(res, url.pathname);
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const server = await startServer();
  const { port } = server.address();
  const mode = getStore().kind === 'memory' ? 'memória local (sem Supabase)' : 'Supabase';
  console.log(`\n🃏 Planning Poker rodando em http://localhost:${port}  [modo: ${mode}]\n`);
}
