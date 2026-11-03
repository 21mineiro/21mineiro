# Desafios & Treinos

No ar: https://polite-alfajores-c0ecb9.netlify.app (deploy automático pela Netlify a cada push).

App (PWA) para acompanhar desafios com amigos e treinos de academia, feito para usar no celular.

## Funcionalidades

- **Login com Google** (Netlify Identity) e dados na nuvem (Netlify Database / Postgres).
- **Desafios** de três tipos:
  - *Todo dia* — fiz / não fiz (ex.: 20 dias sem açúcar).
  - *Quantidade por dia* — meta com unidade (ex.: 2 L de água).
  - *Vezes por semana* — ex.: correr 3x por semana.
  Contagem de dias feitos, quantos faltam, sequência 🔥, falhas e calendário.
- **Anotação e foto** em qualquer dia (fotos no Netlify Blobs, visíveis só para participantes).
- **Desafios em grupo**: convite por código/link, ranking e quem já marcou hoje.
- **Treinos**: treinos por dia da semana, carga e repetições **por série**. O próximo treino já vem
  com as cargas do último. Concluir o treino marca os desafios ligados à academia.
- **Gráfico de evolução** da carga por exercício.
- **Conquistas** (sequências, treinos, recordes…).
- **Lembrete diário** por notificação (no iPhone: app adicionado à Tela de Início, iOS 16.4+).
- **Tema** claro, escuro ou automático.
- **Planilha de corrida por assinatura** (aba Corrida):
  - Planos **Básico R$ 20/mês** (planilha automática) e **Premium R$ 50/mês** (+ ajustes e chat com o treinador), 7 dias grátis.
  - Questionário (objetivo 5k–42k, nível, dias, tempo nos 5 km, data da prova) → planilha gerada com fases e ritmos.
  - Registro de cada corrida (km, tempo, esforço, comentário).
  - **Painel do treinador**: lista de alunos, adesão, editar/adicionar treinos, refazer planilha, liberar acesso manual e chat.
  - Pagamento recorrente pelo **Mercado Pago** (assinaturas / preapproval).
  - A planilha é gerada por **IA (Claude)** com a ficha e as regras do treinador (`netlify/lib/ai-plan.mts`), em segundo plano
    (`netlify/functions/plan-bg.mts`). Sem chave da IA (opcional), ou se ela falhar, usa o gerador próprio no mesmo método, sem custo (`netlify/lib/running-plan.mts`).
  - Visão em lista ou grade semana × dia, download em PDF, Excel e CSV.

## Estrutura

```
src/                         front-end (HTML, CSS, JS) → build gera dist/
netlify/functions/api.mts    API (/api/*)
netlify/functions/reminders.mts  lembretes (roda toda hora)
netlify/database/migrations  tabelas do banco
```

## Configuração na Netlify

1. **Identity**: em *Project configuration → Identity*, clique em *Enable Identity* e, em
   *Registration → External providers*, adicione **Google**.
2. **Variáveis de ambiente** (para notificações): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (gere com `npx web-push generate-vapid-keys`).
3. **Treinador**: `COACH_EMAILS` com os e-mails dos treinadores (separados por vírgula).
4. **Mercado Pago**: `MP_ACCESS_TOKEN` (credencial de produção) e `MP_WEBHOOK_SECRET`. Em *Suas integrações → Webhooks*,
   cadastre `https://SEU-SITE/api/mp/webhook` com os eventos *Planos e assinaturas*.
5. **IA (opcional)**: `ANTHROPIC_API_KEY` para gerar as planilhas com IA. Sem ela, o app usa o gerador próprio.
6. O banco é criado sozinho no deploy (pacote `@netlify/database`) e as migrações são aplicadas automaticamente.

## Desenvolvimento

```bash
npm install
npm run build
```
