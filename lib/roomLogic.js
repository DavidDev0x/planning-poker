// Lógica de domínio do Planning Poker (pura, sem rede/banco).
// Todas as funções recebem/alteram um objeto "room" serializável em JSON.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { buildDeck, computeStats, SPECIAL_CARDS } from './decks.js';

export const MAX_PARTICIPANTS = 15;
export const MAX_STORIES = 300;
export const MAX_NAME = 30;
export const MAX_ROOM_NAME = 60;
export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_LINK = 500;
export const FACILITATOR_IDLE_MS = 2 * 60 * 1000;

export class RoomError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomId(length = 6) {
  const bytes = randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) id += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  return id;
}

export function normalizeRoomId(id) {
  const clean = String(id ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(clean) ? clean : null;
}

const newId = () => randomUUID().replace(/-/g, '').slice(0, 16);
const newSecret = () => randomBytes(24).toString('base64url');

// ---------------------------------------------------------------- validação

function cleanText(value, max, field, { required = false } = {}) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !text) throw new RoomError(`${field} é obrigatório.`);
  if (text.length > max) throw new RoomError(`${field} deve ter no máximo ${max} caracteres.`);
  return text;
}

function cleanMultiline(value, max, field) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length > max) throw new RoomError(`${field} deve ter no máximo ${max} caracteres.`);
  return text;
}

function cleanLink(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > MAX_LINK) throw new RoomError('Link muito longo.');
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new RoomError('Link inválido (use http:// ou https://).');
  }
}

function cleanRole(role) {
  return role === 'observer' ? 'observer' : 'voter';
}

// ---------------------------------------------------------------- criação

export function createRoom({ roomName, deckId = 'fibonacci', customCards } = {}, now = Date.now()) {
  return {
    id: generateRoomId(),
    name: cleanText(roomName, MAX_ROOM_NAME, 'Nome da sala') || 'Planning Poker',
    createdAt: now,
    deck: buildDeckSafe(deckId, customCards),
    settings: { autoReveal: false, allCanControl: false },
    facilitatorId: null,
    participants: [],
    stories: [],
    activeStoryId: null,
    round: newRound(now),
    timer: null,
    roundCounter: 0,
  };
}

function buildDeckSafe(deckId, customCards) {
  try {
    return buildDeck(deckId, customCards);
  } catch (err) {
    throw new RoomError(err.message);
  }
}

function newRound(now) {
  return { revealed: false, votes: {}, startedAt: now, revealedAt: null };
}

// ---------------------------------------------------------------- helpers

const findParticipant = (room, id) => room.participants.find((p) => p.id === id);
const findStory = (room, id) => {
  const story = room.stories.find((s) => s.id === id);
  if (!story) throw new RoomError('História não encontrada.', 404, 'STORY_NOT_FOUND');
  return story;
};

function secretsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function authenticate(room, participantId, secret) {
  const p = findParticipant(room, participantId);
  if (!p || !secretsMatch(p.secret, secret)) {
    throw new RoomError('Você não faz parte desta sala (ou foi removido).', 403, 'NOT_MEMBER');
  }
  return p;
}

export function canControl(room, participant) {
  return !!participant && (room.facilitatorId === participant.id || room.settings.allCanControl);
}

function requireControl(room, p) {
  if (!canControl(room, p)) throw new RoomError('Apenas o facilitador pode fazer isso.', 403, 'FORBIDDEN');
}

function requireFacilitator(room, p) {
  if (room.facilitatorId !== p.id) throw new RoomError('Apenas o facilitador pode fazer isso.', 403, 'FORBIDDEN');
}

function resetRound(room, now) {
  room.round = newRound(now);
}

function voters(room) {
  return room.participants.filter((p) => p.role === 'voter');
}

function maybeAutoReveal(room, now) {
  if (!room.settings.autoReveal || room.round.revealed) return;
  const list = voters(room);
  if (list.length > 0 && list.every((p) => room.round.votes[p.id] != null)) {
    room.round.revealed = true;
    room.round.revealedAt = now;
  }
}

function pickNewFacilitator(room) {
  const next = room.participants.find((p) => p.role === 'voter') ?? room.participants[0];
  room.facilitatorId = next ? next.id : null;
}

function roundVotes(room) {
  return room.participants
    .filter((p) => room.round.votes[p.id] != null)
    .map((p) => ({ participantId: p.id, name: p.name, value: room.round.votes[p.id] }));
}

function nextPendingStory(room, afterId) {
  const pending = room.stories.filter((s) => s.status === 'pending' && s.id !== afterId);
  if (!pending.length) return null;
  const idx = room.stories.findIndex((s) => s.id === afterId);
  return pending.find((s) => room.stories.indexOf(s) > idx) ?? pending[0];
}

function makeStory({ title, description, link }, now) {
  return {
    id: newId(),
    title: cleanText(title, MAX_TITLE, 'Título', { required: true }),
    description: cleanMultiline(description, MAX_DESCRIPTION, 'Descrição'),
    link: cleanLink(link),
    status: 'pending',
    estimate: null,
    votes: null,
    stats: null,
    createdAt: now,
    estimatedAt: null,
  };
}

// ---------------------------------------------------------------- entrada

/** Adiciona (ou reconecta) um participante. Retorna { participantId, secret }. */
export function joinRoom(room, { name, role, participantId, secret } = {}, now = Date.now()) {
  if (participantId && secret) {
    const existing = findParticipant(room, participantId);
    if (existing && secretsMatch(existing.secret, secret)) {
      const newName = cleanText(name, MAX_NAME, 'Nome');
      if (newName) existing.name = newName;
      existing.lastActiveAt = now;
      if (!room.facilitatorId) room.facilitatorId = existing.id;
      return { participantId: existing.id, secret: existing.secret, rejoined: true };
    }
  }
  if (room.participants.length >= MAX_PARTICIPANTS) {
    throw new RoomError(`Sala cheia: o limite é de ${MAX_PARTICIPANTS} participantes.`, 409, 'ROOM_FULL');
  }
  const participant = {
    id: newId(),
    secret: newSecret(),
    name: cleanText(name, MAX_NAME, 'Nome', { required: true }),
    role: cleanRole(role),
    joinedAt: now,
    lastActiveAt: now,
  };
  room.participants.push(participant);
  if (!room.facilitatorId || !findParticipant(room, room.facilitatorId)) room.facilitatorId = participant.id;
  return { participantId: participant.id, secret: participant.secret, rejoined: false };
}

// ---------------------------------------------------------------- ações

/**
 * Aplica uma ação autenticada à sala (mutando-a).
 * action = { type, participantId, secret, ...dados }
 */
export function applyAction(room, action, now = Date.now()) {
  const type = action?.type;
  if (type === 'join') return joinRoom(room, action, now);

  const me = authenticate(room, action.participantId, action.secret);
  me.lastActiveAt = now;
  const handler = ACTIONS[type];
  if (!handler) throw new RoomError('Ação desconhecida.');
  return handler(room, me, action, now) ?? {};
}

const ACTIONS = {
  // ----- participante
  leave(room, me) {
    room.participants = room.participants.filter((p) => p.id !== me.id);
    delete room.round.votes[me.id];
    if (room.facilitatorId === me.id) pickNewFacilitator(room);
  },

  'participant:update'(room, me, { targetId, name, role }, now) {
    const target = targetId && targetId !== me.id ? findParticipant(room, targetId) : me;
    if (!target) throw new RoomError('Participante não encontrado.', 404);
    if (target !== me) requireFacilitator(room, me);
    if (name !== undefined) {
      if (target !== me) throw new RoomError('Você só pode alterar o seu próprio nome.', 403);
      target.name = cleanText(name, MAX_NAME, 'Nome', { required: true });
    }
    if (role !== undefined) {
      target.role = cleanRole(role);
      if (target.role === 'observer') delete room.round.votes[target.id];
      maybeAutoReveal(room, now);
    }
  },

  'participant:remove'(room, me, { targetId }, now) {
    requireFacilitator(room, me);
    if (targetId === me.id) throw new RoomError('Use "Sair da sala" para sair.');
    if (!findParticipant(room, targetId)) throw new RoomError('Participante não encontrado.', 404);
    room.participants = room.participants.filter((p) => p.id !== targetId);
    delete room.round.votes[targetId];
    maybeAutoReveal(room, now);
  },

  'participant:makeFacilitator'(room, me, { targetId }) {
    requireFacilitator(room, me);
    if (!findParticipant(room, targetId)) throw new RoomError('Participante não encontrado.', 404);
    room.facilitatorId = targetId;
  },

  'participant:claimFacilitator'(room, me, _a, now) {
    const current = findParticipant(room, room.facilitatorId);
    if (current && current.id !== me.id && now - (current.lastActiveAt ?? 0) < FACILITATOR_IDLE_MS) {
      throw new RoomError('O facilitador atual está ativo. Peça para ele transferir o papel.', 409);
    }
    room.facilitatorId = me.id;
  },

  // ----- votação
  vote(room, me, { value }, now) {
    if (me.role !== 'voter') throw new RoomError('Observadores não votam.', 403);
    if (room.round.revealed) throw new RoomError('As cartas já foram reveladas. Aguarde uma nova rodada.', 409);
    if (value === null || value === undefined || value === '') {
      delete room.round.votes[me.id];
      return;
    }
    if (!room.deck.cards.includes(value)) throw new RoomError('Carta inválida para este baralho.');
    room.round.votes[me.id] = value;
    maybeAutoReveal(room, now);
  },

  reveal(room, me, _a, now) {
    requireControl(room, me);
    if (room.round.revealed) return;
    if (Object.keys(room.round.votes).length === 0) throw new RoomError('Ninguém votou ainda.');
    room.round.revealed = true;
    room.round.revealedAt = now;
  },

  reset(room, me, _a, now) {
    requireControl(room, me);
    resetRound(room, now);
  },

  finalize(room, me, { value }, now) {
    requireControl(room, me);
    const estimate = cleanText(value, 8, 'Estimativa', { required: true });
    let story = room.activeStoryId ? room.stories.find((s) => s.id === room.activeStoryId) : null;
    if (!story) {
      if (room.stories.length >= MAX_STORIES) throw new RoomError('Limite de histórias atingido.');
      room.roundCounter = (room.roundCounter ?? 0) + 1;
      story = makeStory({ title: `Rodada ${room.roundCounter}` }, now);
      room.stories.push(story);
    }
    const votes = room.round.revealed ? roundVotes(room) : [];
    const stats = votes.length ? computeStats(votes, room.deck) : null;
    story.status = 'estimated';
    story.estimate = estimate;
    story.votes = votes.map(({ name, value: v }) => ({ name, value: v }));
    story.stats = stats
      ? { average: stats.average, median: stats.median, consensus: stats.consensus }
      : null;
    story.estimatedAt = now;
    const next = nextPendingStory(room, story.id);
    room.activeStoryId = next ? next.id : null;
    resetRound(room, now);
    room.timer = null;
    return { storyId: story.id, nextStoryId: room.activeStoryId };
  },

  // ----- backlog
  'story:add'(room, me, data, now) {
    requireControl(room, me);
    if (room.stories.length >= MAX_STORIES) throw new RoomError('Limite de histórias atingido.');
    const story = makeStory(data, now);
    room.stories.push(story);
    if (!room.activeStoryId && Object.keys(room.round.votes).length === 0) {
      room.activeStoryId = story.id;
      resetRound(room, now);
    }
    return { storyId: story.id };
  },

  'story:addMany'(room, me, { titles }, now) {
    requireControl(room, me);
    const list = (Array.isArray(titles) ? titles : String(titles ?? '').split('\n'))
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 100);
    if (!list.length) throw new RoomError('Informe ao menos um título.');
    if (room.stories.length + list.length > MAX_STORIES) throw new RoomError('Limite de histórias atingido.');
    const created = list.map((title) => makeStory({ title: title.slice(0, MAX_TITLE) }, now));
    room.stories.push(...created);
    if (!room.activeStoryId && Object.keys(room.round.votes).length === 0) {
      room.activeStoryId = created[0].id;
      resetRound(room, now);
    }
    return { count: created.length };
  },

  'story:update'(room, me, { id, title, description, link }) {
    requireControl(room, me);
    const story = findStory(room, id);
    if (title !== undefined) story.title = cleanText(title, MAX_TITLE, 'Título', { required: true });
    if (description !== undefined) story.description = cleanMultiline(description, MAX_DESCRIPTION, 'Descrição');
    if (link !== undefined) story.link = cleanLink(link);
  },

  'story:remove'(room, me, { id }, now) {
    requireControl(room, me);
    findStory(room, id);
    room.stories = room.stories.filter((s) => s.id !== id);
    if (room.activeStoryId === id) {
      room.activeStoryId = null;
      resetRound(room, now);
    }
  },

  'story:move'(room, me, { id, direction }) {
    requireControl(room, me);
    const idx = room.stories.findIndex((s) => s.id === id);
    if (idx < 0) throw new RoomError('História não encontrada.', 404);
    const target = idx + (direction < 0 ? -1 : 1);
    if (target < 0 || target >= room.stories.length) return;
    [room.stories[idx], room.stories[target]] = [room.stories[target], room.stories[idx]];
  },

  'story:select'(room, me, { id }, now) {
    requireControl(room, me);
    if (id === null) {
      room.activeStoryId = null;
    } else {
      const story = findStory(room, id);
      if (story.status !== 'pending') throw new RoomError('Esta história já foi estimada. Reabra-a primeiro.');
      room.activeStoryId = story.id;
    }
    resetRound(room, now);
  },

  'story:reopen'(room, me, { id }, now) {
    requireControl(room, me);
    const story = findStory(room, id);
    story.status = 'pending';
    story.estimate = null;
    story.votes = null;
    story.stats = null;
    story.estimatedAt = null;
    room.activeStoryId = story.id;
    resetRound(room, now);
  },

  // ----- cronômetro
  'timer:start'(room, me, { seconds }, now) {
    requireControl(room, me);
    const s = Math.round(Number(seconds));
    if (!Number.isFinite(s) || s < 5 || s > 3600) throw new RoomError('Duração inválida (5 s a 60 min).');
    room.timer = { startedAt: now, endsAt: now + s * 1000, duration: s };
  },

  'timer:stop'(room, me) {
    requireControl(room, me);
    room.timer = null;
  },

  // ----- configurações
  'room:update'(room, me, { name, deckId, customCards, settings }, now) {
    requireFacilitator(room, me);
    if (name !== undefined) {
      room.name = cleanText(name, MAX_ROOM_NAME, 'Nome da sala', { required: true });
    }
    if (deckId !== undefined) {
      const deck = buildDeckSafe(deckId, customCards);
      const changed = JSON.stringify(deck.cards) !== JSON.stringify(room.deck.cards);
      room.deck = deck;
      if (changed) resetRound(room, now);
    }
    if (settings && typeof settings === 'object') {
      if (typeof settings.autoReveal === 'boolean') room.settings.autoReveal = settings.autoReveal;
      if (typeof settings.allCanControl === 'boolean') room.settings.allCanControl = settings.allCanControl;
      maybeAutoReveal(room, now);
    }
  },
};

// ---------------------------------------------------------------- visão pública

/**
 * Gera a visão da sala segura para enviar aos clientes:
 * sem segredos e sem valores de voto antes da revelação.
 */
export function sanitizeRoom(room, { version = 0, viewerId = null, now = Date.now() } = {}) {
  const { revealed } = room.round;
  const votes = roundVotes(room);
  const stats = revealed && votes.length ? computeStats(votes, room.deck) : null;
  const view = {
    id: room.id,
    name: room.name,
    version,
    createdAt: room.createdAt,
    deck: room.deck,
    specialCards: SPECIAL_CARDS,
    settings: room.settings,
    facilitatorId: room.facilitatorId,
    maxParticipants: MAX_PARTICIPANTS,
    participants: room.participants.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      hasVoted: room.round.votes[p.id] != null,
      lastActiveAt: p.lastActiveAt,
    })),
    stories: room.stories,
    activeStoryId: room.activeStoryId,
    round: {
      revealed,
      startedAt: room.round.startedAt,
      revealedAt: room.round.revealedAt,
      voteCount: votes.length,
      votes: revealed ? Object.fromEntries(votes.map((v) => [v.participantId, v.value])) : null,
      stats,
    },
    timer: room.timer,
    serverNow: now,
  };
  if (viewerId) {
    const mine = room.round.votes[viewerId];
    view.myVote = mine ?? null;
  }
  return view;
}
