// Persistência das salas + publicação de eventos em tempo real.
// - SupabaseStore: Postgres (via PostgREST) + Realtime Broadcast (via REST).
// - MemoryStore: para desenvolvimento local e testes (sem Supabase).

import { EventEmitter } from 'node:events';
import { RoomError } from './roomLogic.js';

export const ROOM_TTL_DAYS = 7;

export function readSupabaseEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
  const publicKey =
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    '';
  return {
    url: url.replace(/\/+$/, ''),
    serviceKey,
    publicKey,
    configured: Boolean(url && serviceKey && publicKey),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ memória

export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.rooms = new Map();
    this.events = new EventEmitter();
    this.events.setMaxListeners(1000);
  }

  async create(id, state) {
    await sleep(0);
    if (this.rooms.has(id)) return false;
    this.rooms.set(id, { state: structuredClone(state), version: 1, updatedAt: Date.now() });
    return true;
  }

  async get(id) {
    await sleep(0);
    const rec = this.rooms.get(id);
    return rec ? { state: structuredClone(rec.state), version: rec.version } : null;
  }

  async save(id, state, expectedVersion) {
    await sleep(0);
    const rec = this.rooms.get(id);
    if (!rec || rec.version !== expectedVersion) return false;
    this.rooms.set(id, { state: structuredClone(state), version: expectedVersion + 1, updatedAt: Date.now() });
    return true;
  }

  async cleanup(maxAgeMs = ROOM_TTL_DAYS * 864e5) {
    const limit = Date.now() - maxAgeMs;
    for (const [id, rec] of this.rooms) if (rec.updatedAt < limit) this.rooms.delete(id);
  }

  async publish(roomId, event, payload) {
    this.events.emit(`room:${roomId}`, { event, payload });
  }

  subscribe(roomId, fn) {
    const key = `room:${roomId}`;
    this.events.on(key, fn);
    return () => this.events.off(key, fn);
  }
}

// ------------------------------------------------------------------ supabase

export class SupabaseStore {
  constructor({ url, serviceKey }) {
    this.kind = 'supabase';
    this.url = url;
    this.key = serviceKey;
  }

  headers(extra = {}) {
    const h = { apikey: this.key, 'Content-Type': 'application/json', ...extra };
    // Chaves legadas (JWT) também exigem o header Authorization.
    if (this.key.startsWith('eyJ')) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  async rest(path, init = {}) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: this.headers(init.headers),
    });
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '');
      console.error('[supabase]', res.status, body);
      throw new RoomError('Erro ao acessar o banco de dados.', 502, 'DB_ERROR');
    }
    return res;
  }

  async create(id, state) {
    const res = await this.rest('rooms', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id, state, version: 1 }),
    });
    return res.status !== 409;
  }

  async get(id) {
    const res = await this.rest(`rooms?id=eq.${encodeURIComponent(id)}&select=state,version`);
    const rows = await res.json();
    return rows[0] ?? null;
  }

  async save(id, state, expectedVersion) {
    const res = await this.rest(
      `rooms?id=eq.${encodeURIComponent(id)}&version=eq.${expectedVersion}&select=version`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ state, version: expectedVersion + 1, updated_at: new Date().toISOString() }),
      },
    );
    const rows = await res.json();
    return rows.length === 1;
  }

  async cleanup(maxAgeMs = ROOM_TTL_DAYS * 864e5) {
    const limit = new Date(Date.now() - maxAgeMs).toISOString();
    await this.rest(`rooms?updated_at=lt.${encodeURIComponent(limit)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch((err) => console.error('[cleanup]', err.message));
  }

  async publish(roomId, event, payload) {
    const topic = encodeURIComponent(`room:${roomId}`);
    try {
      const res = await fetch(`${this.url}/realtime/v1/api/broadcast/${topic}/events/${event}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) console.error('[broadcast]', res.status, await res.text().catch(() => ''));
    } catch (err) {
      // Falha no broadcast não invalida a ação: os clientes ressincronizam sozinhos.
      console.error('[broadcast]', err.message);
    }
  }
}

// ------------------------------------------------------------------ fábrica

let singleton = null;

export function getStore() {
  if (singleton) return singleton;
  const env = readSupabaseEnv();
  if (env.configured) {
    singleton = new SupabaseStore(env);
  } else if (process.env.VERCEL) {
    throw new RoomError(
      'Supabase não configurado. Defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY na Vercel.',
      500,
      'NOT_CONFIGURED',
    );
  } else {
    singleton = new MemoryStore();
  }
  return singleton;
}

export function setStore(store) {
  singleton = store;
}

/**
 * Lê a sala, aplica `mutator` numa cópia e grava com controle de concorrência
 * otimista (versão). Em caso de conflito, tenta novamente.
 */
export async function mutateRoom(store, roomId, mutator, { attempts = 30 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const rec = await store.get(roomId);
    if (!rec) throw new RoomError('Sala não encontrada.', 404, 'ROOM_NOT_FOUND');
    const state = structuredClone(rec.state);
    const result = mutator(state);
    if (await store.save(roomId, state, rec.version)) {
      return { state, version: rec.version + 1, result };
    }
    // Backoff aleatório (limitado) para espalhar as tentativas concorrentes.
    await sleep(5 + Math.random() * Math.min(250, 25 * (i + 1)));
  }
  throw new RoomError('Muitas alterações simultâneas. Tente novamente.', 503, 'CONFLICT');
}
