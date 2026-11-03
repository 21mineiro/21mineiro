# Desafios & Treinos

App simples (PWA) para acompanhar desafios e treinos de academia, feito para usar no celular.

## O que faz

- **Desafios** – crie desafios como "20 dias sem açúcar" ou "21 dias de academia". O app conta:
  dia atual do desafio, dias feitos, quantos faltam, sequência (🔥) e falhas. Calendário para marcar/desmarcar qualquer dia passado.
- **Treinos** – cadastre treinos (A, B, C…) com exercícios (séries, reps, carga) e os dias da semana de cada um.
- **Hoje** – mostra os desafios ativos para marcar e o treino do dia. Marque cada exercício feito e ajuste
  séries/reps/kg na hora; o ajuste fica salvo para o próximo treino. Ao "Concluir treino", desafios com
  a opção *marcar automaticamente* recebem o check do dia.
- **Histórico** – todos os treinos registrados, totais, e backup (exportar/importar arquivo JSON).

## Dados

Ficam salvos no próprio aparelho (`localStorage`). Use **Exportar** no Histórico para fazer backup ou levar para outro celular.

## Como usar

Não precisa instalar nada nem compilar. Basta publicar a pasta em qualquer hospedagem estática
(GitHub Pages, Netlify, Vercel) e abrir no celular. No navegador, use "Adicionar à tela inicial" para ter como app.

Para testar no computador:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```
