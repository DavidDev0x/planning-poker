// Gerencia a interface de usuário (DOM) da sala

class UI {
  constructor() {
    this.elements = {
      roomName: document.getElementById('room-name'),
      timerDisplay: document.getElementById('timer-display'),
      btnTimer: document.getElementById('btn-timer'),
      btnSettings: document.getElementById('btn-settings'),
      btnAddStory: document.getElementById('btn-add-story'),
      storyList: document.getElementById('story-list'),
      tableContainer: document.getElementById('table-container'),
      handArea: document.getElementById('hand-area'),
      facilitatorActions: document.getElementById('facilitator-actions'),
      btnReveal: document.getElementById('btn-reveal'),
      btnReset: document.getElementById('btn-reset'),
      resultsPanel: document.getElementById('results-panel'),
      statConsensus: document.getElementById('stat-consensus'),
      badgeConsensus: document.getElementById('badge-consensus'),
      statAvgBox: document.getElementById('stat-avg-box'),
      statAverage: document.getElementById('stat-average'),
      statClosestBox: document.getElementById('stat-closest-box'),
      statClosest: document.getElementById('stat-closest'),
      chartContainer: document.getElementById('chart-container'),
      dialogStory: document.getElementById('dialog-story'),
      formStory: document.getElementById('form-story'),
      dialogTimer: document.getElementById('dialog-timer'),
      formTimer: document.getElementById('form-timer'),
      btnShare: document.getElementById('btn-share'),
      toastContainer: document.getElementById('toast-container'),
      tplParticipant: document.getElementById('tpl-participant')
    };
    this.state = null;
    this.participantId = null;
    this.onlineIds = new Set();
    this.timerInterval = null;
  }

  showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') toast.style.borderLeftColor = 'var(--c-danger)';
    if (type === 'success') toast.style.borderLeftColor = 'var(--c-success)';
    toast.textContent = message;
    this.elements.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  update(state, participantId, onlineIds) {
    this.state = state;
    this.participantId = participantId;
    this.onlineIds = new Set(onlineIds);

    const isFacilitator = state.facilitatorId === participantId;
    const me = state.participants.find(p => p.id === participantId);

    // Header
    this.elements.roomName.textContent = state.name;
    
    // Controles do facilitador
    if (isFacilitator) {
      this.elements.btnTimer.classList.remove('hidden');
      this.elements.btnSettings.classList.remove('hidden');
      this.elements.btnAddStory.classList.remove('hidden');
      this.elements.facilitatorActions.classList.remove('hidden');
      
      // Estado dos botões do facilitador
      this.elements.btnReveal.disabled = state.round.revealed;
      this.elements.btnReset.disabled = !state.round.revealed;
    } else {
      this.elements.btnTimer.classList.add('hidden');
      this.elements.btnSettings.classList.add('hidden');
      this.elements.btnAddStory.classList.add('hidden');
      this.elements.facilitatorActions.classList.add('hidden');
    }

    // Cronômetro
    this.updateTimer();

    // Histórias
    this.renderStories(isFacilitator);

    // Mão de cartas
    this.renderHand(me);

    // Mesa
    this.renderTable();

    // Resultados
    this.renderResults();
  }

  renderStories(isFacilitator) {
    const list = this.elements.storyList;
    list.innerHTML = '';
    
    if (this.state.stories.length === 0) {
      list.innerHTML = '<div style="padding: 1rem; color: var(--c-text-muted); text-align: center; font-size: 0.875rem;">Nenhuma história adicionada.</div>';
      return;
    }

    this.state.stories.forEach(story => {
      const el = document.createElement('div');
      el.className = `story-item ${story.id === this.state.activeStoryId ? 'active' : ''} ${story.status === 'estimated' ? 'estimated' : ''}`;
      
      let titleHtml = `
        <div class="story-title">${escapeHtml(story.title)}</div>
        <div class="story-meta">
          <span>${story.status === 'estimated' ? 'Estimada: ' + (story.estimate || '?') : 'Pendente'}</span>
        </div>
      `;
      el.innerHTML = titleHtml;

      if (isFacilitator && story.id !== this.state.activeStoryId && story.status === 'pending') {
        el.addEventListener('click', () => {
          if (window.onStorySelect) window.onStorySelect(story.id);
        });
      }
      
      list.appendChild(el);
    });
  }

  renderHand(me) {
    const hand = this.elements.handArea;
    hand.innerHTML = '';
    
    if (!me || me.role === 'observer') {
      hand.innerHTML = '<div style="color: var(--c-text-muted);">Você é um observador.</div>';
      return;
    }
    
    if (this.state.round.revealed) {
      hand.innerHTML = '<div style="color: var(--c-text-muted);">Rodada revelada. Aguarde a próxima rodada.</div>';
      return;
    }

    this.state.deck.cards.forEach(card => {
      const btn = document.createElement('button');
      btn.className = `hand-card ${this.state.myVote === card ? 'selected' : ''}`;
      btn.textContent = card;
      btn.addEventListener('click', () => {
        if (window.onVote) window.onVote(card);
      });
      hand.appendChild(btn);
    });
  }

  renderTable() {
    const container = this.elements.tableContainer;
    container.innerHTML = '';

    this.state.participants.forEach(p => {
      const clone = this.elements.tplParticipant.content.cloneNode(true);
      const el = clone.querySelector('.participant');
      const nameEl = clone.querySelector('.participant-name');
      const roleEl = clone.querySelector('.participant-role');
      const card = clone.querySelector('.card');
      const cardFront = clone.querySelector('.card-front');
      const cardBack = clone.querySelector('.card-back');

      nameEl.textContent = p.name + (p.id === this.participantId ? ' (Você)' : '');
      
      let roleLabel = p.role === 'observer' ? 'Observador' : (p.id === this.state.facilitatorId ? 'Facilitador' : '');
      roleEl.textContent = roleLabel;
      
      if (!this.onlineIds.has(p.id)) {
        el.style.opacity = '0.5';
        nameEl.textContent += ' (Offline)';
      }

      if (p.role === 'observer') {
        card.style.display = 'none';
      } else {
        if (this.state.round.revealed) {
          card.classList.add('flipped');
          const vote = this.state.round.votes?.[p.id];
          if (vote) {
            cardFront.textContent = vote;
          } else {
            cardFront.textContent = '❌';
            cardFront.style.color = 'var(--c-danger)';
          }
        } else {
          // Não revelado
          if (p.hasVoted) {
            // Se sou eu, mostra meu voto, senão mostra o verso
            if (p.id === this.participantId && this.state.myVote) {
               card.classList.add('flipped');
               cardFront.textContent = this.state.myVote;
            }
          } else {
            cardBack.className = 'card-face card-empty';
          }
        }
      }

      container.appendChild(clone);
    });
  }

  renderResults() {
    const panel = this.elements.resultsPanel;
    if (!this.state.round.revealed || !this.state.round.stats) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const stats = this.state.round.stats;
    
    // Consenso
    if (stats.consensus !== null) {
      this.elements.statConsensus.textContent = stats.consensus;
      this.elements.badgeConsensus.classList.remove('hidden');
    } else {
      this.elements.statConsensus.textContent = 'Sem consenso';
      this.elements.badgeConsensus.classList.add('hidden');
    }

    // Médias
    if (stats.average !== null) {
      this.elements.statAvgBox.classList.remove('hidden');
      this.elements.statAverage.textContent = stats.average;
    } else {
      this.elements.statAvgBox.classList.add('hidden');
    }
    
    if (stats.closestCard !== null) {
      this.elements.statClosestBox.classList.remove('hidden');
      this.elements.statClosest.textContent = stats.closestCard;
    } else {
      this.elements.statClosestBox.classList.add('hidden');
    }

    // Gráfico (Distribuição)
    const chart = this.elements.chartContainer;
    chart.innerHTML = '';
    
    if (stats.frequencies) {
      const maxCount = Math.max(...Object.values(stats.frequencies));
      for (const [val, count] of Object.entries(stats.frequencies)) {
        const pct = (count / maxCount) * 100;
        
        const row = document.createElement('div');
        row.className = 'chart-bar';
        row.innerHTML = `
          <div class="chart-bar-label">${val}</div>
          <div style="flex: 1; background: var(--c-surface-hover); border-radius: 0.125rem; overflow: hidden; display: flex; align-items: center;">
            <div class="chart-bar-fill" style="width: ${pct}%"></div>
          </div>
          <div class="chart-bar-count">${count} voto(s)</div>
        `;
        chart.appendChild(row);
      }
    }
  }

  updateTimer() {
    clearInterval(this.timerInterval);
    const timer = this.state.timer;
    const display = this.elements.timerDisplay;
    
    if (!timer) {
      display.classList.add('hidden');
      return;
    }
    
    display.classList.remove('hidden');
    
    const tick = () => {
      const now = Date.now();
      let remaining = Math.max(0, Math.floor((timer.endsAt - now) / 1000));
      const m = String(Math.floor(remaining / 60)).padStart(2, '0');
      const s = String(remaining % 60).padStart(2, '0');
      display.textContent = `${m}:${s}`;
      
      if (remaining <= 10) display.style.color = 'var(--c-danger)';
      else display.style.color = 'var(--c-text)';
      
      if (remaining === 0) clearInterval(this.timerInterval);
    };
    
    tick();
    this.timerInterval = setInterval(tick, 1000);
  }
}

// Utilitário
function escapeHtml(unsafe) {
  return (unsafe||'').replace(/[&<"']/g, function(m) {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
    }
  });
}

window.UI = UI;
