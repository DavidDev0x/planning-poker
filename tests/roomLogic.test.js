import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PARTICIPANTS,
  RoomError,
  applyAction,
  createRoom,
  joinRoom,
  sanitizeRoom,
} from '../lib/roomLogic.js';
import { computeStats, closestCard, buildDeck } from '../lib/decks.js';

function setup(n = 3, opts = {}) {
  const room = createRoom({ roomName: 'Time', deckId: 'fibonacci', ...opts });
  const people = [];
  for (let i = 0; i < n; i++) people.push(joinRoom(room, { name: `P${i}` }));
  const act = (who, type, data = {}) =>
    applyAction(room, { type, participantId: who.participantId, secret: who.secret, ...data });
  return { room, people, act };
}

test('primeiro participante vira facilitador', () => {
  const { room, people } = setup(2);
  assert.equal(room.facilitatorId, people[0].participantId);
});

test(`limite de ${MAX_PARTICIPANTS} participantes`, () => {
  const { room } = setup(MAX_PARTICIPANTS);
  assert.equal(room.participants.length, 15);
  assert.throws(() => joinRoom(room, { name: 'Extra' }), (e) => e instanceof RoomError && e.code === 'ROOM_FULL');
});

test('reconexão com token não ocupa nova vaga', () => {
  const { room, people } = setup(MAX_PARTICIPANTS);
  const again = joinRoom(room, { name: 'P0 novo', ...people[0] });
  assert.equal(again.participantId, people[0].participantId);
  assert.equal(again.rejoined, true);
  assert.equal(room.participants.length, MAX_PARTICIPANTS);
});

test('segredo errado é rejeitado', () => {
  const { room, people } = setup(1);
  assert.throws(
    () => applyAction(room, { type: 'vote', participantId: people[0].participantId, secret: 'x', value: '3' }),
    (e) => e.code === 'NOT_MEMBER',
  );
});

test('votos ficam ocultos até a revelação', () => {
  const { room, people, act } = setup(3);
  act(people[0], 'vote', { value: '5' });
  act(people[1], 'vote', { value: '8' });
  const hidden = sanitizeRoom(room);
  assert.equal(hidden.round.votes, null);
  assert.equal(hidden.round.stats, null);
  assert.equal(hidden.round.voteCount, 2);
  assert.ok(!JSON.stringify(hidden).includes(people[0].secret), 'segredo não deve vazar');
  assert.deepEqual(hidden.participants.map((p) => p.hasVoted), [true, true, false]);

  const mine = sanitizeRoom(room, { viewerId: people[1].participantId });
  assert.equal(mine.myVote, '8');

  act(people[0], 'reveal');
  const shown = sanitizeRoom(room);
  assert.equal(shown.round.votes[people[1].participantId], '8');
  assert.equal(shown.round.stats.average, 6.5);
});

test('observador não vota e só o facilitador revela', () => {
  const { room, people, act } = setup(2);
  const obs = joinRoom(room, { name: 'PO', role: 'observer' });
  assert.throws(() => act(obs, 'vote', { value: '3' }), /Observadores/);
  act(people[1], 'vote', { value: '3' });
  assert.throws(() => act(people[1], 'reveal'), (e) => e.code === 'FORBIDDEN');
  act(people[0], 'reveal');
  assert.equal(room.round.revealed, true);
  assert.throws(() => act(people[1], 'vote', { value: '5' }), /reveladas/);
});

test('"todos podem controlar" libera revelação', () => {
  const { room, people, act } = setup(2);
  act(people[0], 'room:update', { settings: { allCanControl: true } });
  act(people[1], 'vote', { value: '3' });
  act(people[1], 'reveal');
  assert.equal(room.round.revealed, true);
});

test('revelação automática quando todos votam', () => {
  const { room, people, act } = setup(3);
  act(people[0], 'room:update', { settings: { autoReveal: true } });
  act(people[0], 'vote', { value: '1' });
  act(people[1], 'vote', { value: '1' });
  assert.equal(room.round.revealed, false);
  act(people[2], 'vote', { value: '1' });
  assert.equal(room.round.revealed, true);
});

test('carta inválida é rejeitada', () => {
  const { people, act } = setup(1);
  assert.throws(() => act(people[0], 'vote', { value: '4' }), /inválida/);
});

test('fluxo de backlog: adicionar, estimar e avançar', () => {
  const { room, people, act } = setup(2);
  act(people[0], 'story:addMany', { titles: 'Login\nCadastro\nRelatório' });
  assert.equal(room.stories.length, 3);
  assert.equal(room.activeStoryId, room.stories[0].id);
  act(people[0], 'vote', { value: '3' });
  act(people[1], 'vote', { value: '5' });
  act(people[0], 'reveal');
  const res = act(people[0], 'finalize', { value: '5' });
  assert.equal(room.stories[0].status, 'estimated');
  assert.equal(room.stories[0].estimate, '5');
  assert.equal(room.stories[0].votes.length, 2);
  assert.equal(res.nextStoryId, room.stories[1].id);
  assert.equal(room.activeStoryId, room.stories[1].id);
  assert.deepEqual(room.round.votes, {});
  // reabrir
  act(people[0], 'story:reopen', { id: room.stories[0].id });
  assert.equal(room.stories[0].status, 'pending');
  assert.equal(room.activeStoryId, room.stories[0].id);
});

test('finalizar sem história cria "Rodada N"', () => {
  const { room, people, act } = setup(1);
  act(people[0], 'vote', { value: '8' });
  act(people[0], 'reveal');
  act(people[0], 'finalize', { value: '8' });
  assert.equal(room.stories[0].title, 'Rodada 1');
});

test('link inválido é rejeitado', () => {
  const { people, act } = setup(1);
  assert.throws(() => act(people[0], 'story:add', { title: 'X', link: 'javascript:alert(1)' }), /Link/);
});

test('facilitador sai → papel é transferido', () => {
  const { room, people, act } = setup(3);
  act(people[0], 'leave');
  assert.equal(room.participants.length, 2);
  assert.equal(room.facilitatorId, people[1].participantId);
});

test('remover participante e transferir facilitador', () => {
  const { room, people, act } = setup(3);
  act(people[2], 'vote', { value: '2' });
  act(people[0], 'participant:remove', { targetId: people[2].participantId });
  assert.equal(room.participants.length, 2);
  assert.equal(room.round.votes[people[2].participantId], undefined);
  act(people[0], 'participant:makeFacilitator', { targetId: people[1].participantId });
  assert.equal(room.facilitatorId, people[1].participantId);
  assert.throws(() => act(people[0], 'participant:remove', { targetId: people[1].participantId }), /facilitador/);
});

test('assumir facilitação só quando o atual está inativo', () => {
  const { room, people } = setup(2);
  const claim = (now) =>
    applyAction(room, { type: 'participant:claimFacilitator', ...people[1] }, now);
  assert.throws(() => claim(Date.now()), /ativo/);
  claim(Date.now() + 3 * 60 * 1000);
  assert.equal(room.facilitatorId, people[1].participantId);
});

test('trocar baralho limpa os votos', () => {
  const { room, people, act } = setup(1);
  act(people[0], 'vote', { value: '3' });
  act(people[0], 'room:update', { deckId: 'tshirt' });
  assert.deepEqual(room.round.votes, {});
  act(people[0], 'vote', { value: 'M' });
  assert.throws(() => act(people[0], 'room:update', { deckId: 'custom', customCards: 'A' }), /pelo menos 2/);
});

test('cronômetro', () => {
  const { room, people, act } = setup(1);
  act(people[0], 'timer:start', { seconds: 60 });
  assert.equal(room.timer.duration, 60);
  act(people[0], 'timer:stop');
  assert.equal(room.timer, null);
  assert.throws(() => act(people[0], 'timer:start', { seconds: 1 }), /Duração/);
});

test('estatísticas numéricas', () => {
  const deck = buildDeck('fibonacci');
  const s = computeStats(
    [
      { participantId: 'a', value: '3' },
      { participantId: 'b', value: '5' },
      { participantId: 'c', value: '13' },
      { participantId: 'd', value: '?' },
    ],
    deck,
  );
  assert.equal(s.average, 7);
  assert.equal(s.median, 5);
  assert.equal(s.min, 3);
  assert.equal(s.max, 13);
  assert.equal(s.validVotes, 3);
  assert.equal(s.distribution['?'], 1);
  assert.deepEqual(s.lowVoters, ['a']);
  assert.deepEqual(s.highVoters, ['c']);
  assert.equal(s.suggestion, '8');
  assert.equal(s.consensus, false);
});

test('consenso e baralho ordinal', () => {
  const t = buildDeck('tshirt');
  const s = computeStats(
    [
      { participantId: 'a', value: 'M' },
      { participantId: 'b', value: 'M' },
    ],
    t,
  );
  assert.equal(s.consensus, true);
  assert.equal(s.suggestion, 'M');
  const s2 = computeStats(
    [
      { participantId: 'a', value: 'S' },
      { participantId: 'b', value: 'XL' },
    ],
    t,
  );
  assert.equal(s2.min, 'S');
  assert.equal(s2.max, 'XL');
  assert.ok(['M', 'L'].includes(s2.suggestion));
});

test('closestCard com ½', () => {
  const deck = buildDeck('modified');
  assert.equal(closestCard(0.6, deck), '½');
  assert.equal(closestCard(30, deck), '40');
});
