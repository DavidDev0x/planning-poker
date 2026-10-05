// Gerenciador de conexão em Tempo Real
// Abstrai se estamos usando Supabase (produção) ou SSE (desenvolvimento local)

class RealtimeClient {
  constructor(roomId, participantId, token) {
    this.roomId = roomId;
    this.participantId = participantId;
    this.token = token;
    
    // Callbacks
    this.onStateChange = null;
    this.onPresenceChange = null;
    this.onError = null;
    
    this.supabase = null;
    this.channel = null;
    this.eventSource = null;
  }

  async connect() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();

      if (config.mode === 'local') {
        this.connectSSE();
      } else if (config.mode === 'supabase' && config.supabaseUrl && config.supabaseKey) {
        if (!window.supabase) {
          throw new Error('Supabase JS não carregado.');
        }
        this.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
        this.connectSupabase();
      } else {
        throw new Error('Configuração de Realtime ausente.');
      }
    } catch (err) {
      if (this.onError) this.onError(err.message);
    }
  }

  connectSSE() {
    const url = `/api/events?roomId=${this.roomId}&participantId=${this.participantId}`;
    this.eventSource = new EventSource(url);
    
    this.eventSource.onmessage = (e) => {
      try {
        const state = JSON.parse(e.data);
        if (this.onStateChange) this.onStateChange(state);
      } catch (err) {
        console.error('Erro ao processar estado (SSE):', err);
      }
    };

    this.eventSource.addEventListener('presence', (e) => {
      try {
        const onlineIds = JSON.parse(e.data);
        if (this.onPresenceChange) this.onPresenceChange(onlineIds);
      } catch (err) {
        console.error('Erro ao processar presença (SSE):', err);
      }
    });

    this.eventSource.onerror = () => {
      // Reconexão automática do EventSource cuidará de tentar conectar novamente
      console.log('EventSource desconectado, tentando reconectar...');
    };
  }

  connectSupabase() {
    this.channel = this.supabase.channel(`room:${this.roomId}`, {
      config: { presence: { key: this.participantId } }
    });

    // Escuta mudanças de estado (Broadcast)
    this.channel.on('broadcast', { event: 'state' }, (payload) => {
      if (this.onStateChange) this.onStateChange(payload.payload);
    });

    // Escuta presença (Sync)
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState();
      const onlineIds = Object.keys(state);
      if (this.onPresenceChange) this.onPresenceChange(onlineIds);
    });

    this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await this.channel.track({ online_at: new Date().toISOString() });
      } else if (status === 'CLOSED') {
        console.log('Supabase Channel Fechado');
      } else if (status === 'CHANNEL_ERROR') {
        if (this.onError) this.onError('Erro na conexão em tempo real.');
      }
    });
  }

  async sendAction(type, payload = {}) {
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          participantId: this.participantId,
          secret: this.token,
          type,
          ...payload
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ação falhou');
      return data; // O broadcast virá via canal de tempo real
    } catch (err) {
      if (this.onError) this.onError(err.message);
      throw err;
    }
  }

  async fetchInitialState() {
    try {
      const res = await fetch(`/api/room?id=${this.roomId}&pid=${this.participantId}&secret=${this.token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar estado inicial');
      if (this.onStateChange) this.onStateChange(data.state);
    } catch (err) {
      if (this.onError) this.onError(err.message);
      throw err;
    }
  }

  disconnect() {
    if (this.eventSource) this.eventSource.close();
    if (this.channel) this.channel.unsubscribe();
  }
}

window.RealtimeClient = RealtimeClient;
