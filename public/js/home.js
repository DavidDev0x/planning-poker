const tabJoin = document.getElementById('tab-join');
const tabCreate = document.getElementById('tab-create');
const formJoin = document.getElementById('form-join');
const formCreate = document.getElementById('form-create');

tabJoin.addEventListener('click', () => {
  tabJoin.classList.add('btn-primary');
  tabCreate.classList.remove('btn-primary');
  formJoin.classList.remove('hidden');
  formCreate.classList.add('hidden');
});

tabCreate.addEventListener('click', () => {
  tabCreate.classList.add('btn-primary');
  tabJoin.classList.remove('btn-primary');
  formCreate.classList.remove('hidden');
  formJoin.classList.add('hidden');
});

function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'error') toast.style.borderLeftColor = 'var(--c-danger)';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

formJoin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const roomId = document.getElementById('join-room-id').value.trim();
  const name = document.getElementById('join-name').value.trim();
  const role = document.getElementById('join-role').value;

  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, type: 'join', name, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao entrar na sala');
    
    // O backend retorna result: { participantId, secret } para a ação join
    const { participantId, secret } = data.result;
    sessionStorage.setItem(`pp_token_${roomId}`, secret);
    sessionStorage.setItem(`pp_participantId_${roomId}`, participantId);
    
    window.location.href = `/room.html?id=${roomId}`;
  } catch (err) {
    showToast(err.message);
  }
});

formCreate.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('create-name').value.trim();
  const deckId = document.getElementById('create-deck').value;
  const userName = document.getElementById('create-user-name').value.trim();

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, deckId, userName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao criar sala');
    
    const roomId = data.roomId;
    sessionStorage.setItem(`pp_token_${roomId}`, data.secret);
    sessionStorage.setItem(`pp_participantId_${roomId}`, data.participantId);
    
    window.location.href = `/room.html?id=${roomId}`;
  } catch (err) {
    showToast(err.message);
  }
});

// Auto-preencher ID da sala se vier na URL (?id=...)
const urlParams = new URLSearchParams(window.location.search);
const idParam = urlParams.get('id');
if (idParam) {
  document.getElementById('join-room-id').value = idParam;
}
