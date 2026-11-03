# Publicar nas lojas

App: **Desafios & Treinos** · site: https://desafios-treinos.netlify.app

Pronto no repositório:
- `mobile/` — app iOS (Capacitor) que abre o site, com ícone da medalha, splash, lembrete diário e vibração nativos
- `codemagic.yaml` — build do iPhone na nuvem, sem Mac
- `store/screenshots/` — prints do iPhone (6,7" e 6,1") · `store/icon-1024.png` — ícone da loja
- Política de privacidade: https://desafios-treinos.netlify.app/privacidade.html
- Suporte: https://desafios-treinos.netlify.app/suporte.html
- Excluir conta dentro do app (Perfil → Conta), exigência das duas lojas

---

## Textos da loja (iguais nas duas)

**Nome:** Desafios & Treinos
**Subtítulo / descrição curta (até 30/80 caracteres):**
- Apple: `Desafios, treino e sequência`
- Google: `Desafios com amigos, treino do dia e sua sequência de dias, tudo em um só lugar.`

**Descrição:**
```
Crie desafios como "20 dias sem açúcar" ou "21 dias de academia", chame os amigos e acompanhe a sequência de cada um, dia após dia.

• Desafios em grupo com ranking e contagem de dias
• Treino do dia com séries, cargas e descanso cronometrado
• Treinos montados pelo seu treinador, ou crie o seu
• Registro de cardio: tipo e minutos
• Evolução com gráficos, mapa de dias treinados e níveis
• Lembrete diário para não quebrar a sequência
• Frase do dia: versículos e frases de grandes atletas

Para treinadores: acompanhe quem está treinando, quanto e o quê, e monte treinos específicos para cada aluno.
```
**Palavras-chave (Apple, até 100):** `desafio,treino,academia,hábito,sequência,musculação,cardio,treinador,fitness,sem açúcar`
**Categoria:** Saúde e fitness
**Classificação etária:** Livre (4+)
**Preço:** Grátis, sem compras no app

**Privacidade (formulários das lojas):** coleta nome, e-mail, fotos que o usuário envia e dados de treino/desafios. Usados só para o funcionamento do app; não vende dados, não usa para anúncios, sem rastreamento. Dados criptografados em trânsito; o usuário pode excluir a conta no app.

---

## Google Play (Android) — US$ 25, uma vez

1. Crie a conta em https://play.google.com/console (conta pessoal pede 12 testadores por 14 dias antes de publicar; conta de empresa com CNPJ não pede).
2. Abra https://www.pwabuilder.com, cole `https://desafios-treinos.netlify.app` → **Package for stores → Android**.
   - Package ID: `app.desafiostreinos` · Nome: `Desafios & Treinos` · Gerar.
   - Baixe o .zip: tem o `.aab` (envia pra loja) e o `signing.keystore` + senha (**guarde para sempre**, sem ele não dá para atualizar o app).
3. No Play Console: Criar app → envie o `.aab` em Testes → preencha a ficha com os textos acima, ícone `store/icon-1024.png` (redimensionar para 512) e os prints.
4. Me mande a impressão digital **SHA-256** (Play Console → Configuração → Integridade do app → Assinatura do app). Eu coloco o arquivo `assetlinks.json` no site, e a barra do navegador some de dentro do app.

## Apple (iPhone) — US$ 99 por ano

1. Inscreva-se no Apple Developer Program: https://developer.apple.com/programs/enroll (pessoa física ou CNPJ, aprovação leva de 1 a 2 dias).
2. Em https://appstoreconnect.apple.com → Apps → **+ Novo app**: plataforma iOS, nome `Desafios & Treinos`, idioma Português (Brasil), Bundle ID `app.desafiostreinos` (registre antes em developer.apple.com → Identifiers), SKU `desafios-treinos`.
3. Em Usuários e acesso → Integrações → **App Store Connect API**: gere uma chave (função Admin) e baixe o `.p8`.
4. Em https://codemagic.io (plano grátis tem 500 minutos/mês de Mac): conecte o GitHub e este repositório.
   - Teams → Integrations → App Store Connect: envie a chave `.p8` com o nome **appstore**.
   - Em Environment variables, crie `APP_STORE_APPLE_ID` com o número "Apple ID" do app (aparece em App Store Connect → Informações do app).
   - Rode o workflow **iOS → TestFlight**. Em uns 15 minutos o app aparece no TestFlight do seu iPhone.
5. Testou e está ok: no App Store Connect preencha a ficha (textos, prints de `store/screenshots/iphone-6.7`, privacidade, suporte), escolha o build e **Enviar para revisão**.
   - Na revisão, dê uma conta de teste (e-mail e senha) nas "Informações para revisão".
   - No iPhone o login é por e-mail e senha (o Google não funciona dentro de app da Apple).

Atualizações do site entram no app na hora, sem nova revisão. Só é preciso um novo build se mudar ícone, nome ou recursos nativos.
