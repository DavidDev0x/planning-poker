# 🃏 Planning Poker

Aplicação de **Planning Poker em tempo real** para times ágeis de até 15 participantes simultâneos, construída com foco em simplicidade, velocidade e design moderno.

Funciona tanto localmente (sem dependências externas, usando SSE e armazenamento em memória) quanto em produção (Vercel Serverless Functions + Supabase Realtime/Postgres).

---

## 🚀 Funcionalidades

- **Salas em Tempo Real:** Criação rápida com código de sala fácil de compartilhar.
- **Até 15 Participantes Concorrentes:** Suporte a papéis de Facilitador, Votante e Observador.
- **Múltiplos Baralhos:** Fibonacci (`0, ½, 1, 2, 3, 5, 8, 13, 20, 40, 100, ?`), Camisetas (`PP, P, M, G, GG`), Sequencial e Baralhos Customizados.
- **Controle de Rodada:**
  - Votos secretos até a revelação.
  - Auto-revelação opcional quando todos votarem.
  - Estatísticas automáticas pós-revelação (média, mediana, consenso e carta recomendada mais próxima).
  - Cronômetro integrado configurável.
- **Gestão de Histórias / Backlog:** Adicione histórias com títulos, descrições e links, estime uma a uma e guarde o histórico de pontuações.
- **Reconexão Inteligente:** Token de sessão no navegador que permite atualizar a página sem perder o lugar ou o voto.
- **Segurança:** Tokens de autenticação por participante, chaves sensíveis nunca expostas ao cliente, e validação rigorosa no backend.

---

## 🛠️ Tecnologias

- **Frontend:** HTML5, Vanilla JavaScript, CSS moderno (Design System dark mode com glassmorphism).
- **Backend:** Node.js Nativo (sem frameworks pesados).
- **Tempo Real / Persistência:**
  - **Local:** Server-Sent Events (SSE) + In-Memory Store.
  - **Produção:** Supabase (Postgres + Realtime Broadcast / Presence).
- **Deploy:** Vercel (Serverless Functions + Static Hosting).

---

## 💻 Como Rodar Localmente

1. Clone o repositório:
   ```bash
   git clone https://github.com/DavidDev0x/planning-poker.git
   cd planning-poker
   ```

2. (Opcional) Copie o arquivo de exemplo de ambiente:
   ```bash
   cp .env.example .env
   ```
   *Nota: O modo local roda perfeitamente sem variáveis de ambiente configuradas, usando armazenamento em memória e SSE.*

3. Inicie o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

4. Acesse no navegador:
   ```
   http://localhost:3000
   ```

---

## 🧪 Testes

Para rodar a suíte completa de testes automatizados (unitários e concorrência/integração com 15 clientes simultâneos):

```bash
npm test
```

---

## ☁️ Deploy na Vercel com Supabase

1. Crie um projeto no [Supabase](https://supabase.com).
2. No **SQL Editor** do Supabase, execute o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
3. Na Vercel, importe este repositório e configure as variáveis de ambiente:
   - `SUPABASE_URL`: URL do seu projeto Supabase.
   - `SUPABASE_ANON_KEY`: Chave anônima / pública (`anon` ou `sb_publishable_...`).
   - `SUPABASE_SERVICE_ROLE_KEY`: Chave secreta de serviço (`service_role` ou `sb_secret_...`).
4. Clique em **Deploy**.

---

## 🔒 Segurança

- Nenhuma chave secreta (`SUPABASE_SERVICE_ROLE_KEY`) é exposta ao navegador.
- Arquivos de credenciais (`.env`) estão listados no `.gitignore`.
