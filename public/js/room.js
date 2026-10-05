const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('id');

const token = sessionStorage.getItem(`pp_token_${roomId}`);
const participantId = sessionStorage.getItem(`pp_participantId_${roomId}`);

if (!roomId || !token || !participantId || token === 'undefined' || participantId === 'undefined') {
  // Redirecionar para home se não estiver logado
  if (roomId) window.location.href = `/?id=${roomId}`;
  else window.location.href = '/';
}

const ui = new window.UI();
const realtime = new window.RealtimeClient(roomId, participantId, token);

let currentState = null;
let currentOnlineIds = [];

// Callbacks da UI (Global)
window.onVote = async (value) => {
  try {
    // Optimistic UI
    currentState.myVote = value;
    const me = currentState.participants.find(p => p.id === participantId);
    if (me) me.hasVoted = true;
    ui.update(currentState, participantId, currentOnlineIds);

    await realtime.sendAction('vote', { value });
  } catch (err) {
    ui.showToast(err.message);
  }
};

window.onStorySelect = async (id) => {
  try {
    await realtime.sendAction('story:select', { id });
  } catch (err) {
    ui.showToast(err.message);
  }
};

// Eventos dos botões do Facilitador
ui.elements.btnReveal.addEventListener('click', async () => {
  try { await realtime.sendAction('reveal'); }
  catch (err) { ui.showToast(err.message); }
});

ui.elements.btnReset.addEventListener('click', async () => {
  try { await realtime.sendAction('reset'); }
  catch (err) { ui.showToast(err.message); }
});

ui.elements.btnAddStory.addEventListener('click', () => {
  ui.elements.dialogStory.showModal();
});

ui.elements.formStory.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('story-title').value.trim();
  try {
    await realtime.sendAction('story:add', { title });
    ui.elements.formStory.reset();
    ui.elements.dialogStory.close();
  } catch (err) {
    ui.showToast(err.message);
  }
});

ui.elements.btnTimer.addEventListener('click', () => {
  ui.elements.dialogTimer.showModal();
});

ui.elements.formTimer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const minutes = document.getElementById('timer-minutes').value;
  try {
    await realtime.sendAction('timer:start', { seconds: minutes * 60 });
    ui.elements.dialogTimer.close();
  } catch (err) {
    ui.showToast(err.message);
  }
});

ui.elements.btnShare.addEventListener('click', async () => {
  const url = `${window.location.origin}/?id=${roomId}`;
  try {
    await navigator.clipboard.writeText(url);
    ui.showToast('Link copiado!', 'success');
  } catch (err) {
    ui.showToast('Falha ao copiar link');
  }
});

// Callbacks do Realtime
realtime.onStateChange = (state) => {
  currentState = state;
  ui.update(currentState, participantId, currentOnlineIds);
};

realtime.onPresenceChange = (onlineIds) => {
  currentOnlineIds = onlineIds;
  if (currentState) {
    ui.update(currentState, participantId, currentOnlineIds);
  }
};

realtime.onError = (msg) => {
  ui.showToast(msg);
};

// Iniciar conexão
realtime.connect().then(() => {
  realtime.fetchInitialState();
}).catch(err => {
  ui.showToast('Erro ao inicializar');
});
