// Definição dos baralhos e cálculo de estatísticas da votação.

export const SPECIAL_CARDS = ['?', '☕'];

export const DECKS = {
  fibonacci: {
    id: 'fibonacci',
    name: 'Fibonacci',
    cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'],
  },
  modified: {
    id: 'modified',
    name: 'Fibonacci modificado',
    cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'],
  },
  tshirt: {
    id: 'tshirt',
    name: 'Camisetas (T-shirt)',
    cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'],
  },
  powers: {
    id: 'powers',
    name: 'Potências de 2',
    cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕'],
  },
};

export const MAX_CUSTOM_CARDS = 20;
export const MAX_CARD_LENGTH = 5;

/** Cria um baralho a partir do id (ou personalizado a partir de uma lista). */
export function buildDeck(deckId, customCards) {
  if (deckId === 'custom') {
    const cards = sanitizeCustomCards(customCards);
    if (cards.length < 2) throw new Error('O baralho personalizado precisa de pelo menos 2 cartas.');
    return { id: 'custom', name: 'Personalizado', cards };
  }
  const deck = DECKS[deckId];
  if (!deck) throw new Error('Baralho inválido.');
  return { ...deck, cards: [...deck.cards] };
}

export function sanitizeCustomCards(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]+/);
  const seen = new Set();
  const cards = [];
  for (const raw of list) {
    const card = String(raw).trim().slice(0, MAX_CARD_LENGTH);
    if (!card || seen.has(card)) continue;
    seen.add(card);
    cards.push(card);
    if (cards.length >= MAX_CUSTOM_CARDS) break;
  }
  return cards;
}

/** Converte uma carta em número (ou null se não for numérica). */
export function cardToNumber(card) {
  if (card === '½') return 0.5;
  if (typeof card !== 'string' || card.trim() === '') return null;
  const n = Number(card.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Calcula estatísticas de uma lista de votos ({ participantId, value }).
 * Cartas especiais (? e ☕) entram na distribuição, mas não nas médias.
 */
export function computeStats(votes, deck) {
  const all = votes.filter((v) => v.value != null);
  const distribution = {};
  for (const v of all) distribution[v.value] = (distribution[v.value] ?? 0) + 1;

  const valid = all.filter((v) => !SPECIAL_CARDS.includes(v.value));
  const numeric = valid
    .map((v) => ({ ...v, n: cardToNumber(v.value) }))
    .filter((v) => v.n !== null);
  const isNumeric = valid.length > 0 && numeric.length === valid.length;

  // Carta(s) mais votada(s) entre os votos válidos
  const counts = {};
  for (const v of valid) counts[v.value] = (counts[v.value] ?? 0) + 1;
  const maxCount = Math.max(0, ...Object.values(counts));
  const mode = Object.keys(counts).filter((k) => counts[k] === maxCount);

  const uniqueValid = new Set(valid.map((v) => v.value));
  const consensus = valid.length > 1 && uniqueValid.size === 1;

  const stats = {
    totalVotes: all.length,
    validVotes: valid.length,
    distribution,
    mode,
    consensus,
    isNumeric,
    average: null,
    median: null,
    min: null,
    max: null,
    lowVoters: [],
    highVoters: [],
    suggestion: mode.length === 1 ? mode[0] : null,
  };

  if (isNumeric) {
    const nums = numeric.map((v) => v.n).sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    stats.average = round2(sum / nums.length);
    const mid = Math.floor(nums.length / 2);
    stats.median = round2(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2);
    stats.min = nums[0];
    stats.max = nums[nums.length - 1];
    if (stats.min !== stats.max) {
      stats.lowVoters = numeric.filter((v) => v.n === stats.min).map((v) => v.participantId);
      stats.highVoters = numeric.filter((v) => v.n === stats.max).map((v) => v.participantId);
    }
    stats.suggestion = closestCard(stats.average, deck) ?? stats.suggestion;
  } else if (valid.length > 0 && deck) {
    // Baralho ordinal (ex.: camisetas): usa a posição no baralho
    const order = deck.cards.filter((c) => !SPECIAL_CARDS.includes(c));
    const indexed = valid
      .map((v) => ({ ...v, i: order.indexOf(v.value) }))
      .filter((v) => v.i >= 0);
    if (indexed.length === valid.length) {
      const idx = indexed.map((v) => v.i);
      const minI = Math.min(...idx);
      const maxI = Math.max(...idx);
      stats.min = order[minI];
      stats.max = order[maxI];
      if (minI !== maxI) {
        stats.lowVoters = indexed.filter((v) => v.i === minI).map((v) => v.participantId);
        stats.highVoters = indexed.filter((v) => v.i === maxI).map((v) => v.participantId);
      }
      const sorted = [...idx].sort((a, b) => a - b);
      stats.median = order[sorted[Math.floor((sorted.length - 1) / 2)]];
      if (!stats.suggestion) {
        const avg = Math.round(idx.reduce((a, b) => a + b, 0) / idx.length);
        stats.suggestion = order[avg];
      }
    }
  }
  return stats;
}

/** Retorna a carta numérica do baralho mais próxima de um valor (empate → maior). */
export function closestCard(value, deck) {
  if (value == null || !deck) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const card of deck.cards) {
    const n = cardToNumber(card);
    if (n === null) continue;
    const diff = Math.abs(n - value);
    if (diff < bestDiff || (diff === bestDiff && n > cardToNumber(best))) {
      best = card;
      bestDiff = diff;
    }
  }
  return best;
}
