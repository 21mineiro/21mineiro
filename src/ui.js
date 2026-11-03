/*
 * Componentes visuais do app: gráficos em SVG, dicas ao tocar (tooltip),
 * celebração com confete, vibração, timer de descanso, níveis e frases do dia.
 *
 * Os gráficos seguem regras de leitura: marcas finas, uma só escala por gráfico,
 * cor da série só nas marcas (textos sempre na cor de texto), valor também
 * disponível sem toque (rótulos seletivos e "Ver dados").
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let uidN = 0;
const uid = (p) => `${p}${++uidN}`;

/* ---------- Escala "redonda" para eixos ---------- */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/* ---------- Anel de progresso (um tom só, trilho no mesmo tom) ---------- */
export function ring({ value = 0, max = 1, center = '', sub = '', label = '', stroke = 11 } = {}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 50 - stroke / 2 - 1;
  const C = 2 * Math.PI * r;
  const id = uid('rg');
  return `
    <div class="ring" role="img" aria-label="${esc(label)}">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color:var(--ring-a)"/><stop offset="1" style="stop-color:var(--ring-b)"/>
        </linearGradient></defs>
        <circle class="ring-track" cx="50" cy="50" r="${r}" fill="none" stroke-width="${stroke}"/>
        ${pct > 0 ? `<circle class="ring-fill" cx="50" cy="50" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(2)}"/>` : ''}
      </svg>
      <div class="ring-center"><b>${center}</b><span>${sub}</span></div>
    </div>`;
}

/* ---------- Minigráfico de tendência (contexto em cinza, ponto atual em destaque) ---------- */
// fromZero: contagens começam no zero; cargas usam o menor valor para mostrar a evolução
export function sparkline(values, label = '', { fromZero = true } = {}) {
  if (!values.length) return '';
  const W = 120, H = 26, P = 4;
  const max = Math.max(...values, fromZero ? 1 : -Infinity), min = fromZero ? Math.min(...values, 0) : Math.min(...values);
  const x = (i) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <path class="sl" d="${d}"/><circle class="se" cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="3.5"/></svg>`;
}

/* ---------- Tabela com os dados do gráfico (acessibilidade) ---------- */
export function vizTable(headers, rows) {
  return `<details class="viz-table"><summary>Ver dados</summary><table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}

/* ---------- Colunas (uma série, ou "planejado × feito") ---------- */
// bars: [{ label, value, plan?, tip }]
export function columns(bars, { unit = '', height = 150, title = '', planned = false, labelEvery = 0 } = {}) {
  if (!bars.length) return '';
  const W = 320, H = height, P = { l: 30, r: 6, t: 16, b: 22 };
  const top = niceMax(Math.max(...bars.map((b) => Math.max(b.value, planned ? b.plan || 0 : 0)), 1));
  const band = (W - P.l - P.r) / bars.length;
  const bw = Math.min(24, band * 0.62);
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const base = H - P.b;
  const ticks = [0, top / 2, top];
  const every = labelEvery || Math.ceil(bars.length / 8);
  const maxIdx = bars.reduce((m, b, i) => (b.value > bars[m].value ? i : m), 0);
  const col = (x, w, v) => {
    const h = Math.max(0, base - y(v));
    if (h <= 0) return '';
    const r = Math.min(4, h, w / 2);
    const yt = base - h;
    return `M${x},${base}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + w - r}Q${x + w},${yt} ${x + w},${yt + r}V${base}Z`;
  };
  let marks = '', hits = '', labels = '';
  bars.forEach((b, i) => {
    const cx = P.l + band * i + band / 2;
    if (planned) {
      const gw = Math.min(26, band * 0.78);
      marks += `<path class="ghost" d="${col(cx - gw / 2, gw, b.plan || 0)}"/>`;
      marks += `<path class="s1" d="${col(cx - bw * 0.32, bw * 0.64, b.value)}"/>`;
    } else {
      marks += `<path class="s1" d="${col(cx - bw / 2, bw, b.value)}"/>`;
    }
    // rótulo seletivo: só o último e o maior
    if ((i === bars.length - 1 || i === maxIdx) && b.value > 0) {
      labels += `<text class="val" x="${cx}" y="${y(Math.max(b.value, planned ? b.plan || 0 : 0)) - 5}" text-anchor="middle">${fmt(b.value)}</text>`;
    }
    if (i % every === 0 || i === bars.length - 1) labels += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    hits += `<rect class="hit" x="${P.l + band * i}" y="${P.t}" width="${band}" height="${H - P.t}" tabindex="0" data-tip="${esc(b.tip || `${fmt(b.value)}${unit}|${b.label}`)}"/>`;
  });
  const grid = ticks.map((t) => `<line class="${t ? 'gridline' : 'baseline'}" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/>
    <text x="${P.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`).join('');
  return `<div class="viz"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${marks}${labels}${hits}</svg></div>`;
}

/* ---------- Linha com cruzeta ao tocar ---------- */
// points: [{ x: rótulo curto, value, tip }]
export function lineChart(points, { unit = '', height = 180, title = '' } = {}) {
  if (points.length < 2) return '';
  const W = 320, H = height, P = { l: 34, r: 30, t: 14, b: 22 };
  let min = Math.min(...points.map((p) => p.value)), max = Math.max(...points.map((p) => p.value));
  const pad = (max - min) * 0.15 || Math.max(1, max * 0.1);
  min = Math.max(0, min - pad); max += pad;
  const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${d}L${x(points.length - 1).toFixed(1)},${H - P.b}L${x(0).toFixed(1)},${H - P.b}Z`;
  const ticks = [min, (min + max) / 2, max];
  const last = points[points.length - 1];
  const coords = points.map((p, i) => [Math.round(x(i) * 10) / 10, Math.round(y(p.value) * 10) / 10, p.tip || `${fmt(p.value)}${unit}|${p.x}`]);
  return `<div class="viz"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    ${ticks.map((t, i) => `<line class="${i ? 'gridline' : 'baseline'}" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text x="${P.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t, 0)}</text>`).join('')}
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    <text x="${x(0)}" y="${H - 6}" text-anchor="start">${esc(points[0].x)}</text>
    <text x="${x(points.length - 1)}" y="${H - 6}" text-anchor="end">${esc(last.x)}</text>
    <circle class="pt" cx="${x(points.length - 1)}" cy="${y(last.value)}" r="4.5"/>
    <text class="val" x="${x(points.length - 1) + 7}" y="${y(last.value) + 4}">${fmt(last.value)}</text>
    <line class="cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/>
    <circle class="pt hl" r="5" cx="0" cy="0" visibility="hidden"/>
    <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" tabindex="0" data-line="${esc(JSON.stringify(coords))}"/>
  </svg></div>`;
}

/* ---------- Mapa de calor (constelação de dias ativos) ---------- */
// counts: Map 'YYYY-MM-DD' -> nº de atividades; weeks colunas, domingo a sábado
export function heatmap(counts, today, { weeks = 16, dateStr, addDays, label } = {}) {
  const t = new Date(`${today}T12:00:00`);
  const start = addDays(today, -t.getDay() - (weeks - 1) * 7); // domingo da 1ª coluna
  const cells = [], months = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const first = new Date(`${addDays(start, w * 7)}T12:00:00`);
    if (first.getMonth() !== lastMonth) {
      months.push(`<span style="grid-column:${w + 1} / span ${Math.min(3, weeks - w)}">${first.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>`);
      lastMonth = first.getMonth();
    }
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      if (day > today) { cells.push('<i class="fut"></i>'); continue; }
      const n = counts.get(day) || 0;
      const lv = n >= 5 ? 5 : n;
      const when = new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      cells.push(`<i class="${lv ? `h${lv}` : ''} ${day === today ? 'today' : ''}" tabindex="0" data-tip="${n} ${n === 1 ? 'atividade' : 'atividades'}|${esc(when)}"></i>`);
    }
  }
  return `<div class="heat-months" style="grid-template-columns:repeat(${weeks},1fr)">${months.join('')}</div>
    <div class="heat" role="img" aria-label="${esc(label)}">${cells.join('')}</div>
    <div class="heat-scale">Menos <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i><i style="background:var(--heat-5)"></i> Mais</div>`;
}

/* ---------- Dica ao tocar / passar o mouse ---------- */
const tip = () => document.getElementById('tip');
function showTip(text, rect) {
  const el = tip();
  if (!el || !text) return;
  const [value, label] = String(text).split('|');
  el.replaceChildren();
  const b = document.createElement('b'); b.textContent = value; el.append(b);
  if (label) el.append(document.createTextNode(label));
  el.hidden = false;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  let top = rect.top - h - 8;
  if (top < 8) top = rect.bottom + 8;
  el.style.left = `${left}px`; el.style.top = `${top}px`;
}
function hideTip() { const el = tip(); if (el) el.hidden = true; }

function lineHover(hit, clientX) {
  const svg = hit.ownerSVGElement;
  const pts = JSON.parse(hit.dataset.line);
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const sx = ((clientX - box.left) / box.width) * vb.width;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p[0] - sx) < Math.abs(best[0] - sx)) best = p;
  const cross = svg.querySelector('.cross'), dot = svg.querySelector('.pt.hl');
  cross.setAttribute('x1', best[0]); cross.setAttribute('x2', best[0]); cross.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', best[0]); dot.setAttribute('cy', best[1]); dot.setAttribute('visibility', 'visible');
  const px = box.left + (best[0] / vb.width) * box.width, py = box.top + (best[1] / vb.height) * box.height;
  showTip(best[2], { left: px - 1, top: py - 6, width: 2, height: 2, bottom: py + 6 });
}
function lineOut(hit) {
  const svg = hit.ownerSVGElement;
  svg.querySelector('.cross')?.setAttribute('visibility', 'hidden');
  svg.querySelector('.pt.hl')?.setAttribute('visibility', 'hidden');
}

export function initTooltips() {
  document.addEventListener('pointermove', (e) => {
    const line = e.target.closest?.('[data-line]');
    if (line) return lineHover(line, e.clientX);
    const t = e.target.closest?.('[data-tip]');
    if (t) showTip(t.dataset.tip, t.getBoundingClientRect());
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    const line = e.target.closest?.('[data-line]');
    if (line) return lineHover(line, e.clientX);
    const t = e.target.closest?.('[data-tip]');
    if (t) showTip(t.dataset.tip, t.getBoundingClientRect()); else hideTip();
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const line = e.target.closest?.('[data-line]');
    if (line && e.pointerType === 'mouse') { lineOut(line); hideTip(); }
    else if (e.target.closest?.('[data-tip]') && e.pointerType === 'mouse') hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const line = e.target.closest?.('[data-line]');
    if (line) { const r = line.getBoundingClientRect(); return lineHover(line, r.right - 2); }
    const t = e.target.closest?.('[data-tip]');
    if (t) showTip(t.dataset.tip, t.getBoundingClientRect());
  });
  document.addEventListener('focusout', (e) => { if (e.target.closest?.('[data-line]')) lineOut(e.target); hideTip(); });
  window.addEventListener('scroll', hideTip, { passive: true });
}

/* ---------- Vibração e confete ---------- */
export function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* sem suporte */ }
}

const CONFETTI = ['#8b5cf6', '#ec4899', '#f59e0b', '#22d3ee', '#a3e635', '#ffffff'];
export function celebrate(size = 'small', origin = null) {
  if (reduceMotion()) return;
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const ox = origin ? origin.left + origin.width / 2 : innerWidth / 2;
  const oy = origin ? origin.top + origin.height / 2 : innerHeight * 0.35;
  const n = size === 'big' ? 150 : 46;
  const parts = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = (size === 'big' ? 7 : 4.5) * (0.5 + Math.random());
    return {
      x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (size === 'big' ? 6 : 3.5),
      s: 4 + Math.random() * 5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: CONFETTI[(Math.random() * CONFETTI.length) | 0], round: Math.random() < 0.3,
    };
  });
  const t0 = performance.now();
  const dur = size === 'big' ? 2200 : 1300;
  (function frame(t) {
    const k = (t - t0) / dur;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.22; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

/* ---------- Timer de descanso entre séries ---------- */
let rest = null;
let audioCtx = null;
export const restDefault = () => { try { return Number(localStorage.getItem('rest-sec')) || 90; } catch { return 90; } };
export const setRestDefault = (s) => { try { localStorage.setItem('rest-sec', String(s)); } catch { /* ignora */ } };

function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.25);
  } catch { /* sem áudio */ }
}

function restUI() {
  if (!rest) return;
  const left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
  const total = rest.total;
  const C = 2 * Math.PI * 14;
  rest.el.querySelector('.t').textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Bora!';
  rest.el.querySelector('.lbl').textContent = left ? 'descanso' : 'próxima série 💪';
  rest.el.querySelector('.mini-ring .f').setAttribute('stroke-dashoffset', (C * (1 - left / total)).toFixed(1));
  if (!left && !rest.finished) {
    rest.finished = true;
    rest.el.classList.add('done');
    haptic([180, 80, 180]); beep();
    setTimeout(stopRest, 4000);
  }
}

export function startRest(seconds = restDefault()) {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch { /* sem áudio */ }
  stopRest();
  const el = document.createElement('div');
  el.className = 'rest';
  el.setAttribute('role', 'timer');
  const C = (2 * Math.PI * 14).toFixed(1);
  el.innerHTML = `
    <svg class="mini-ring" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="14" fill="none" stroke="var(--track)" stroke-width="4"/>
      <circle class="f" cx="17" cy="17" r="14" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
    <div><div class="t"></div><div class="lbl"></div></div>
    <button type="button" data-rest="plus" aria-label="Mais 15 segundos">+15s</button>
    <button type="button" data-rest="stop" aria-label="Pular descanso">Pular</button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rest]');
    if (!b || !rest) return;
    if (b.dataset.rest === 'plus') { rest.end += 15000; rest.total += 15; rest.finished = false; el.classList.remove('done'); restUI(); }
    else stopRest();
  });
  document.body.appendChild(el);
  rest = { el, end: Date.now() + seconds * 1000, total: seconds, finished: false, timer: setInterval(restUI, 250) };
  restUI();
}

export function stopRest() {
  if (!rest) return;
  clearInterval(rest.timer);
  rest.el.remove();
  rest = null;
}

/* ---------- Níveis de energia ---------- */
export const LEVELS = [
  { min: 0, name: 'Faísca', icon: '✨' },
  { min: 100, name: 'Chama', icon: '🔥' },
  { min: 250, name: 'Cometa', icon: '☄️' },
  { min: 500, name: 'Estrela', icon: '⭐' },
  { min: 900, name: 'Constelação', icon: '🌌' },
  { min: 1500, name: 'Nebulosa', icon: '🌠' },
  { min: 2300, name: 'Galáxia', icon: '🌀' },
  { min: 3300, name: 'Supernova', icon: '💥' },
  { min: 4600, name: 'Quasar', icon: '🔆' },
  { min: 6200, name: 'Lenda Astral', icon: '👑' },
];
export function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  return { n: i + 1, ...cur, next, pct: next ? (xp - cur.min) / (next.min - cur.min) : 1, toNext: next ? next.min - xp : 0 };
}

/* ---------- Saudação e frase do dia ---------- */
export function greeting(name) {
  const h = new Date().getHours();
  const first = String(name || '').split(' ')[0];
  const [txt, ico] = h < 5 ? ['Boa madrugada', '🌙'] : h < 12 ? ['Bom dia', '☀️'] : h < 18 ? ['Boa tarde', '🌤️'] : ['Boa noite', '🌙'];
  return `${txt}${first ? `, ${first}` : ''} ${ico}`;
}

const QUOTES = [
  ['Devagar se vai ao longe.', 'ditado popular'],
  ['Água mole em pedra dura, tanto bate até que fura.', 'ditado popular'],
  ['Um dia de cada vez.', 'ditado popular'],
  ['Quem não arrisca não petisca.', 'ditado popular'],
  ['De grão em grão, a galinha enche o papo.', 'ditado popular'],
  ['Mais vale um feito do que cem prometidos.', 'ditado popular'],
  ['Depois da tempestade vem a bonança.', 'ditado popular'],
  ['Pra frente é que se anda.', 'ditado popular'],
  ['Disciplina é lembrar o que você quer.', 'frase do dia'],
  ['O treino de hoje é o resultado de amanhã.', 'frase do dia'],
  ['Feito é melhor que perfeito.', 'frase do dia'],
  ['Sua única competição é você de ontem.', 'frase do dia'],
  ['Constância vence intensidade.', 'frase do dia'],
  ['Pequenos passos, grandes órbitas.', 'frase do dia'],
  ['Hoje conta. Marca e segue.', 'frase do dia'],
  ['Cansaço passa, orgulho fica.', 'frase do dia'],
  ['Começa onde você está, com o que você tem.', 'frase do dia'],
  ['Corpo em movimento, cabeça leve.', 'frase do dia'],
  ['A sequência é sua: proteja ela.', 'frase do dia'],
  ['Não precisa ser fácil, só precisa ser feito.', 'frase do dia'],
  ['Alto astral também se treina.', 'frase do dia'],
];
export function quoteOfDay(day) {
  const n = day.split('-').reduce((t, x) => t * 31 + Number(x), 7);
  return QUOTES[n % QUOTES.length];
}
