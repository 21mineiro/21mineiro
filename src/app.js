import { getUser, getSettings, handleAuthCallback, oauthLogin, logout, refreshSession } from '@netlify/identity';
import { ring, sparkline, columns, lineChart, heatmap, vizTable, initTooltips, haptic, celebrate, startRest, stopRest, restDefault, setRestDefault, levelFor, greeting, quoteOfDay } from './ui.js';

/* ================= Utilidades ================= */

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const todayStr = () => dateStr(new Date());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); };
const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const fmtDate = (s, opts = { day: '2-digit', month: 'short' }) => parseDate(s).toLocaleDateString('pt-BR', opts);

const store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } },
};

// Avisos aparecem um de cada vez
let toastQueue = Promise.resolve();
function toast(msg, ms = 2200) {
  toastQueue = toastQueue.then(() => new Promise((done) => {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); done(); }, ms);
  }));
}

/* ================= Tema ================= */

function applyTheme() {
  const t = store.get('theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').setAttribute('content', dark ? '#0a0a1f' : '#f5f3ff');
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ================= API ================= */

// Em desenvolvimento local (netlify dev) o login do Google não funciona; usa um usuário de teste.
const DEV_USER = location.hostname === 'localhost' ? store.get('dev-user') : null;

async function api(path, { method = 'GET', body, raw, retry = true } = {}) {
  const headers = {};
  if (DEV_USER) headers['x-dev-user'] = JSON.stringify(DEV_USER);
  if (raw) headers['content-type'] = raw.type || 'image/jpeg';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/${path}`, {
    method, headers, credentials: 'same-origin',
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && retry && !DEV_USER) {
    try { await refreshSession(); return api(path, { method, body, raw, retry: false }); } catch { /* sem sessão */ }
    showLogin(); throw new Error('Faça login');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro de conexão');
  return data;
}

// Executa uma alteração: atualiza a tela na hora e salva em segundo plano
async function save(promise) {
  render();
  try { await promise; } catch (e) { toast(`⚠️ ${e.message}`); await reload(); }
}

/* ================= Estado ================= */

let S = null;           // dados vindos do servidor
let tab = store.get('tab', 'hoje');

async function reload() {
  const [state] = await Promise.all([api('state'), loadRun()]);
  S = state;
  render();
}

const myId = () => S.me.id;
const byId = (list, id) => list.find((x) => x.id === id);

/* ================= Contagem dos desafios ================= */

function myChecks(c, userId = myId()) { return c.checkins[userId] || {}; }

function dayDone(c, entry) {
  if (!entry) return false;
  return c.kind === 'quantity' ? entry.value >= (c.target || 1) : entry.value > 0;
}

function challengeStats(c, userId = myId(), today = todayStr()) {
  const checks = myChecks(c, userId);
  const end = addDays(c.start, c.days - 1);
  let status = 'ativo';
  const base = { end, dayNum: Math.max(0, Math.min(diffDays(c.start, today) + 1, c.days)) };

  if (c.kind === 'weekly') {
    const weeks = Math.ceil(c.days / 7);
    let doneWeeks = 0, missed = 0, best = 0, run = 0, curCount = 0;
    const curWeek = Math.floor(diffDays(c.start, today) / 7);
    const okWeeks = [];
    for (let w = 0; w < weeks; w++) {
      const len = Math.min(7, c.days - w * 7);
      const goal = Math.min(c.target || 1, len);
      let count = 0;
      for (let i = 0; i < len; i++) if (dayDone(c, checks[addDays(c.start, w * 7 + i)])) count++;
      const ok = count >= goal;
      okWeeks.push(ok);
      if (w === curWeek) curCount = count;
      if (ok) { doneWeeks++; run++; best = Math.max(best, run); } else if (w < curWeek) { missed++; run = 0; }
    }
    // semanas seguidas na meta (a semana atual só conta se já bateu a meta)
    let streak = 0;
    for (let w = Math.min(curWeek, weeks - 1) - (okWeeks[curWeek] ? 0 : 1); w >= 0 && okWeeks[w]; w--) streak++;
    if (today < c.start) status = 'futuro';
    else if (doneWeeks >= weeks) status = 'concluído';
    else if (today > end) status = 'encerrado';
    return { ...base, status, weekly: true, weeks, done: doneWeeks, left: weeks - doneWeeks, missed, streak, best, curCount,
      curWeek: Math.min(curWeek + 1, weeks), pct: Math.round((doneWeeks / weeks) * 100) };
  }

  let done = 0, missed = 0, best = 0, run = 0;
  for (let i = 0; i < c.days; i++) {
    const d = addDays(c.start, i);
    if (dayDone(c, checks[d])) { done++; run++; best = Math.max(best, run); } else { if (d < today) missed++; if (d < today) run = 0; }
  }
  let streak = 0;
  let cur = dayDone(c, checks[today]) ? today : addDays(today, -1);
  while (cur >= c.start && dayDone(c, checks[cur])) { streak++; cur = addDays(cur, -1); }
  if (today < c.start) status = 'futuro';
  else if (done >= c.days) status = 'concluído';
  else if (today > end) status = 'encerrado';
  return { ...base, status, done, missed, streak, best, left: Math.max(0, c.days - done), pct: Math.min(100, Math.round((done / c.days) * 100)) };
}

const isActive = (c) => challengeStats(c).status === 'ativo';
const unitLabel = (c) => (c.unit ? ` ${c.unit}` : '');

/* ================= Treinos ================= */

const workoutsForDay = (day) => S.workouts.filter((w) => w.weekdays.includes(parseDate(day).getDay()));
const findLog = (day, workoutId) => S.logs.find((l) => l.day === day && l.workoutId === workoutId);

// Novo registro: usa as cargas do último treino igual (ajuste automático), senão o modelo
function newLog(day, w) {
  const prev = S.logs.filter((l) => l.workoutId === w.id && l.day < day).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  return {
    day, workoutId: w.id, workoutName: w.name, finished: false,
    exercises: w.exercises.map((e) => {
      const last = prev?.exercises.find((x) => x.exId === e.id);
      const sets = last?.sets?.length
        ? last.sets.map((s) => ({ reps: s.reps, weight: s.weight, done: false }))
        : Array.from({ length: Math.max(1, e.sets) }, () => ({ reps: e.reps, weight: e.weight, done: false }));
      return { exId: e.id, name: e.name, sets };
    }),
  };
}

function getOrCreateLog(day, w) {
  let log = findLog(day, w.id);
  if (!log) { log = newLog(day, w); S.logs.unshift(log); }
  return log;
}

const saveLog = (log, syncChallenges = false) => api('logs', { method: 'PUT', body: { ...log, syncChallenges } });

// Maior carga feita em cada dia, por exercício (para o gráfico)
function exerciseHistory(name) {
  const key = name.trim().toLowerCase();
  const points = {};
  for (const l of S.logs) {
    for (const e of l.exercises) {
      if (e.name.trim().toLowerCase() !== key) continue;
      const sets = e.sets.filter((s) => s.done || l.finished);
      if (!sets.length) continue;
      const max = Math.max(...sets.map((s) => Number(s.weight) || 0));
      const vol = sets.reduce((t, s) => t + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
      if (!points[l.day] || points[l.day].max < max) points[l.day] = { day: l.day, max, vol };
    }
  }
  return Object.values(points).sort((a, b) => (a.day < b.day ? -1 : 1));
}

/* ================= Conquistas ================= */

function computeBadges() {
  const me = myId();
  const finished = S.logs.filter((l) => l.finished).length;
  const won = S.challenges.filter((c) => challengeStats(c).status === 'concluído').length;
  const best = Math.max(0, ...S.challenges.filter((c) => c.kind !== 'weekly').map((c) => challengeStats(c).best));
  const anyCheck = S.challenges.some((c) => Object.keys(myChecks(c)).length);
  const diary = S.challenges.reduce((t, c) => t + Object.values(myChecks(c)).filter((k) => k.note || k.photo).length, 0);
  const group = S.challenges.some((c) => c.members.length > 1);
  const names = new Set(S.logs.flatMap((l) => l.exercises.map((e) => e.name.trim().toLowerCase())));
  const pr = [...names].some((n) => { const h = exerciseHistory(n); return h.length > 1 && Math.max(...h.map((p) => p.max)) > h[0].max; });
  const weeklyWin = S.challenges.some((c) => c.kind === 'weekly' && challengeStats(c, me).best >= 4);

  return [
    { id: 'first', icon: '✅', name: 'Primeiro passo', desc: 'Marcar o primeiro dia', ok: anyCheck },
    { id: 's7', icon: '🔥', name: '7 dias seguidos', desc: 'Sequência de 7 dias', ok: best >= 7 },
    { id: 's14', icon: '⚡', name: '14 dias seguidos', desc: 'Sequência de 14 dias', ok: best >= 14 },
    { id: 's21', icon: '💎', name: '21 dias seguidos', desc: 'Hábito formado!', ok: best >= 21 },
    { id: 's30', icon: '👑', name: '30 dias seguidos', desc: 'Um mês sem falhar', ok: best >= 30 },
    { id: 'w4', icon: '📆', name: '4 semanas na meta', desc: 'Meta semanal 4x seguidas', ok: weeklyWin },
    { id: 'win1', icon: '🏆', name: 'Campeão', desc: 'Vencer um desafio', ok: won >= 1 },
    { id: 'win3', icon: '🥇', name: 'Tricampeão', desc: 'Vencer 3 desafios', ok: won >= 3 },
    { id: 'g1', icon: '🏋️', name: 'Primeiro treino', desc: 'Concluir 1 treino', ok: finished >= 1 },
    { id: 'g10', icon: '💪', name: '10 treinos', desc: 'Concluir 10 treinos', ok: finished >= 10 },
    { id: 'g50', icon: '🦾', name: '50 treinos', desc: 'Concluir 50 treinos', ok: finished >= 50 },
    { id: 'g100', icon: '🦍', name: '100 treinos', desc: 'Concluir 100 treinos', ok: finished >= 100 },
    { id: 'pr', icon: '📈', name: 'Recorde pessoal', desc: 'Aumentar a carga de um exercício', ok: pr },
    { id: 'team', icon: '👥', name: 'Em equipe', desc: 'Participar de um desafio em grupo', ok: group },
    { id: 'diary', icon: '📸', name: 'Diário', desc: 'Anotar ou fotografar 5 dias', ok: diary >= 5 },
  ];
}

function checkNewBadges() {
  const key = `badges-${myId()}`;
  const seen = store.get(key);
  const earned = computeBadges().filter((b) => b.ok);
  if (seen) {
    const fresh = earned.filter((b) => !seen.includes(b.id));
    fresh.forEach((b) => toast(`🏅 Nova conquista: ${b.icon} ${b.name}`, 3000));
    if (fresh.length) setTimeout(() => celebrate('big'), 250);
  }
  store.set(key, earned.map((b) => b.id));
}

/* ================= Energia, níveis e atividade ================= */

// Atividades feitas por dia: dias de desafio marcados, treinos concluídos e corridas feitas
function activityByDay() {
  const m = new Map();
  const add = (d) => m.set(d, (m.get(d) || 0) + 1);
  for (const c of S.challenges) for (const [d, e] of Object.entries(myChecks(c))) if (dayDone(c, e)) add(d);
  for (const l of S.logs) if (l.finished) add(l.day);
  for (const s of R?.sessions || []) if (s.done) add(s.day);
  return m;
}

// Energia (XP): cada dia marcado, treino e corrida soma pontos
function computeXP() {
  let xp = 0;
  for (const c of S.challenges) for (const e of Object.values(myChecks(c))) if (dayDone(c, e)) xp += 10;
  xp += S.logs.filter((l) => l.finished).length * 30;
  for (const s of R?.sessions || []) if (s.done) xp += 20 + Math.round(2 * (Number(s.actualKm || s.distanceKm) || 0));
  xp += computeBadges().filter((b) => b.ok).length * 50;
  return xp;
}

function checkLevelUp() {
  const key = `level-${myId()}`;
  const lv = levelFor(computeXP());
  const prev = store.get(key);
  if (prev && lv.n > prev) { toast(`🚀 Novo nível: ${lv.icon} ${lv.name}!`, 3200); setTimeout(() => celebrate('big'), 150); }
  store.set(key, lv.n);
}

// Soma de uma medida por semana (domingo a sábado), das mais antigas para a atual
function weekly(weeks, valueOfDay) {
  const today = todayStr();
  const sunday = addDays(today, -parseDate(today).getDay());
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(sunday, -(weeks - 1 - i) * 7);
    let v = 0;
    for (let d = 0; d < 7; d++) v += valueOfDay(addDays(start, d)) || 0;
    return { start, value: Math.round(v * 10) / 10, label: fmtDate(start, { day: '2-digit', month: '2-digit' }) };
  });
}

const tile = (label, value, { delta = '', spark = '', up = false } = {}) => `
  <div class="tile"><div class="lbl">${label}</div><div class="v">${value}</div>${delta ? `<div class="d ${up ? 'up' : ''}">${delta}</div>` : ''}${spark}</div>`;

/* ================= Renderização ================= */

const $view = $('#view');
const TITLES = { hoje: 'Hoje', desafios: 'Desafios', treinos: 'Treinos', corrida: 'Corrida', perfil: 'Perfil' };
let enterAnim = true;   // animação de entrada ao abrir uma aba
let popSel = null;      // botão que acabou de ser marcado (efeito "pop")

function render() {
  if (!S) return;
  document.body.classList.remove('logged-out');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#hello').textContent = tab === 'hoje' ? greeting(S.me.name) : '';
  $('#title').textContent = TITLES[tab];
  const dt = fmtDate(todayStr(), { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
  $('#today').textContent = dt.charAt(0).toUpperCase() + dt.slice(1);
  $view.innerHTML = ({ hoje: viewToday, desafios: viewChallenges, treinos: viewWorkouts, corrida: viewRun, perfil: viewProfile }[tab] || viewToday)();
  if (enterAnim) { enterAnim = false; $view.classList.add('enter'); setTimeout(() => $view.classList.remove('enter'), 900); }
  if (popSel) { $view.querySelector(popSel)?.classList.add('pop'); popSel = null; }
  checkNewBadges();
  checkLevelUp();
}

const avatar = (m, size = 26) => m.avatar
  ? `<img class="avatar" src="${esc(m.avatar)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer">`
  : `<span class="avatar" style="width:${size}px;height:${size}px">${esc((m.name || '?')[0].toUpperCase())}</span>`;

function progressLine(c, s, today) {
  const e = myChecks(c)[today];
  if (c.kind === 'quantity') return `<span class="day-big">Hoje <b>${fmtNum(e?.value)}</b> / ${fmtNum(c.target)}${esc(unitLabel(c))}</span><span class="streak">🔥 ${s.streak}</span>`;
  if (c.kind === 'weekly') return `<span class="day-big">Semana: <b>${s.curCount}</b> de ${fmtNum(c.target)}x</span><span class="streak">🔥 ${s.streak} sem</span>`;
  return `<span class="day-big">Dia <b>${s.dayNum}</b> de ${c.days}</span><span class="streak">🔥 ${s.streak}</span>`;
}

function groupToday(c, today) {
  if (c.members.length < 2) return '';
  return `<div class="group-today">${c.members.map((m) => {
    const ok = dayDone(c, myChecks(c, m.id)[today]);
    return `<span class="mate ${ok ? 'ok' : ''}" title="${esc(m.name)}">${avatar(m, 22)}${ok ? '<i>✓</i>' : ''}</span>`;
  }).join('')}<span class="muted">${c.members.filter((m) => dayDone(c, myChecks(c, m.id)[today])).length}/${c.members.length} hoje</span></div>`;
}

function challengeToday(c, today) {
  const s = challengeStats(c);
  const entry = myChecks(c)[today];
  const on = dayDone(c, entry);
  const pct = c.kind === 'quantity' ? Math.min(100, Math.round(((entry?.value || 0) / (c.target || 1)) * 100)) : s.pct;
  const btn = c.kind === 'quantity'
    ? `<button class="check ${on ? 'on' : ''} qty" data-action="checkin" data-id="${c.id}" data-day="${today}" aria-label="Lançar quantidade">${on ? '✓' : '+'}</button>`
    : `<button class="check ${on ? 'on' : ''}" data-action="toggle" data-id="${c.id}" data-day="${today}" data-pop="c-${c.id}" aria-label="${on ? 'Desmarcar hoje' : 'Marcar hoje'}" aria-pressed="${on}">✓</button>`;
  return `
  <div class="card chal">
    <div class="row">
      <div class="emoji">${esc(c.emoji)}</div>
      <div class="grow">
        <div class="name">${esc(c.name)}</div>
        <div class="meta">${progressLine(c, s, today)}</div>
      </div>
      ${btn}
    </div>
    <div class="bar" role="img" aria-label="${pct}% concluído"><i style="width:${pct}%"></i></div>
    <div class="row between">
      ${groupToday(c, today) || `<span class="muted">${s.done} de ${s.weekly ? s.weeks : c.days} ${s.weekly ? 'semanas' : 'dias'} · ${pct}%</span>`}
      <button class="btn-link" data-action="checkin" data-id="${c.id}" data-day="${today}">${entry?.note || entry?.photo ? '📝 Ver anotação' : '📝 Anotar / foto'}</button>
    </div>
  </div>`;
}

function setRow(day, w, ei, si, s) {
  const a = `data-w="${w.id}" data-e="${ei}" data-s="${si}" data-day="${day}"`;
  return `
    <div class="set ${s.done ? 'done' : ''}">
      <span class="set-n">${si + 1}</span>
      <input type="number" inputmode="numeric" min="0" value="${s.reps}" data-action="set-field" data-field="reps" ${a} aria-label="Repetições">
      <span class="muted">×</span>
      <input type="number" inputmode="decimal" min="0" step="0.5" value="${s.weight}" data-action="set-field" data-field="weight" ${a} aria-label="Carga">
      <span class="muted">kg</span>
      <button class="check sm ${s.done ? 'on' : ''}" data-action="set-done" ${a} data-pop="s-${w.id}-${ei}-${si}" aria-label="Série ${si + 1} feita" aria-pressed="${s.done}">✓</button>
    </div>`;
}

function workoutCard(day, w) {
  const log = findLog(day, w.id) || newLog(day, w);
  const total = log.exercises.reduce((t, e) => t + e.sets.length, 0);
  const done = log.exercises.reduce((t, e) => t + e.sets.filter((s) => s.done).length, 0);
  return `
  <div class="card">
    <div class="row">
      <div class="wk-ico" aria-hidden="true">🏋️</div>
      <div class="grow">
        <div class="name">${esc(w.name)}</div>
        <div class="muted">${log.exercises.length} exercícios · ${done}/${total} séries</div>
      </div>
      ${log.finished ? '<span class="chip ok">✓ Concluído</span>' : `<button class="btn-small" data-action="rest-cycle" aria-label="Tempo de descanso entre séries">⏱ ${restDefault()}s</button>`}
    </div>
    <div class="bar" role="img" aria-label="${done} de ${total} séries"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div>
    ${log.exercises.map((e, ei) => {
      const allDone = e.sets.length && e.sets.every((s) => s.done);
      return `
      <div class="ex ${allDone ? 'done' : ''}">
        <div class="row between">
          <div class="ex-name">${allDone ? '✅ ' : ''}${esc(e.name)}</div>
          <div class="row" style="gap:4px">
            <button class="btn-small" data-action="chart" data-name="${esc(e.name)}" aria-label="Evolução de ${esc(e.name)}">📈</button>
            <button class="btn-small" data-action="set-remove" data-w="${w.id}" data-e="${ei}" data-day="${day}" aria-label="Remover série">−</button>
            <button class="btn-small" data-action="set-add" data-w="${w.id}" data-e="${ei}" data-day="${day}" aria-label="Adicionar série">+</button>
          </div>
        </div>
        ${e.sets.map((s, si) => setRow(day, w, ei, si, s)).join('')}
      </div>`;
    }).join('')}
    <button class="btn-block ${log.finished ? '' : 'btn-primary'}" style="margin-top:14px" data-action="finish" data-w="${w.id}" data-day="${day}">
      ${log.finished ? 'Desmarcar treino' : 'Concluir treino 💪'}
    </button>
  </div>`;
}

// Tarefas do dia: desafios ativos, treinos do dia e corrida do dia
function todayTasks(today) {
  const items = [];
  for (const c of S.challenges.filter(isActive)) items.push(dayDone(c, myChecks(c)[today]));
  const scheduled = workoutsForDay(today);
  const extra = S.workouts.filter((w) => !scheduled.includes(w) && findLog(today, w.id));
  for (const w of [...scheduled, ...extra]) items.push(!!findLog(today, w.id)?.finished);
  const run = R?.access?.active && (R.sessions || []).find((s) => s.day === today);
  if (run) items.push(!!run.done);
  return { total: items.length, done: items.filter(Boolean).length };
}

function heroToday(today) {
  const t = todayTasks(today);
  const xp = computeXP();
  const lv = levelFor(xp);
  const streak = Math.max(0, ...S.challenges.filter(isActive).map((c) => challengeStats(c).streak));
  const badges = computeBadges();
  const got = badges.filter((b) => b.ok).length;
  const [q, src] = quoteOfDay(today);
  const sub = !t.total ? 'dia livre' : t.done === t.total ? 'dia completo! 🎉' : 'feitos hoje';
  return `
    <div class="card hero">
      ${ring({ value: t.done, max: t.total || 1, center: t.total ? `${t.done}/${t.total}` : '☀️', sub, label: `${t.done} de ${t.total} tarefas de hoje feitas` })}
      <div class="hero-stats">
        <div class="hero-stat"><span class="ico">🔥</span><div><b>${streak} ${streak === 1 ? 'dia' : 'dias'}</b><small>maior sequência ativa</small></div></div>
        <div class="hero-stat"><span class="ico">${lv.icon}</span><div><b>Nível ${lv.n} · ${lv.name}</b><small>${fmtNum(xp)} de energia</small></div></div>
        <div class="hero-stat"><span class="ico">🏅</span><div><b>${got} de ${badges.length}</b><small>conquistas</small></div></div>
      </div>
      <div class="quote">${esc(q)}<small>${esc(src)}</small></div>
    </div>`;
}

function viewToday() {
  const today = todayStr();
  const active = S.challenges.filter(isActive);
  const scheduled = workoutsForDay(today);
  const extra = S.workouts.filter((w) => !scheduled.includes(w) && findLog(today, w.id));
  const list = [...scheduled, ...extra];
  return `
    ${heroToday(today)}
    <h2>Desafios de hoje</h2>
    ${active.length ? active.map((c) => challengeToday(c, today)).join('') : `<div class="card empty"><div class="big">🎯</div>Nenhum desafio ativo ainda.<br><br><button class="btn-primary" data-action="new-challenge">+ Criar desafio</button> <button data-action="join">Entrar com código</button></div>`}
    ${runTodayCard(today)}
    <h2>Treino de hoje · ${WEEKDAYS[parseDate(today).getDay()]}</h2>
    ${list.length ? list.map((w) => workoutCard(today, w)).join('') : `<div class="card empty"><div class="big">${S.workouts.length ? '😴' : '🏋️'}</div>${S.workouts.length ? 'Dia de descanso. Recuperar também é treino.' : 'Cadastre seus treinos na aba Treinos.'}</div>`}
    ${S.workouts.length ? `<button class="btn-block" data-action="pick-workout" data-day="${today}">+ Fazer outro treino hoje</button>` : ''}
  `;
}

function ranking(c) {
  if (c.members.length < 2) return '';
  const rows = c.members.map((m) => ({ m, s: challengeStats(c, m.id) }))
    .sort((a, b) => b.s.done - a.s.done || b.s.streak - a.s.streak);
  const medal = ['🥇', '🥈', '🥉'];
  return `
    <div class="rank">
      <div class="muted" style="margin-bottom:6px">Ranking</div>
      ${rows.map(({ m, s }, i) => `
        <div class="rank-row ${m.id === myId() ? 'me' : ''}">
          <span class="pos">${medal[i] || i + 1}</span>${avatar(m)}
          <span class="grow">${esc(m.name)}${m.id === c.ownerId ? ' <span class="muted">(criador)</span>' : ''}</span>
          <span><b>${s.done}</b>${s.weekly ? (s.done === 1 ? ' semana' : ' semanas') : (s.done === 1 ? ' dia' : ' dias')}</span>
          <span class="muted">🔥${s.streak}</span>
        </div>`).join('')}
    </div>`;
}

function diary(c) {
  const entries = [];
  for (const m of c.members) {
    for (const [day, e] of Object.entries(myChecks(c, m.id))) if (e.note || e.photo) entries.push({ m, day, e });
  }
  if (!entries.length) return '';
  entries.sort((a, b) => (a.day < b.day ? 1 : -1));
  return `
    <details class="diary">
      <summary>📔 Diário (${entries.length})</summary>
      ${entries.slice(0, 30).map(({ m, day, e }) => `
        <div class="entry">
          <div class="row">${avatar(m, 22)}<b>${esc(m.name)}</b><span class="muted">${fmtDate(day)}${c.kind === 'quantity' ? ` · ${fmtNum(e.value)}${esc(unitLabel(c))}` : ''}</span></div>
          ${e.note ? `<p>${esc(e.note)}</p>` : ''}
          ${e.photo ? `<img class="photo" loading="lazy" src="/api/photos?key=${encodeURIComponent(e.photo)}" alt="Foto de ${esc(m.name)}" data-action="photo">` : ''}
        </div>`).join('')}
    </details>`;
}

function challengeCard(c, today) {
  const s = challengeStats(c);
  const checks = myChecks(c);
  const cells = [];
  for (let i = 0; i < parseDate(c.start).getDay(); i++) cells.push('<span></span>');
  for (let i = 0; i < c.days; i++) {
    const d = addDays(c.start, i);
    const e = checks[d];
    const ok = dayDone(c, e);
    const partial = !ok && e && e.value > 0;
    const miss = !ok && d < today && c.kind !== 'weekly';
    const cls = ok ? 'done' : partial ? 'partial' : miss ? 'miss' : d > today ? 'future' : '';
    const state = ok ? 'feito' : partial ? 'parcial' : miss ? 'faltou' : d > today ? 'ainda não chegou' : 'em aberto';
    cells.push(`<button class="${cls} ${d === today ? 'today' : ''}" data-action="checkin" data-id="${c.id}" data-day="${d}" ${d > today ? 'disabled' : ''} aria-label="Dia ${i + 1}, ${fmtDate(d)}: ${state}">${i + 1}${e?.note || e?.photo ? '<i class="dot"></i>' : ''}</button>`);
  }
  const statusChip = { ativo: '', futuro: '<span class="chip">Começa em breve</span>', 'concluído': '<span class="chip ok">🏆 Concluído</span>', encerrado: '<span class="chip">Encerrado</span>' }[s.status];
  const kindLabel = c.kind === 'quantity' ? `Meta: ${fmtNum(c.target)}${esc(unitLabel(c))}/dia` : c.kind === 'weekly' ? `Meta: ${fmtNum(c.target)}x por semana` : 'Todo dia';
  const unit = s.weekly ? 'semanas' : 'dias';
  return `
  <div class="card">
    <div class="row">
      <div class="emoji">${esc(c.emoji)}</div>
      <div class="grow">
        <div class="name">${esc(c.name)}</div>
        <div class="muted">${fmtDate(c.start)} → ${fmtDate(s.end)} · ${kindLabel}</div>
      </div>
      <button class="btn-small" data-action="edit-challenge" data-id="${c.id}">Editar</button>
    </div>
    ${statusChip ? `<div style="margin-top:8px">${statusChip}</div>` : ''}
    <div class="bar" role="img" aria-label="${s.pct}% concluído"><i style="width:${s.pct}%"></i></div>
    <div class="stats">
      <div><b>${s.done}</b><span>${unit} feitos</span></div>
      <div><b>${s.left}</b><span>faltam</span></div>
      <div><b>🔥${s.streak}</b><span>seguidos</span></div>
      <div><b>${s.missed}</b><span>falhas</span></div>
    </div>
    <div class="cal-head" aria-hidden="true">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal">${cells.join('')}</div>
    <div class="cal-legend"><span><i class="l-done"></i>Feito</span>${c.kind === 'quantity' ? '<span><i class="l-partial"></i>Parcial</span>' : ''}${c.kind !== 'weekly' ? '<span><i class="l-miss"></i>Faltou</span>' : ''}<span><i class="l-today"></i>Hoje</span></div>
    ${ranking(c)}
    ${diary(c)}
    <button class="btn-block" style="margin-top:14px" data-action="invite" data-id="${c.id}">👥 Convidar amigos</button>
  </div>`;
}

function viewChallenges() {
  const today = todayStr();
  const order = { ativo: 0, futuro: 1, 'concluído': 2, encerrado: 3 };
  const sorted = [...S.challenges].sort((a, b) => order[challengeStats(a).status] - order[challengeStats(b).status]);
  const active = S.challenges.filter(isActive).length;
  const won = S.challenges.filter((c) => challengeStats(c).status === 'concluído').length;
  const best = Math.max(0, ...S.challenges.filter((c) => c.kind !== 'weekly').map((c) => challengeStats(c).best));
  const marked = S.challenges.reduce((t, c) => t + Object.values(myChecks(c)).filter((e) => dayDone(c, e)).length, 0);
  const perWeek = weekly(8, (d) => S.challenges.reduce((t, c) => t + (dayDone(c, myChecks(c)[d]) ? 1 : 0), 0));
  return `
    ${S.challenges.length ? `<div class="kpis">
      ${tile('Ativos', active)}
      ${tile('Vencidos', won)}
      ${tile('Melhor sequência', `${best}<small> ${best === 1 ? 'dia' : 'dias'}</small>`)}
      ${tile('Dias marcados', marked, { delta: `${perWeek[perWeek.length - 1].value} nesta semana`, spark: sparkline(perWeek.map((w) => w.value), 'Dias marcados por semana, últimas 8 semanas') })}
    </div>` : ''}
    <div class="row" style="margin-bottom:14px">
      <button class="btn-primary grow" data-action="new-challenge">+ Novo desafio</button>
      <button class="grow" data-action="join">🔑 Entrar com código</button>
    </div>
    ${sorted.length ? sorted.map((c) => challengeCard(c, today)).join('') : '<div class="card empty"><div class="big">🏆</div>Crie um desafio ou entre no de um amigo com o código de convite.</div>'}
  `;
}

function viewWorkouts() {
  const today = todayStr();
  const finished = S.logs.filter((l) => l.finished);
  const perWeek = weekly(8, (d) => finished.filter((l) => l.day === d).length);
  const last30 = finished.filter((l) => diffDays(l.day, today) < 30).length;
  const weekStart = addDays(today, -parseDate(today).getDay());
  const volume = S.logs.filter((l) => l.day >= weekStart).reduce((t, l) => t + l.exercises.reduce((u, e) => u + e.sets.filter((s) => s.done || l.finished).reduce((v, s) => v + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0), 0), 0);
  const lastDone = (w) => finished.filter((l) => l.workoutId === w.id).map((l) => l.day).sort().pop();
  return `
    ${finished.length ? `<div class="kpis">
      ${tile('Nesta semana', perWeek[perWeek.length - 1].value, { delta: 'treinos concluídos', spark: sparkline(perWeek.map((w) => w.value), 'Treinos por semana, últimas 8 semanas') })}
      ${tile('Últimos 30 dias', last30, { delta: 'treinos' })}
      ${tile('Volume na semana', `${fmtNum(Math.round(volume))}<small> kg</small>`, { delta: 'séries × reps × carga' })}
      ${tile('No total', finished.length, { delta: 'treinos concluídos' })}
    </div>` : ''}
    <button class="btn-primary btn-block" data-action="new-workout" style="margin-bottom:14px">+ Novo treino</button>
    ${S.workouts.length ? S.workouts.map((w) => {
      const last = lastDone(w);
      return `
      <div class="card">
        <div class="row">
          <div class="wk-ico" aria-hidden="true">🏋️</div>
          <div class="grow"><div class="name">${esc(w.name)}</div><div class="muted">${last ? `Último: ${fmtDate(last, { weekday: 'short', day: '2-digit', month: 'short' })}` : 'Ainda não feito'}</div></div>
          <button class="btn-small" data-action="edit-workout" data-id="${w.id}">Editar</button>
        </div>
        <div class="chips" style="margin:12px 0 6px">
          ${WEEKDAYS.map((d, i) => `<span class="chip ${w.weekdays.includes(i) ? 'on' : ''}">${d}</span>`).join('')}
        </div>
        ${w.exercises.map((e) => {
          const h = exerciseHistory(e.name);
          const lastP = h[h.length - 1];
          return `<div class="ex-line">
            <span class="grow">${esc(e.name)} <span class="muted">· ${e.sets}x${e.reps} · ${fmtNum(lastP ? lastP.max : e.weight)} kg</span></span>
            ${h.length >= 2 ? `<span class="ex-spark">${sparkline(h.slice(-8).map((p) => p.max), `Carga de ${e.name} nas últimas vezes`, { fromZero: false })}</span>` : ''}
            <button class="btn-small" data-action="chart" data-name="${esc(e.name)}" aria-label="Evolução de ${esc(e.name)}">📈</button>
          </div>`;
        }).join('') || '<div class="muted">Sem exercícios</div>'}
        <button class="btn-block" style="margin-top:12px" data-action="start-workout" data-id="${w.id}">▶️ Fazer hoje</button>
      </div>`;
    }).join('') : '<div class="card empty"><div class="big">🏋️</div>Cadastre seus treinos (A, B, C…) e os dias da semana de cada um.</div>'}
  `;
}

function viewProfile() {
  const me = S.me;
  const today = todayStr();
  const xp = computeXP();
  const lv = levelFor(xp);
  const finished = S.logs.filter((l) => l.finished);
  const badges = computeBadges();
  const acts = activityByDay();
  const theme = store.get('theme', 'auto');
  const restSec = restDefault();
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${me.reminderHour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
  const logs = S.logs.filter((l) => l.finished || l.exercises.some((e) => e.sets.some((s) => s.done)));

  // Números dos últimos 30 dias e tendência semanal
  const in30 = (d) => d <= today && diffDays(d, today) < 30;
  const activeDays30 = [...acts.keys()].filter(in30).length;
  const runs = (R?.sessions || []).filter((s) => s.done);
  const km = (s) => Number(s.actualKm || s.distanceKm) || 0;
  const km30 = runs.filter((s) => in30(s.day)).reduce((t, s) => t + km(s), 0);
  const wActs = weekly(8, (d) => acts.get(d) || 0);
  const wWork = weekly(8, (d) => finished.filter((l) => l.day === d).length);
  const wKm = weekly(8, (d) => runs.filter((s) => s.day === d).reduce((t, s) => t + km(s), 0));
  const bestStreak = Math.max(0, ...S.challenges.filter((c) => c.kind !== 'weekly').map((c) => challengeStats(c).best));
  const heatWeeks = weekly(16, (d) => acts.get(d) || 0);

  let pushBlock;
  if (isIOS && !standalone) {
    pushBlock = `<div class="muted">No iPhone, os lembretes só funcionam com o app na tela inicial: toque em <b>Compartilhar</b> <span aria-hidden="true">⬆️</span> → <b>Adicionar à Tela de Início</b> e abra o app por lá.</div>`;
  } else if (!pushOk) {
    pushBlock = '<div class="muted">Este navegador não aceita notificações.</div>';
  } else {
    pushBlock = `
      <label class="field">Horário do lembrete
        <select data-action="reminder-hour"><option value="">Desligado</option>${hours}</select>
      </label>
      <div class="row">
        <button class="grow ${perm === 'granted' ? '' : 'btn-blue'}" data-action="enable-push">${perm === 'granted' ? '🔔 Notificações ativas' : '🔔 Ativar notificações'}</button>
        ${perm === 'granted' ? '<button data-action="test-push">Testar</button>' : ''}
      </div>
      <div class="muted" style="margin-top:6px">Você só recebe o aviso se tiver desafio ou corrida sem marcar no dia.</div>`;
  }

  return `
    <div class="card row">
      ${avatar(me, 52)}
      <div class="grow"><div class="name">${esc(me.name)}</div><div class="muted">${esc(me.email)}</div></div>
      <button class="btn-small" data-action="logout">Sair</button>
    </div>

    <div class="card level">
      <div class="level-badge" aria-hidden="true">${lv.icon}</div>
      <div>
        <div class="lv">Nível ${lv.n}</div>
        <div class="ln">${lv.name}</div>
        <div class="xp-bar" role="img" aria-label="${Math.round(lv.pct * 100)}% até o próximo nível"><i style="width:${Math.round(lv.pct * 100)}%"></i></div>
        <div class="xp-txt">${fmtNum(xp)} de energia${lv.next ? ` · faltam ${fmtNum(lv.toNext)} para ${lv.next.icon} ${lv.next.name}` : ' · nível máximo!'}</div>
      </div>
    </div>

    <h2>Últimos 30 dias</h2>
    <div class="kpis">
      ${tile('Dias ativos', `${activeDays30}<small> de 30</small>`, { spark: sparkline(wActs.map((w) => w.value), 'Atividades por semana, últimas 8 semanas') })}
      ${tile('Treinos', finished.filter((l) => in30(l.day)).length, { spark: sparkline(wWork.map((w) => w.value), 'Treinos por semana, últimas 8 semanas') })}
      ${R?.access?.active && runs.length ? tile('Km corridos', `${fmtNum(km30)}<small> km</small>`, { spark: sparkline(wKm.map((w) => w.value), 'Km por semana, últimas 8 semanas') }) : tile('Desafios vencidos', S.challenges.filter((c) => challengeStats(c).status === 'concluído').length)}
      ${tile('Melhor sequência', `${bestStreak}<small> ${bestStreak === 1 ? 'dia' : 'dias'}</small>`)}
    </div>

    <h2>Constelação de atividades</h2>
    <div class="card">
      <div class="viz-head"><div class="name">Seus dias ativos</div><span class="muted">últimas 16 semanas</span></div>
      ${heatmap(acts, today, { weeks: 16, addDays, label: `Mapa de calor: ${[...acts.keys()].length} dias com atividade` })}
      ${vizTable(['Semana de', 'Atividades'], heatWeeks.slice().reverse().map((w) => [w.label, String(w.value)]))}
    </div>

    <h2>Atividades por semana</h2>
    <div class="card">
      ${columns(wActs.map((w) => ({ label: w.label, value: w.value, tip: `${w.value} ${w.value === 1 ? 'atividade' : 'atividades'}|Semana de ${w.label}` })), { title: 'Atividades por semana nas últimas 8 semanas' })}
      ${vizTable(['Semana de', 'Atividades', 'Treinos'], wActs.map((w, i) => [w.label, String(w.value), String(wWork[i].value)]))}
    </div>

    <h2>Conquistas · ${badges.filter((b) => b.ok).length}/${badges.length}</h2>
    <div class="badges">
      ${badges.map((b) => `<div class="badge ${b.ok ? 'ok' : ''}" title="${esc(b.desc)}"><span>${b.ok ? b.icon : '🔒'}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}
    </div>

    <h2>Lembrete diário</h2>
    <div class="card">${pushBlock}</div>

    <h2>Aparência</h2>
    <div class="card seg">
      ${[['auto', '🌗 Automático'], ['light', '☀️ Claro'], ['dark', '🌙 Escuro']].map(([v, l]) => `<button class="${theme === v ? 'on' : ''}" data-action="theme" data-v="${v}">${l}</button>`).join('')}
    </div>

    <h2>Descanso entre séries</h2>
    <div class="card seg" style="grid-template-columns:repeat(4,1fr)">
      ${[60, 90, 120, 180].map((v) => `<button class="${restSec === v ? 'on' : ''}" data-action="rest-set" data-v="${v}">${v}s</button>`).join('')}
    </div>

    <h2>Histórico de treinos</h2>
    ${logs.length ? logs.slice(0, 60).map((l) => `
      <div class="card">
        <div class="row between">
          <div class="name">${esc(l.workoutName)}</div>
          <span class="chip ${l.finished ? 'ok' : ''}">${l.finished ? '✓ Concluído' : 'parcial'}</span>
        </div>
        <div class="muted" style="margin-bottom:6px">${fmtDate(l.day, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
        ${l.exercises.map((e) => `<div class="muted">${e.sets.every((s) => s.done) ? '✅' : '⬜'} ${esc(e.name)} — ${e.sets.map((s) => `${s.reps}×${fmtNum(s.weight)}`).join(' · ')} kg</div>`).join('')}
      </div>`).join('') : '<div class="card empty">Nenhum treino registrado ainda.</div>'}
  `;
}

/* ================= Gráfico de evolução ================= */


function openChart(name) {
  const h = exerciseHistory(name);
  const first = h[0], last = h[h.length - 1], best = h.reduce((a, p) => (p.max > (a?.max ?? -1) ? p : a), null);
  const long = { day: '2-digit', month: 'short', year: '2-digit' };
  openModal(`
    <h3>📈 ${esc(name)}</h3>
    ${h.length ? `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      ${tile('Primeira', `${fmtNum(first.max)}<small> kg</small>`)}
      ${tile('Última', `${fmtNum(last.max)}<small> kg</small>`, last.max > first.max ? { delta: `+${fmtNum(last.max - first.max)} kg`, up: true } : {})}
      ${tile('Recorde', `${fmtNum(best.max)}<small> kg</small>`)}
    </div>` : ''}
    ${h.length >= 2
      ? `<div class="viz-head"><div class="name">Carga máxima por treino</div><span class="muted">kg</span></div>
         ${lineChart(h.map((p) => ({ x: fmtDate(p.day), value: p.max, tip: `${fmtNum(p.max)} kg|${fmtDate(p.day, long)} · volume ${fmtNum(p.vol)}` })), { unit: ' kg', title: `Carga máxima em ${name} ao longo do tempo` })}
         ${vizTable(['Data', 'Carga máx. (kg)', 'Volume'], h.slice().reverse().map((p) => [fmtDate(p.day, long), fmtNum(p.max), fmtNum(p.vol)]))}`
      : '<div class="empty">Faça este exercício pelo menos 2 vezes para ver a evolução.</div>'}
    <div class="actions"><button value="cancel">Fechar</button></div>`);
}

/* ================= Modais ================= */

const $modal = $('#modal');
const $form = $('#modal-form');

function openModal(html, { onSubmit, onClick } = {}) {
  $form.innerHTML = html;
  $form.onsubmit = (ev) => {
    if (!ev.submitter || ev.submitter.value !== 'ok') return;
    if (onSubmit && onSubmit(new FormData($form)) === false) ev.preventDefault();
  };
  $form.onclick = onClick || null;
  $modal.showModal();
}

function openChallengeForm(c) {
  const isNew = !c;
  const owner = isNew || c.ownerId === myId();
  c = c || { name: '', emoji: '🎯', kind: 'daily', target: 2, unit: 'L', days: 21, start: todayStr(), linkWorkout: false };
  const dis = owner ? '' : 'disabled';
  openModal(`
    <h3>${isNew ? 'Novo desafio' : 'Editar desafio'}</h3>
    ${owner ? '' : '<div class="muted" style="margin-bottom:10px">Só quem criou pode mudar as regras do desafio.</div>'}
    <label class="field">Nome<input name="name" required value="${esc(c.name)}" placeholder="Ex: 20 dias sem açúcar" ${dis}></label>
    <div class="row">
      <label class="field" style="width:76px">Emoji<input name="emoji" value="${esc(c.emoji)}" maxlength="4" ${dis}></label>
      <label class="field grow">Duração (dias)<input name="days" type="number" min="1" max="1000" required value="${c.days}" ${dis}></label>
    </div>
    <label class="field">Começa em<input name="start" type="date" required value="${c.start}" ${dis}></label>
    <label class="field">Tipo
      <select name="kind" ${dis}>
        <option value="daily" ${c.kind === 'daily' ? 'selected' : ''}>Todo dia (fiz / não fiz)</option>
        <option value="quantity" ${c.kind === 'quantity' ? 'selected' : ''}>Meta com quantidade por dia</option>
        <option value="weekly" ${c.kind === 'weekly' ? 'selected' : ''}>Vezes por semana</option>
      </select>
    </label>
    <div class="row kind-extra" data-kind="quantity">
      <label class="field grow">Meta por dia<input name="target" type="number" step="any" min="0.1" value="${c.kind === 'quantity' ? c.target : 2}" ${dis}></label>
      <label class="field grow">Unidade<input name="unit" value="${esc(c.unit || '')}" placeholder="L, páginas, passos" ${dis}></label>
    </div>
    <div class="kind-extra" data-kind="weekly">
      <label class="field">Vezes por semana<input name="weekTarget" type="number" min="1" max="7" value="${c.kind === 'weekly' ? c.target : 4}" ${dis}></label>
    </div>
    <label class="row" style="font-size:14px;margin-bottom:6px">
      <input type="checkbox" name="linkWorkout" ${c.linkWorkout ? 'checked' : ''}>
      Marcar o dia sozinho quando eu concluir um treino
    </label>
    <div class="actions">
      ${isNew ? '' : `<button type="button" class="btn-danger" data-m="delete">${owner ? 'Excluir' : 'Sair do desafio'}</button>`}
      <button value="cancel" formnovalidate>Cancelar</button>
      <button class="btn-primary" value="ok">Salvar</button>
    </div>`, {
    onSubmit(f) {
      const kind = owner ? f.get('kind') : c.kind;
      const data = owner ? {
        name: f.get('name').trim(), emoji: f.get('emoji').trim() || '🎯', kind,
        days: Math.max(1, parseInt(f.get('days'), 10) || 1), start: f.get('start'),
        target: kind === 'quantity' ? Number(f.get('target')) || 1 : kind === 'weekly' ? Number(f.get('weekTarget')) || 1 : null,
        unit: kind === 'quantity' ? f.get('unit').trim() : null,
      } : { name: c.name, emoji: c.emoji, kind: c.kind, days: c.days, start: c.start, target: c.target, unit: c.unit };
      data.linkWorkout = f.get('linkWorkout') === 'on';
      if (isNew) {
        api('challenges', { method: 'POST', body: data }).then(reload).catch((e) => toast(`⚠️ ${e.message}`));
      } else {
        Object.assign(c, data);
        save(api(`challenges/${c.id}`, { method: 'PUT', body: data }));
      }
    },
    onClick(ev) {
      if (ev.target.closest('[data-m=delete]')) {
        const msg = owner ? `Excluir "${c.name}" para todos os participantes?` : `Sair de "${c.name}"?`;
        if (!confirm(msg)) return;
        S.challenges = S.challenges.filter((x) => x.id !== c.id);
        $modal.close();
        save(api(`challenges/${c.id}`, { method: 'DELETE' }));
      }
    },
  });
  const sel = $form.querySelector('[name=kind]');
  const sync = () => $form.querySelectorAll('.kind-extra').forEach((el) => { el.hidden = el.dataset.kind !== sel.value; });
  sel.onchange = sync; sync();
}

async function resizeImage(file, maxSize = 1280) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob((b) => r(b || file), 'image/jpeg', 0.82));
}

function openCheckin(c, day) {
  const e = myChecks(c)[day] || { value: 0, note: '', photo: null };
  let photo = e.photo;
  const isQty = c.kind === 'quantity';
  const quick = isQty ? [0.25, 0.5, 1].map((f) => +(c.target * f).toFixed(2)) : [];
  openModal(`
    <h3>${esc(c.emoji)} ${esc(c.name)}</h3>
    <div class="muted" style="margin:-8px 0 12px">${fmtDate(day, { weekday: 'long', day: '2-digit', month: 'long' })}</div>
    ${isQty ? `
      <label class="field">Quanto você fez (${fmtNum(c.target)}${esc(unitLabel(c))} é a meta)
        <input name="value" type="number" step="any" min="0" inputmode="decimal" value="${e.value || ''}" placeholder="0">
      </label>
      <div class="chips" style="margin:-4px 0 12px">${quick.map((q) => `<button type="button" class="chip" data-m="add" data-v="${q}">+${fmtNum(q)}</button>`).join('')}</div>`
    : `<label class="row" style="margin-bottom:12px;font-size:15px"><input type="checkbox" name="done" ${e.value > 0 || !myChecks(c)[day] ? 'checked' : ''}> Cumpri neste dia</label>`}
    <label class="field">Anotação<textarea name="note" rows="3" placeholder="Como foi o dia?">${esc(e.note)}</textarea></label>
    <div class="field">Foto
      <div id="photo-box">${photo ? `<img class="photo" src="/api/photos?key=${encodeURIComponent(photo)}" alt="">` : ''}</div>
      <div class="row">
        <label class="btn grow" style="text-align:center">📷 ${photo ? 'Trocar foto' : 'Adicionar foto'}<input type="file" accept="image/*" hidden data-m="file"></label>
        ${photo ? '<button type="button" data-m="rm-photo">Remover</button>' : ''}
      </div>
    </div>
    <div class="actions">
      ${myChecks(c)[day] ? '<button type="button" class="btn-danger" data-m="clear">Limpar dia</button>' : ''}
      <button value="cancel" formnovalidate>Cancelar</button>
      <button class="btn-primary" value="ok">Salvar</button>
    </div>`, {
    onSubmit(f) {
      const value = isQty ? Number(f.get('value')) || 0 : f.get('done') === 'on' ? 1 : 0;
      const note = f.get('note').trim();
      if (!value && !note && !photo) { removeCheck(c, day); return; }
      if (!dayDone(c, myChecks(c)[day]) && dayDone(c, { value })) { haptic(15); celebrate('small'); }
      setCheck(c, day, { value, note, photo });
    },
    onClick(ev) {
      const t = ev.target.closest('[data-m]');
      if (!t) return;
      if (t.dataset.m === 'add') {
        const inp = $form.querySelector('[name=value]');
        inp.value = +((Number(inp.value) || 0) + Number(t.dataset.v)).toFixed(2);
      }
      if (t.dataset.m === 'clear') { removeCheck(c, day); $modal.close(); }
      if (t.dataset.m === 'rm-photo') { photo = null; $('#photo-box').innerHTML = ''; t.remove(); }
    },
  });
  $form.querySelector('[data-m=file]').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const box = $('#photo-box');
    box.innerHTML = '<div class="muted">Enviando foto…</div>';
    try {
      const blob = await resizeImage(file);
      const { key } = await api(`photos?challengeId=${encodeURIComponent(c.id)}&day=${day}`, { method: 'POST', raw: blob });
      photo = key;
      box.innerHTML = `<img class="photo" src="${URL.createObjectURL(blob)}" alt="">`;
    } catch (e) { box.innerHTML = `<div class="muted">⚠️ ${esc(e.message)}</div>`; }
  };
}

function setCheck(c, day, entry) {
  (c.checkins[myId()] ||= {})[day] = entry;
  save(api('checkins', { method: 'PUT', body: { challengeId: c.id, day, ...entry } }));
}
function removeCheck(c, day) {
  delete (c.checkins[myId()] || {})[day];
  save(api(`checkins?challengeId=${encodeURIComponent(c.id)}&day=${day}`, { method: 'DELETE' }));
}

function openWorkoutForm(w) {
  const isNew = !w;
  w = w || { id: uid(), name: '', weekdays: [], exercises: [] };
  const exRow = (e = {}) => `
    <div class="ex-edit" data-exid="${e.id || ''}">
      <input name="ex-name" placeholder="Exercício" value="${esc(e.name || '')}">
      <input name="ex-sets" type="number" inputmode="numeric" min="1" value="${e.sets ?? 3}" aria-label="Séries">
      <input name="ex-reps" type="number" inputmode="numeric" min="0" value="${e.reps ?? 12}" aria-label="Repetições">
      <input name="ex-weight" type="number" inputmode="decimal" min="0" step="0.5" value="${e.weight ?? 0}" aria-label="Carga">
      <button type="button" data-m="rm-ex" aria-label="Remover">✕</button>
    </div>`;
  openModal(`
    <h3>${isNew ? 'Novo treino' : 'Editar treino'}</h3>
    <label class="field">Nome<input name="name" required value="${esc(w.name)}" placeholder="Ex: Treino A – Peito"></label>
    <div class="field">Dias da semana
      <div class="chips">${WEEKDAYS.map((d, i) => `<label class="chip ${w.weekdays.includes(i) ? 'on' : ''}"><input type="checkbox" name="wd" value="${i}" ${w.weekdays.includes(i) ? 'checked' : ''} hidden>${d}</label>`).join('')}</div>
    </div>
    <div class="field">Exercícios
      <div class="ex-edit ex-head"><span>Nome</span><span>Séries</span><span>Reps</span><span>Kg</span><span></span></div>
      <div id="ex-list">${w.exercises.map(exRow).join('')}${isNew ? exRow() : ''}</div>
      <button type="button" data-m="add-ex">+ Exercício</button>
    </div>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn-danger" data-m="delete">Excluir</button>'}
      <button value="cancel" formnovalidate>Cancelar</button>
      <button class="btn-primary" value="ok">Salvar</button>
    </div>`, {
    onSubmit(f) {
      const exercises = [...$('#ex-list').children].map((row) => ({
        id: row.dataset.exid || uid(),
        name: row.querySelector('[name=ex-name]').value.trim(),
        sets: Number(row.querySelector('[name=ex-sets]').value) || 1,
        reps: Number(row.querySelector('[name=ex-reps]').value) || 0,
        weight: Number(row.querySelector('[name=ex-weight]').value) || 0,
      })).filter((e) => e.name);
      Object.assign(w, { name: f.get('name').trim(), weekdays: f.getAll('wd').map(Number), exercises });
      if (isNew) S.workouts.push(w);
      save(api(`workouts/${w.id}`, { method: 'PUT', body: { ...w, position: S.workouts.indexOf(w) } }));
    },
    onClick(ev) {
      if (ev.target.name === 'wd') ev.target.parentElement.classList.toggle('on', ev.target.checked);
      const t = ev.target.closest('[data-m]');
      if (!t) return;
      const list = $('#ex-list');
      if (t.dataset.m === 'add-ex') { list.insertAdjacentHTML('beforeend', exRow()); list.lastElementChild.querySelector('input').focus(); }
      if (t.dataset.m === 'rm-ex') t.parentElement.remove();
      if (t.dataset.m === 'delete' && confirm(`Excluir "${w.name}"? O histórico será mantido.`)) {
        S.workouts = S.workouts.filter((x) => x.id !== w.id);
        $modal.close();
        save(api(`workouts/${w.id}`, { method: 'DELETE' }));
      }
    },
  });
}

function openPickWorkout(day) {
  openModal(`
    <h3>Qual treino você vai fazer?</h3>
    ${S.workouts.map((w) => `<button type="button" class="btn-block" style="margin-bottom:8px;text-align:left" data-m="pick" data-id="${w.id}">${esc(w.name)}</button>`).join('')}
    <div class="actions"><button value="cancel">Cancelar</button></div>`, {
    onClick(ev) {
      const t = ev.target.closest('[data-m=pick]');
      if (!t) return;
      startWorkout(day, byId(S.workouts, t.dataset.id));
      $modal.close();
    },
  });
}

function startWorkout(day, w) {
  const log = getOrCreateLog(day, w);
  tab = 'hoje';
  save(saveLog(log));
}

function inviteLink(c) { return `${location.origin}/?convite=${c.inviteCode}`; }

function openInvite(c) {
  const link = inviteLink(c);
  openModal(`
    <h3>👥 Convidar para "${esc(c.name)}"</h3>
    <div class="muted">Mande o link ou o código. Seus amigos entram com a conta Google e já aparecem no ranking.</div>
    <div class="code">${esc(c.inviteCode)}</div>
    <input readonly value="${esc(link)}" onclick="this.select()">
    <div class="actions">
      <button type="button" data-m="copy">Copiar link</button>
      ${navigator.share ? '<button type="button" class="btn-primary" data-m="share">Compartilhar</button>' : ''}
      <button value="cancel">Fechar</button>
    </div>
    <div class="muted" style="margin-top:12px">Participantes: ${c.members.map((m) => esc(m.name)).join(', ')}</div>`, {
    onClick(ev) {
      const t = ev.target.closest('[data-m]');
      if (!t) return;
      const text = `Bora fazer o desafio "${c.name}" comigo? ${c.emoji}`;
      if (t.dataset.m === 'share') navigator.share({ title: c.name, text, url: link }).catch(() => {});
      if (t.dataset.m === 'copy') navigator.clipboard?.writeText(link).then(() => toast('Link copiado!'));
    },
  });
}

async function openJoin(code = '') {
  openModal(`
    <h3>🔑 Entrar em um desafio</h3>
    <label class="field">Código de convite<input name="code" value="${esc(code)}" placeholder="Ex: K7P2QX" autocapitalize="characters" required></label>
    <div id="invite-preview"></div>
    <div class="actions"><button value="cancel" formnovalidate>Cancelar</button><button class="btn-primary" value="ok">Entrar</button></div>`, {
    onSubmit(f) {
      api('join', { method: 'POST', body: { code: f.get('code') } })
        .then(async () => { await reload(); tab = 'desafios'; render(); toast('Você entrou no desafio! 🎉'); })
        .catch((e) => toast(`⚠️ ${e.message}`));
    },
  });
  if (code) {
    try {
      const p = await api(`invite/${encodeURIComponent(code)}`);
      $('#invite-preview').innerHTML = `<div class="card" style="background:var(--card2)"><div class="name">${esc(p.emoji)} ${esc(p.name)}</div>
        <div class="muted">Criado por ${esc(p.owner)} · ${p.days} dias a partir de ${fmtDate(p.start)} · ${p.members} participante(s)</div>
        ${p.joined ? '<div class="chip ok" style="margin-top:6px;display:inline-block">Você já participa</div>' : ''}</div>`;
    } catch (e) { $('#invite-preview').innerHTML = `<div class="muted">⚠️ ${esc(e.message)}</div>`; }
  }
}

/* ================= Notificações ================= */

function b64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permissão negada. Libere nas configurações do celular.'); return render(); }
    const { key } = await api('push/key');
    if (!key) { toast('⚠️ Notificações ainda não configuradas no servidor'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) });
    await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    if (S.me.reminderHour === null) await setReminder(20);
    toast('🔔 Lembretes ativados!');
    render();
  } catch (e) { toast(`⚠️ ${e.message}`); }
}

function setReminder(hour) {
  S.me.reminderHour = hour;
  return api('me', { method: 'PUT', body: { reminderHour: hour, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
}

/* ================= Corrida (planilha por assinatura) ================= */

let R = null;                         // estado da corrida
let runMode = store.get('run-mode', 'me'); // me | alunos (treinador)
let coachList = null, coachAthlete = null;

const GOALS = { '5k': '5 km', '10k': '10 km', '21k': 'Meia maratona (21 km)', '42k': 'Maratona (42 km)' };
const LEVELS = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };
const TYPES = { leve: 'Leve', longo: 'Longão', intervalado: 'Intervalado', ritmo: 'Ritmo', regenerativo: 'Regenerativo', prova: 'Prova' };
const money = (n) => `R$ ${n}`;

let runError = null;
async function loadRun() {
  try { R = await api(`run/state?today=${todayStr()}`); runError = null; } catch (e) { R = null; runError = e.message; }
}
const runApi = (path, opts = {}) => api(`run/${path}`, { ...opts, body: opts.method && opts.method !== 'GET' && opts.method !== 'DELETE' ? { ...(opts.body || {}), today: todayStr() } : opts.body });

const typeChip = (t) => `<span class="type type-${t}">${TYPES[t] || esc(t)}</span>`;
const fmtSec = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const parseMMSS = (v) => { const m = String(v || '').trim().match(/^(\d{1,3}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function runRow(s, today, action = 'run-open') {
  const d = parseDate(s.day);
  return `
    <div class="run ${s.done ? 'done' : ''} ${s.day === today ? 'today' : ''}" data-action="${action}" data-id="${s.id}">
      <div class="day">${WEEKDAYS[d.getDay()]}<b>${d.getDate()}</b></div>
      <div class="grow">
        <div class="t">${esc(s.title)}</div>
        <div class="muted">${typeChip(s.type)} ${s.distanceKm ? `${fmtNum(s.distanceKm)} km` : ''} ${s.pace ? `· ${esc(s.pace)}` : ''}${s.coachNote ? ' · 💬' : ''}</div>
      </div>
      <span class="chk">${s.done ? '✅' : s.day < today ? '⚪' : ''}</span>
    </div>`;
}

function weeksOf(sessions) {
  const map = new Map();
  for (const s of sessions) { if (!map.has(s.week)) map.set(s.week, []); map.get(s.week).push(s); }
  return [...map.entries()];
}

function planView(profile, sessions, today, { action = 'run-open', who = 'me' } = {}) {
  if (profile.status === 'generating' || profile.status === 'stale') return generatingView(profile, who === 'coach' ? coachAthlete.user.id : '');
  const cur = sessions.find((s) => s.day >= today) || sessions[sessions.length - 1];
  const curWeek = cur?.week || 1;
  const past = sessions.filter((s) => s.day < today);
  const done = sessions.filter((s) => s.done).length;
  const onTime = past.length ? Math.round((past.filter((s) => s.done).length / past.length) * 100) : 100;
  const z = profile.paces;
  const meta = profile.meta;
  const daysToRace = profile.raceDate ? diffDays(today, profile.raceDate) : null;
  const next = sessions.find((s) => s.day >= today && !s.done);
  const zones = meta?.zonas?.length
    ? meta.zonas.map((x) => `<span>${esc(x.nome)}</span><span>${esc(x.ritmo)}<br><small class="muted">${esc(x.descricao)}</small></span>`).join('')
    : `<span>Regenerativo</span><span>${esc(z.regenerativo)}</span><span>Leve</span><span>${esc(z.leve)}</span><span>Longão</span><span>${esc(z.longo)}</span>
       <span>Tempo (limiar)</span><span>${esc(z.ritmo)}</span><span>Intervalado</span><span>${esc(z.intervalado)}</span>`;
  // Volume por semana: planejado × feito
  const vol = weeksOf(sessions).map(([w, list]) => {
    const plan = Math.round(list.reduce((t, s) => t + (s.distanceKm || 0), 0) * 10) / 10;
    const doneKm = Math.round(list.filter((s) => s.done).reduce((t, s) => t + (Number(s.actualKm) || s.distanceKm || 0), 0) * 10) / 10;
    return { label: `S${w}`, plan, value: doneKm, tip: `${fmtNum(doneKm)} de ${fmtNum(plan)} km|Semana ${w}${list[0].phase ? ` · ${list[0].phase}` : ''}` };
  });
  const pct = Math.round((done / Math.max(1, sessions.length)) * 100);
  return `
    ${profile.error ? `<div class="note">⚠️ ${esc(profile.error)}</div>` : ''}
    <div class="card countdown">
      ${ring({ value: done, max: sessions.length || 1, center: `${pct}%`, sub: 'da planilha', label: `${done} de ${sessions.length} treinos feitos` })}
      <div style="min-width:0">
        <div class="name">${esc(meta?.titulo || GOALS[profile.goal])}</div>
        <div class="muted">${LEVELS[profile.level]} · ${profile.weeks} semanas · ${profile.daysPerWeek} treinos/sem</div>
        <div class="chips" style="margin-top:8px">
          <span class="chip">Semana ${curWeek}/${profile.weeks}${cur?.phase ? ` · ${esc(cur.phase)}` : ''}</span>
          <span class="chip ${onTime >= 80 ? 'ok' : ''}">${onTime}% em dia</span>
          ${daysToRace !== null && daysToRace >= 0 ? `<span class="chip on">🏁 ${daysToRace === 0 ? 'Prova hoje!' : `${daysToRace} ${daysToRace === 1 ? 'dia' : 'dias'} p/ prova`}</span>` : ''}
        </div>
      </div>
      ${meta?.resumo ? `<p class="muted" style="grid-column:1/-1">${esc(meta.resumo)}</p>` : ''}
      ${profile.time5k && !meta?.resumo?.includes('Previsão') ? `<p class="muted" style="grid-column:1/-1">Previsão para a prova: <b>${esc(profile.prediction.time)}</b> (${esc(profile.prediction.pace)})${profile.target ? ` · meta: ${esc(profile.target)}` : ''}</p>` : ''}
    </div>
    ${next ? nextRunCard(next, today, action) : ''}
    <div class="card">
      <div class="viz-head"><div class="name">Volume por semana</div><span class="muted">km</span></div>
      <div class="viz-legend"><span><i style="background:var(--ghost)"></i>Planejado</span><span><i style="background:var(--accent)"></i>Feito</span></div>
      ${columns(vol, { planned: true, unit: ' km', title: 'Quilômetros planejados e feitos por semana' })}
      ${vizTable(['Semana', 'Planejado (km)', 'Feito (km)'], vol.map((w) => [w.label, fmtNum(w.plan), fmtNum(w.value)]))}
    </div>
    <div class="card">
      <div class="name" style="margin-bottom:10px">Zonas de ritmo</div>
      <div class="zones">${zones}</div>
    </div>
    <div class="row between" style="margin:24px 0 10px">
      <h2 style="margin:0">Planilha</h2>
      <div class="seg mini">${[['lista', 'Lista'], ['grade', 'Grade']].map(([v, l]) => `<button class="${runLayout === v ? 'on' : ''}" data-action="run-layout" data-v="${v}">${l}</button>`).join('')}</div>
    </div>
    ${runLayout === 'grade' ? gridView(profile, sessions, today, action) : `<div class="card">
      ${weeksOf(sessions).map(([w, list]) => `
        <details class="week" ${w === curWeek ? 'open' : ''}>
          <summary>Semana ${w} <span class="muted">· ${esc(list[0].phase || '')} · ${fmtNum(list.reduce((t, s) => t + (s.distanceKm || 0), 0))} km</span></summary>
          ${list.map((s) => runRow(s, today, action)).join('')}
        </details>`).join('') || '<div class="empty">Nenhum treino na planilha.</div>'}
    </div>`}
    <div class="row" style="margin-top:10px">
      ${['pdf', 'xlsx', 'csv'].map((k) => `<button class="grow btn-small" data-action="run-export" data-kind="${k}" data-who="${who}">⬇️ ${k === 'xlsx' ? 'Excel' : k.toUpperCase()}</button>`).join('')}
    </div>
    ${meta?.dicas?.length ? `<h2>Dicas</h2><div class="card"><ul class="tips">${meta.dicas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}`;
}

function nextRunCard(s, today, action) {
  const when = s.day === today ? 'Hoje' : s.day === addDays(today, 1) ? 'Amanhã' : fmtDate(s.day, { weekday: 'long', day: '2-digit', month: 'short' });
  return `
    <div class="card next-run" data-action="${action}" data-id="${s.id}" role="button" tabindex="0" style="cursor:pointer">
      <div class="kicker">Próximo treino · ${when}</div>
      <div class="title">${esc(s.title)}</div>
      <div class="facts">${typeChip(s.type)}${s.distanceKm ? `<span><b>${fmtNum(s.distanceKm)}</b> km</span>` : ''}${s.pace ? `<span>⏱ <b>${esc(s.pace)}</b></span>` : ''}</div>
      ${s.description ? `<p class="muted" style="margin-top:8px">${esc(s.description)}</p>` : ''}
      ${s.coachNote ? `<div class="note">💬 ${esc(s.coachNote)}</div>` : ''}
    </div>`;
}

function chatView(messages, sendAction, placeholder) {
  return `
    <div class="chat" id="chat">
      ${messages.length ? messages.map((m) => `<div class="msg ${m.authorId === myId() ? 'mine' : ''}">${esc(m.body)}<small>${esc(m.author)} · ${new Date(m.at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') : '<div class="muted">Nenhuma mensagem ainda.</div>'}
    </div>
    <div class="row"><input id="chat-input" placeholder="${esc(placeholder)}" maxlength="2000"><button class="btn-blue" data-action="${sendAction}">Enviar</button></div>`;
}

function plansView() {
  const a = R.access;
  const trial = !a.trialUsed;
  const card = (id, featured, items) => `
    <div class="card plan ${featured ? 'featured' : ''}">
      <div class="row between"><div class="name">${R.plans[id].name}</div>${featured ? '<span class="chip on">Mais completo</span>' : ''}</div>
      <div class="price">${money(R.plans[id].price)}<small>/mês</small></div>
      <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
      ${trial
        ? `<button class="btn-block ${featured ? 'btn-blue' : 'btn-primary'}" data-action="run-trial" data-plan="${id}">Testar ${R.trialDays} dias grátis</button>`
        : `<button class="btn-block ${featured ? 'btn-blue' : 'btn-primary'}" data-action="run-subscribe" data-plan="${id}">Assinar ${R.plans[id].name}</button>`}
    </div>`;
  return `
    <div class="hero"><div class="big">🏃</div>
      <div class="name" style="font-size:20px">Planilha de corrida personalizada</div>
      <div class="muted">Do 5 km à maratona, com ritmos calculados para você.</div></div>
    ${a.status === 'pending' ? `<div class="card banner">⏳ Estamos aguardando a confirmação do pagamento.<br><button class="btn-small" style="margin-top:8px" data-action="run-refresh">Já paguei, atualizar</button></div>` : ''}
    ${a.trialUsed && a.status !== 'pending' ? '<div class="card banner">Seu acesso terminou. Assine para continuar com a sua planilha.</div>' : ''}
    <div class="plans">
      ${card('basico', false, ['Planilha montada pelo seu objetivo e nível', 'Ritmos de treino personalizados', 'Treino do dia na tela inicial', 'Registro de km, tempo e esforço'])}
      ${card('premium', true, ['Tudo do Básico', 'Treinador revisa e ajusta sua planilha', 'Chat direto com o treinador', 'Comentários do treinador em cada treino'])}
    </div>
    <p class="muted" style="text-align:center">Pagamento mensal pelo Mercado Pago. Cancele quando quiser.</p>`;
}

function questionnaire(p = {}) {
  const goal = p.goal || '10k';
  return `
    <div class="field">Objetivo
      <div class="chips seg-goal">${['5k', '10k', '21k', '42k'].map((g) => `<label class="chip ${goal === g ? 'on' : ''}"><input type="radio" name="goal" value="${g}" ${goal === g ? 'checked' : ''} hidden>${g.toUpperCase()}</label>`).join('')}</div>
    </div>
    <div class="row">
      <label class="field grow">Nível
        <select name="level">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${(p.level || 'intermediario') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
      <label class="field grow">Semanas
        <input name="weeks" type="number" min="4" max="20" value="${p.weeks || 8}">
      </label>
    </div>
    <div class="row">
      <label class="field grow">Treinos/semana
        <select name="daysPerWeek">${[3, 4, 5, 6].map((n) => `<option ${(p.daysPerWeek || 4) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      <label class="field grow">Dia do longão
        <select name="longDay"><option value="6" ${p.longDay === 6 ? 'selected' : ''}>Sábado</option><option value="0" ${p.longDay !== 6 ? 'selected' : ''}>Domingo</option></select>
      </label>
    </div>
    <label class="field">Marca recente <small class="muted">ex: 10 km em 55 min, ou "corro 5 km a 6:00/km"</small>
      <input name="mark" value="${esc(p.mark || '')}" placeholder="10 km em 55 min">
    </label>
    <div class="row">
      <label class="field grow">Meta de tempo <small class="muted">opcional</small><input name="target" value="${esc(p.target || '')}" placeholder="abaixo de 50 min"></label>
      <label class="field grow">Volume atual (km/sem)<input name="volumeKm" type="number" min="0" max="200" value="${p.volumeKm ?? 20}"></label>
    </div>
    <label class="field">Data da prova <small class="muted">opcional — se preencher, as semanas são contadas até ela</small><input name="raceDate" type="date" value="${p.raceDate || ''}"></label>
    <label class="field">Observações <small class="muted">lesões, horários, terreno, provas no caminho…</small><textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>`;
}

function readQuestionnaire(f) {
  return {
    goal: f.get('goal'), level: f.get('level'), weeks: Number(f.get('weeks')), daysPerWeek: Number(f.get('daysPerWeek')),
    longDay: Number(f.get('longDay')), mark: f.get('mark').trim(), target: f.get('target').trim(),
    volumeKm: f.get('volumeKm'), raceDate: f.get('raceDate') || null, notes: f.get('notes').trim(),
  };
}

function chipToggle(ev) {
  if (ev.target.name === 'goal') ev.target.closest('.chips').querySelectorAll('label').forEach((l) => l.classList.toggle('on', l.contains(ev.target)));
}

function openQuestionnaire(p, onSave, title = 'Refazer planilha') {
  openModal(`<h3>${title}</h3>${questionnaire(p)}
    <div class="muted" style="margin:8px 0">Os treinos de hoje em diante serão gerados de novo. Os já feitos ficam no histórico.</div>
    <div class="actions"><button value="cancel" formnovalidate>Cancelar</button><button class="btn-primary" value="ok">Gerar planilha</button></div>`, {
    onSubmit(f) { onSave(readQuestionnaire(f)); },
    onClick: chipToggle,
  });
}

// Gera a planilha: a IA roda em segundo plano; se não der para chamar, usa o gerador padrão
let pollTimer = null;
async function startGeneration(data, athleteId = null) {
  const r = await runApi(athleteId ? `coach/regenerate/${athleteId}` : 'profile', { method: 'POST', body: data });
  if (r.mode === 'ia') {
    const headers = { 'content-type': 'application/json' };
    if (DEV_USER) headers['x-dev-user'] = JSON.stringify(DEV_USER);
    const res = await fetch('/bg/plan', { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({ today: todayStr(), athleteId }) }).catch(() => null);
    if (!res || !res.ok) await runApi(athleteId ? `coach/fallback/${athleteId}` : 'fallback', { method: 'POST' });
  }
  await refreshRunViews();
  if (r.mode !== 'ia') toast('Planilha pronta! 🎉');
}

async function refreshRunViews() {
  await loadRun();
  if (coachAthlete) coachAthlete = await runApi(`coach/athlete/${coachAthlete.user.id}`).catch(() => coachAthlete);
  render();
}

// Enquanto a IA trabalha, confere a cada 5 s
function watchGeneration(profile) {
  if (profile?.status !== 'generating' || pollTimer) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    const was = profile.status;
    await refreshRunViews();
    const now = (coachAthlete && runMode === 'alunos' ? coachAthlete.profile : R?.profile);
    if (was === 'generating' && now?.status === 'ready') toast(now.error ? '⚠️ Planilha feita com o gerador padrão' : 'Planilha pronta! 🎉', 3000);
  }, 5000);
}

function generatingView(profile, athleteId = '') {
  if (profile.status === 'generating') {
    watchGeneration(profile);
    return `<div class="card loading-card"><div class="big">🤖</div><div class="name">Montando a planilha…</div>
      <div class="muted">O treinador virtual está calculando ritmos e progressão. Pode levar até 2 minutos — pode sair do app que ela fica salva.</div>
      <div class="bar indeterminate"><i></i></div></div>`;
  }
  return `<div class="card banner">⏳ A geração demorou demais.
    <div class="row" style="margin-top:10px"><button class="grow btn-primary" data-action="run-fallback" data-id="${athleteId}">Usar gerador rápido</button>
    <button class="grow" data-action="${athleteId ? 'coach-redo' : 'run-redo'}">Tentar de novo</button></div></div>`;
}

/* ---------- Grade semana × dia e downloads (como a planilha do treinador) ---------- */

const GRID_DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
let runLayout = store.get('run-layout', 'lista');

function gridWeeks(profile, sessions) {
  return weeksOf(sessions).map(([w, list]) => {
    const days = Array(7).fill(null);
    for (const s of list) days[(parseDate(s.day).getDay() + 6) % 7] = s;
    return { w, phase: list[0].phase || '', km: list.reduce((t, s) => t + (s.distanceKm || 0), 0), days };
  });
}

function gridView(profile, sessions, today, action) {
  return `<div class="sheet-wrap"><table class="sheet">
    <thead><tr><th>Sem.</th>${GRID_DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${gridWeeks(profile, sessions).map((r) => `<tr><td class="wk"><b>S${r.w}</b><span>${esc(r.phase)}</span><span class="vol">${fmtNum(r.km)} km</span></td>${r.days.map((s) => (s
      ? `<td class="${s.done ? 'done' : ''} ${s.day === today ? 'today' : ''}" data-action="${action}" data-id="${s.id}">${typeChip(s.type)}${s.distanceKm ? `<span class="km">${fmtNum(s.distanceKm)} km</span>` : ''}${s.pace ? `<span class="rit">${esc(s.pace)}</span>` : ''}<span class="dsc">${esc(s.description || '')}</span>${s.done ? '<span>✅</span>' : ''}</td>`
      : '<td class="rest">Descanso</td>')).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function cellText(s) {
  if (!s) return 'Descanso';
  return [TYPES[s.type] || s.type, s.distanceKm ? `${fmtNum(s.distanceKm)} km` : '', s.pace ? `@ ${s.pace}` : '', s.description || ''].filter(Boolean).join(' · ');
}

async function exportPlan(kind, profile, sessions, athleteName) {
  const title = profile.meta?.titulo || `${GOALS[profile.goal]} · ${LEVELS[profile.level]}`;
  const name = `${athleteName ? `${athleteName} ` : ''}${title}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'plano-corrida';
  const rows = gridWeeks(profile, sessions);
  const detail = [['Semana', 'Data', 'Dia', 'Tipo', 'Distância (km)', 'Ritmo', 'Descrição', 'Feito?']];
  sessions.forEach((s) => detail.push([s.week, fmtDate(s.day, { day: '2-digit', month: '2-digit', year: 'numeric' }), GRID_DAYS[(parseDate(s.day).getDay() + 6) % 7], TYPES[s.type] || s.type, s.distanceKm ?? '', s.pace || '', s.description || '', s.done ? 'Sim' : '']));
  try {
    if (kind === 'csv') {
      saveBlob(new Blob(['﻿' + detail.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv' }), `${name}.csv`);
    } else if (kind === 'xlsx') {
      const X = await import('xlsx'); const wb = X.utils.book_new();
      const s1 = X.utils.aoa_to_sheet([['Semana', 'Foco', 'Volume (km)', ...GRID_DAYS], ...rows.map((r) => [r.w, r.phase, Math.round(r.km), ...r.days.map(cellText)])]);
      s1['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 12 }, ...GRID_DAYS.map(() => ({ wch: 34 }))];
      X.utils.book_append_sheet(wb, s1, 'Planilha');
      const s2 = X.utils.aoa_to_sheet(detail); s2['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 60 }, { wch: 8 }];
      X.utils.book_append_sheet(wb, s2, 'Detalhado');
      const z = profile.meta?.zonas || [];
      if (z.length) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Zona', 'Ritmo', 'Descrição'], ...z.map((x) => [x.nome, x.ritmo, x.descricao])]), 'Zonas');
      saveBlob(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
    } else {
      const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const autoTable = [at.default, at.default?.default, at.autoTable].find((f) => typeof f === 'function');
      saveBlob(buildPdf(jsPDF, autoTable, profile, rows, title, athleteName), `${name}.pdf`);
    }
    toast('Arquivo baixado');
  } catch (e) { toast(`⚠️ ${e.message}`); }
}

const PDF_FILL = { leve: [226, 243, 232], regenerativo: [226, 243, 232], ritmo: [252, 240, 210], intervalado: [251, 224, 221], prova: [251, 224, 221], longo: [221, 232, 250] };
const PDF_INK = { leve: [31, 120, 72], regenerativo: [31, 120, 72], ritmo: [150, 100, 0], intervalado: [180, 40, 32], prova: [180, 40, 32], longo: [34, 84, 165] };

// PDF em A4 deitado, no mesmo estilo da planilha do treinador
function buildPdf(jsPDF, autoTable, profile, rows, title, athleteName) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 10;
  const clean = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ–—…×\n]/g, '');
  const total = rows.reduce((t, r) => t + r.km, 0), peak = Math.max(0, ...rows.map((r) => r.km));
  doc.setFillColor(21, 32, 26); doc.rect(0, 0, W, 24, 'F');
  doc.setFillColor(214, 70, 31); doc.rect(0, 24, W, 1.4, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(clean(title), M, 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(clean([athleteName ? `Atleta: ${athleteName}` : '', `${rows.length} semanas`, `${Math.round(total)} km no total`, `pico de ${Math.round(peak)} km/semana`].filter(Boolean).join('   ·   ')), M, 18.5);
  let y = 31; doc.setTextColor(60, 70, 64);
  if (profile.meta?.resumo) { const l = doc.splitTextToSize(clean(profile.meta.resumo), W - 2 * M); doc.text(l, M, y); y += l.length * 4.4 + 2; }
  const zonas = profile.meta?.zonas?.length ? profile.meta.zonas.map((z) => `${z.nome}: ${z.ritmo}`)
    : ['regenerativo', 'leve', 'longo', 'ritmo', 'intervalado'].map((k) => `${TYPES[k]}: ${profile.paces[k]}`);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(21, 32, 26); doc.setFontSize(9);
  const zl = doc.splitTextToSize(clean(`Zonas de ritmo   ${zonas.join('     ')}`), W - 2 * M); doc.text(zl, M, y); y += zl.length * 4.2 + 1;
  doc.setFont('helvetica', 'normal');
  const kinds = rows.map((r) => r.days.map((s) => (s ? s.type : 'descanso')));
  autoTable(doc, {
    startY: y + 1, margin: { left: M, right: M, bottom: 14 },
    head: [['Semana', ...GRID_DAYS]],
    body: rows.map((r) => [`S${r.w}\n${r.phase}\n${Math.round(r.km)} km`, ...r.days.map((s) => (s ? [(TYPES[s.type] || s.type).toUpperCase(), [s.distanceKm ? `${fmtNum(s.distanceKm)} km` : '', s.pace ? `@ ${s.pace}` : ''].filter(Boolean).join('  '), s.description || ''].filter(Boolean).join('\n') : 'Descanso'))].map(clean)),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.4, cellPadding: 1.6, valign: 'top', lineColor: [210, 216, 210], lineWidth: 0.2, textColor: [25, 32, 28], overflow: 'linebreak' },
    headStyles: { fillColor: [21, 32, 26], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, halign: 'center' },
    columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold', fillColor: [238, 241, 237] } },
    rowPageBreak: 'avoid',
    didParseCell: (h) => {
      if (h.section !== 'body' || h.column.index === 0) return;
      const k = kinds[h.row.index][h.column.index - 1];
      h.cell.styles.fillColor = PDF_FILL[k] || [244, 245, 244];
      if (k === 'descanso') h.cell.styles.textColor = [130, 140, 134];
    },
    didDrawCell: (h) => {
      if (h.section !== 'body' || h.column.index === 0) return;
      const k = kinds[h.row.index][h.column.index - 1];
      if (!PDF_INK[k]) return;
      doc.setFillColor(...PDF_INK[k]); doc.rect(h.cell.x, h.cell.y, 1.1, h.cell.height, 'F');
    },
  });
  const dicas = profile.meta?.dicas || [];
  if (dicas.length) {
    let yy = doc.lastAutoTable.finalY + 7; const H = doc.internal.pageSize.getHeight();
    const lines = dicas.flatMap((t) => doc.splitTextToSize(`•  ${clean(t)}`, W - 2 * M));
    if (yy + 6 + lines.length * 4.2 > H - 14) { doc.addPage(); yy = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(21, 32, 26); doc.text('DICAS', M, yy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(60, 70, 64); doc.text(lines, M, yy + 5);
  }
  const n = doc.getNumberOfPages(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(130, 140, 134); doc.text(clean(`${athleteName ? `${athleteName} · ` : ''}${title}`), M, H - 6); doc.text(`${i}/${n}`, W - M, H - 6, { align: 'right' }); }
  return doc.output('blob');
}

function myRunView(today) {
  const a = R.access;
  if (!a.active) return plansView();
  if (!R.profile) {
    return `
      ${a.trialDaysLeft && !a.free ? `<div class="card banner">🎁 Teste grátis do plano ${R.plans[a.plan].name}: faltam ${a.trialDaysLeft} dias.</div>` : ''}
      <h2>Monte sua planilha</h2>
      <form class="card" id="run-q">${questionnaire()}<button type="button" class="btn-primary btn-block" data-action="run-generate" style="margin-top:6px">Gerar minha planilha</button></form>`;
  }
  const premium = a.plan === 'premium';
  return `
    ${a.trialDaysLeft && !a.free ? `<div class="card banner row between"><span>🎁 Teste grátis: faltam <b>${a.trialDaysLeft} dias</b></span><button class="btn-small btn-blue" data-action="run-subscribe" data-plan="${a.plan}">Assinar</button></div>` : ''}
    ${planView(R.profile, R.sessions, today)}
    <h2>💬 Treinador</h2>
    <div class="card">
      ${premium ? chatView(R.messages, 'run-send', 'Escreva para o treinador…')
        : `<div class="muted">Converse com o treinador e receba ajustes na sua planilha no plano Premium (${money(R.plans.premium.price)}/mês).</div>
           <button class="btn-block btn-blue" style="margin-top:10px" data-action="run-subscribe" data-plan="premium">Mudar para Premium</button>`}
    </div>
    <div class="row" style="margin-top:4px">
      <button class="grow" data-action="run-redo">🔄 Refazer planilha</button>
      ${!a.free && (a.hasPayment || a.status === 'trial') ? '<button class="grow" data-action="run-manage">Assinatura</button>' : ''}
    </div>`;
}

function coachListView() {
  if (!coachList) { loadCoachList(); return '<div class="empty">Carregando alunos…</div>'; }
  if (!coachList.length) return '<div class="card empty"><div class="big">🏃</div>Nenhum aluno ainda. Quando alguém montar a planilha, aparece aqui.</div>';
  const label = (a) => (a.status === 'trial' ? `Teste · ${a.trialDaysLeft}d` : a.active ? R.plans[a.plan].name : a.status === 'pending' ? 'Pagamento pendente' : 'Inativo');
  const withPast = coachList.filter((x) => x.past);
  const avg = withPast.length ? Math.round((withPast.reduce((t, x) => t + x.done / x.past, 0) / withPast.length) * 100) : null;
  const doneSum = coachList.reduce((t, x) => t + x.done, 0);
  const unread = coachList.reduce((t, x) => t + x.unread, 0);
  return `
    <div class="kpis">
      ${tile('Alunos', coachList.length)}
      ${tile('Adesão média', avg === null ? '—' : `${avg}<small>%</small>`, { delta: 'últimos 28 dias' })}
      ${tile('Treinos feitos', doneSum, { delta: 'últimos 28 dias' })}
      ${tile('Mensagens novas', unread)}
    </div>
    <h2>Alunos</h2>
    ${coachList.map((x) => {
      const pct = x.past ? Math.round((x.done / x.past) * 100) : null;
      return `
      <div class="card athlete" data-action="coach-open" data-id="${x.id}" role="button" tabindex="0">
        <div class="row">
          ${avatar(x, 40)}
          <div class="grow">
            <div class="name">${esc(x.name)} ${x.unread ? `<span class="unread">${x.unread}</span>` : ''}</div>
            <div class="muted">${x.goal ? GOALS[x.goal] : 'Sem planilha'}${x.raceDate ? ` · prova ${fmtDate(x.raceDate)}` : ''}</div>
          </div>
          ${R.access.free ? '' : `<span class="chip ${x.access.active ? (x.access.plan === 'premium' ? 'on' : 'ok') : ''}">${label(x.access)}</span>`}
        </div>
        <div class="adh">
          <span class="muted">Adesão</span>
          <div class="bar" role="img" aria-label="Adesão ${pct ?? 0}%"><i style="width:${pct ?? 0}%"></i></div>
          <b>${pct === null ? '—' : `${pct}%`}</b>
        </div>
        <div class="muted" style="margin-top:4px">${x.done} de ${x.past} treinos nos últimos 28 dias</div>
      </div>`;
    }).join('')}`;
}

function coachAthleteView(today) {
  const x = coachAthlete;
  const a = x.access;
  return `
    <button class="back" data-action="coach-back">← Alunos</button>
    <div class="card row">${avatar(x.user, 44)}<div class="grow"><div class="name">${esc(x.user.name)}</div><div class="muted">${esc(x.user.email)}</div></div>
      ${R.access.free ? '' : `<span class="chip ${a.active ? 'ok' : ''}">${a.active ? R.plans[a.plan].name : 'Inativo'}</span>`}</div>
    <div class="card" ${R.access.free ? 'hidden' : ''}>
      <div class="muted" style="margin-bottom:6px">Acesso manual (ex.: pagou por Pix direto)</div>
      <div class="row"><button class="grow btn-small" data-action="coach-access" data-plan="basico">Liberar Básico</button>
        <button class="grow btn-small" data-action="coach-access" data-plan="premium">Liberar Premium</button>
        <button class="btn-small btn-danger" data-action="coach-access" data-status="cancelled">Bloquear</button></div>
    </div>
    ${x.profile ? `${x.profile.notes ? `<div class="note">📋 ${esc(x.profile.notes)}</div>` : ''}${planView(x.profile, x.sessions, today, { action: 'coach-session', who: 'coach' })}` : '<div class="card empty">Este aluno ainda não preencheu o questionário.</div>'}
    <div class="row" style="margin-bottom:12px">
      <button class="grow" data-action="coach-add">+ Adicionar treino</button>
      <button class="grow" data-action="coach-redo">🔄 Gerar planilha</button>
    </div>
    <h2>💬 Conversa</h2>
    <div class="card">${chatView(x.messages, 'coach-send', `Mensagem para ${x.user.name.split(' ')[0]}…`)}</div>`;
}

function viewRun() {
  const today = todayStr();
  if (!R && runError) return `<div class="empty">⚠️ ${esc(runError)}<br><br><button data-action="run-retry">Tentar de novo</button></div>`;
  if (!R) { loadRun().then(render); return '<div class="empty">Carregando…</div>'; }
  if (!R.coach) return myRunView(today);
  const unread = coachList ? coachList.reduce((t, x) => t + x.unread, 0) : 0;
  return `
    <div class="card seg" style="grid-template-columns:1fr 1fr">
      <button class="${runMode === 'me' ? 'on' : ''}" data-action="run-mode" data-v="me">Minha planilha</button>
      <button class="${runMode === 'alunos' ? 'on' : ''}" data-action="run-mode" data-v="alunos">Alunos ${unread ? `<span class="unread">${unread}</span>` : ''}</button>
    </div>
    ${runMode === 'alunos' ? (coachAthlete ? coachAthleteView(today) : coachListView()) : myRunView(today)}`;
}

async function loadCoachList() {
  try { coachList = await runApi(`coach/athletes?today=${todayStr()}`); } catch (e) { coachList = []; toast(`⚠️ ${e.message}`); }
  render();
}
async function openCoachAthlete(id) {
  try { coachAthlete = await runApi(`coach/athlete/${id}`); render(); window.scrollTo(0, 0); } catch (e) { toast(`⚠️ ${e.message}`); }
}

function runTodayCard(today) {
  if (!R?.access?.active) return '';
  const s = R.sessions.find((x) => x.day === today);
  if (!s) return '';
  return `
    <h2>Corrida de hoje</h2>
    <div class="card row">
      <div class="emoji" aria-hidden="true">🏃</div>
      <div class="grow" data-action="run-open" data-id="${s.id}" style="cursor:pointer">
        <div class="name">${esc(s.title)}</div>
        <div class="muted">${typeChip(s.type)} ${s.distanceKm ? `${fmtNum(s.distanceKm)} km` : ''} ${s.pace ? `· ${esc(s.pace)}` : ''}</div>
      </div>
      <button class="check ${s.done ? 'on' : ''}" data-action="run-open" data-id="${s.id}" aria-label="Registrar corrida">✓</button>
    </div>`;
}

function openRunSession(s) {
  openModal(`
    <h3>${esc(s.title)}</h3>
    <div class="muted" style="margin:-8px 0 10px">${fmtDate(s.day, { weekday: 'long', day: '2-digit', month: 'long' })} · ${typeChip(s.type)}</div>
    <div class="row" style="gap:16px;margin-bottom:8px">${s.distanceKm ? `<div><b>${fmtNum(s.distanceKm)} km</b></div>` : ''}${s.pace ? `<div>⏱ ${esc(s.pace)}</div>` : ''}</div>
    <div class="desc">${esc(s.description || '')}</div>
    ${s.coachNote ? `<div class="note">💬 Treinador: ${esc(s.coachNote)}</div>` : ''}
    <h2>Como foi</h2>
    <label class="row" style="margin-bottom:10px;font-size:15px"><input type="checkbox" name="done" ${s.done || !s.feedback ? 'checked' : ''}> Treino feito</label>
    <div class="row">
      <label class="field grow">Distância (km)<input name="actualKm" type="number" step="0.01" inputmode="decimal" value="${s.actualKm ?? s.distanceKm ?? ''}"></label>
      <label class="field grow">Tempo total<input name="actualTime" placeholder="ex. 42:30" value="${esc(s.actualTime || '')}"></label>
    </div>
    <label class="field">Esforço (1 = muito leve, 10 = máximo): <b id="rpe-v">${s.rpe || 5}</b>
      <input name="rpe" type="range" min="1" max="10" value="${s.rpe || 5}" oninput="document.getElementById('rpe-v').textContent=this.value">
    </label>
    <label class="field">Comentário<textarea name="feedback" rows="2" placeholder="Sentiu alguma dor? Como estava o clima?">${esc(s.feedback || '')}</textarea></label>
    <div class="actions"><button value="cancel" formnovalidate>Fechar</button><button class="btn-primary" value="ok">Salvar</button></div>`, {
    onSubmit(f) {
      Object.assign(s, { done: f.get('done') === 'on', actualKm: f.get('actualKm'), actualTime: f.get('actualTime').trim(), rpe: Number(f.get('rpe')), feedback: f.get('feedback').trim() });
      if (s.done) { toast('Corrida registrada! 🏃'); haptic([30, 60, 30]); celebrate('big'); }
      save(runApi(`sessions/${s.id}`, { method: 'PUT', body: s }));
    },
  });
}

function openCoachSession(s, athleteId) {
  const isNew = !s;
  s = s || { day: todayStr(), type: 'leve', title: '', description: '', distanceKm: '', pace: '', coachNote: '' };
  openModal(`
    <h3>${isNew ? 'Novo treino' : 'Editar treino'}</h3>
    ${!isNew && s.done ? `<div class="note">✅ Feito: ${s.actualKm ? `${fmtNum(s.actualKm)} km` : ''} ${s.actualTime ? `em ${esc(s.actualTime)}` : ''} ${s.rpe ? `· esforço ${s.rpe}/10` : ''}${s.feedback ? `\n“${esc(s.feedback)}”` : ''}</div>` : ''}
    <div class="row">
      <label class="field grow">Data<input name="day" type="date" value="${s.day}" required></label>
      <label class="field grow">Tipo<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="field">Título<input name="title" value="${esc(s.title)}" required placeholder="Ex: Intervalado 6 × 800 m"></label>
    <div class="row">
      <label class="field grow">Distância (km)<input name="distanceKm" type="number" step="0.5" value="${s.distanceKm ?? ''}"></label>
      <label class="field grow">Ritmo-alvo<input name="pace" value="${esc(s.pace || '')}" placeholder="5:30–5:50/km"></label>
    </div>
    <label class="field">Descrição<textarea name="description" rows="4">${esc(s.description || '')}</textarea></label>
    <label class="field">Recado para o aluno<textarea name="coachNote" rows="2">${esc(s.coachNote || '')}</textarea></label>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn-danger" data-m="delete">Excluir</button>'}
      <button value="cancel" formnovalidate>Cancelar</button><button class="btn-primary" value="ok">Salvar</button>
    </div>`, {
    onSubmit(f) {
      const data = Object.fromEntries(['day', 'type', 'title', 'distanceKm', 'pace', 'description', 'coachNote'].map((k) => [k, f.get(k)]));
      const req = isNew
        ? runApi('coach/sessions', { method: 'POST', body: { ...data, athleteId, week: s.week || 0 } })
        : runApi(`coach/sessions/${s.id}`, { method: 'PUT', body: data });
      req.then(() => openCoachAthlete(athleteId)).catch((e) => toast(`⚠️ ${e.message}`));
    },
    onClick(ev) {
      if (ev.target.closest('[data-m=delete]') && confirm('Excluir este treino?')) {
        $modal.close();
        runApi(`coach/sessions/${s.id}`, { method: 'DELETE' }).then(() => openCoachAthlete(athleteId)).catch((e) => toast(`⚠️ ${e.message}`));
      }
    },
  });
}

function openManage() {
  const a = R.access;
  openModal(`
    <h3>Sua assinatura</h3>
    <p>Plano <b>${R.plans[a.plan].name}</b> · ${money(R.plans[a.plan].price)}/mês</p>
    <p class="muted">${a.status === 'trial' ? `Teste grátis: faltam ${a.trialDaysLeft} dias.` : 'Cobrança mensal pelo Mercado Pago.'}</p>
    <div class="actions" style="justify-content:stretch;flex-direction:column">
      ${a.plan === 'basico' ? `<button type="button" class="btn-blue" data-m="sub" data-plan="premium">Mudar para Premium (${money(R.plans.premium.price)})</button>` : `<button type="button" data-m="sub" data-plan="basico">Mudar para Básico (${money(R.plans.basico.price)})</button>`}
      ${a.status === 'trial' && !a.hasPayment ? `<button type="button" class="btn-primary" data-m="sub" data-plan="${a.plan}">Assinar agora</button>` : ''}
      <button type="button" class="btn-danger" data-m="cancel">Cancelar assinatura</button>
      <button value="cancel">Fechar</button>
    </div>`, {
    onClick(ev) {
      const t = ev.target.closest('[data-m]');
      if (!t) return;
      if (t.dataset.m === 'sub') { $modal.close(); subscribe(t.dataset.plan); }
      if (t.dataset.m === 'cancel' && confirm('Cancelar a assinatura? Você perde o acesso à planilha.')) {
        $modal.close();
        runApi('cancel', { method: 'POST' }).then(loadRun).then(render).then(() => toast('Assinatura cancelada')).catch((e) => toast(`⚠️ ${e.message}`));
      }
    },
  });
}

async function subscribe(plan) {
  if (!R.paymentsReady) return toast('O pagamento ainda está sendo configurado. Fale com o treinador.', 3000);
  try {
    toast('Abrindo o Mercado Pago…');
    const { url } = await runApi('subscribe', { method: 'POST', body: { plan } });
    location.href = url;
  } catch (e) { toast(`⚠️ ${e.message}`); }
}

function chatText() { const el = $('#chat-input'); const v = el?.value.trim(); return v || null; }

async function handleRunAction(d, t) {
  switch (d.action) {
    case 'run-retry': runError = null; return render();
    case 'run-mode': runMode = d.v; store.set('run-mode', runMode); coachAthlete = null; if (runMode === 'alunos') coachList = null; return render();
    case 'run-trial':
      try { await runApi('trial', { method: 'POST', body: { plan: d.plan } }); await loadRun(); render(); toast(`🎁 ${R.trialDays} dias grátis liberados!`); } catch (e) { toast(`⚠️ ${e.message}`); }
      return;
    case 'run-subscribe': return subscribe(d.plan);
    case 'run-refresh': await runApi('refresh', { method: 'POST' }).catch(() => {}); await loadRun(); return render();
    case 'run-manage': return openManage();
    case 'run-generate': {
      const data = readQuestionnaire(new FormData($('#run-q')));
      if (!data.mark && !confirm('Sem a marca recente, os ritmos ficam menos precisos. Gerar mesmo assim?')) return;
      try { t.disabled = true; t.textContent = 'Enviando…'; await startGeneration(data); } catch (e) { toast(`⚠️ ${e.message}`); t.disabled = false; }
      return;
    }
    case 'run-redo':
      return openQuestionnaire(R.profile, (data) => startGeneration(data).catch((e) => toast(`⚠️ ${e.message}`)));
    case 'run-fallback':
      try { await runApi(d.id ? `coach/fallback/${d.id}` : 'fallback', { method: 'POST' }); await refreshRunViews(); toast('Planilha pronta!'); } catch (e) { toast(`⚠️ ${e.message}`); }
      return;
    case 'run-layout': runLayout = d.v; store.set('run-layout', runLayout); return render();
    case 'run-export': {
      const src = d.who === 'coach' ? coachAthlete : R;
      return exportPlan(d.kind, src.profile, src.sessions, d.who === 'coach' ? coachAthlete.user.name : S.me.name);
    }
    case 'run-open': return openRunSession(R.sessions.find((s) => s.id === d.id));
    case 'run-send': {
      const text = chatText(); if (!text) return;
      try { await runApi('messages', { method: 'POST', body: { body: text } }); await loadRun(); render(); $('#chat')?.scrollTo(0, 1e6); } catch (e) { toast(`⚠️ ${e.message}`); }
      return;
    }
    case 'coach-open': return openCoachAthlete(d.id);
    case 'coach-back': coachAthlete = null; coachList = null; return render();
    case 'coach-session': return openCoachSession(coachAthlete.sessions.find((s) => s.id === d.id), coachAthlete.user.id);
    case 'coach-add': return openCoachSession(null, coachAthlete.user.id);
    case 'coach-redo':
      return openQuestionnaire(coachAthlete.profile || {}, (data) => startGeneration(data, coachAthlete.user.id).catch((e) => toast(`⚠️ ${e.message}`)), `Planilha de ${coachAthlete.user.name}`);
    case 'coach-access': {
      const body = d.status ? { status: d.status, plan: coachAthlete.access.plan } : { status: 'active', plan: d.plan };
      if (!confirm(d.status ? 'Bloquear o acesso deste aluno?' : `Liberar o plano ${R.plans[d.plan].name} para este aluno?`)) return;
      try { await runApi(`coach/access/${coachAthlete.user.id}`, { method: 'PUT', body }); await openCoachAthlete(coachAthlete.user.id); toast('Acesso atualizado'); } catch (e) { toast(`⚠️ ${e.message}`); }
      return;
    }
    case 'coach-send': {
      const text = chatText(); if (!text) return;
      try { await runApi(`coach/messages/${coachAthlete.user.id}`, { method: 'POST', body: { body: text } }); await openCoachAthlete(coachAthlete.user.id); $('#chat')?.scrollTo(0, 1e6); } catch (e) { toast(`⚠️ ${e.message}`); }
      return;
    }
    default:
  }
}

/* ================= Eventos ================= */

document.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab; store.set('tab', tab); enterAnim = true;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  render(); window.scrollTo(0, 0);
});

$view.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action]');
  if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
  const d = t.dataset;
  const c = d.id ? byId(S.challenges, d.id) : null;
  const w = d.w ? byId(S.workouts, d.w) : null;

  if (d.action.startsWith('run-') || d.action.startsWith('coach-')) return handleRunAction(d, t);
  switch (d.action) {
    case 'toggle': {
      const e = myChecks(c)[d.day];
      if (!dayDone(c, e)) { haptic(15); popSel = `[data-pop="c-${c.id}"]`; celebrate('small', t.getBoundingClientRect()); }
      if (dayDone(c, e) && !e.note && !e.photo) removeCheck(c, d.day);
      else if (dayDone(c, e)) setCheck(c, d.day, { ...e, value: 0 });
      else setCheck(c, d.day, { value: 1, note: e?.note || '', photo: e?.photo || null });
      break;
    }
    case 'checkin': return openCheckin(c, d.day);
    case 'set-done': {
      const log = getOrCreateLog(d.day, w);
      const s = log.exercises[d.e].sets[d.s];
      s.done = !s.done;
      if (s.done) {
        haptic(12);
        popSel = `[data-pop="s-${w.id}-${d.e}-${d.s}"]`;
        if (log.exercises.every((x) => x.sets.every((y) => y.done))) stopRest(); else startRest();
      }
      return save(saveLog(log));
    }
    case 'set-add': case 'set-remove': {
      const log = getOrCreateLog(d.day, w);
      const sets = log.exercises[d.e].sets;
      if (d.action === 'set-add') sets.push({ ...(sets[sets.length - 1] || { reps: 10, weight: 0 }), done: false });
      else if (sets.length > 1) sets.pop();
      return save(saveLog(log));
    }
    case 'finish': {
      const log = getOrCreateLog(d.day, w);
      log.finished = !log.finished;
      if (log.finished) log.exercises.forEach((e) => e.sets.forEach((s) => { s.done = true; }));
      // reflete na hora os desafios ligados ao treino
      const anyFinished = S.logs.some((l) => l.day === d.day && l.finished);
      S.challenges.filter((x) => x.linkWorkout && x.kind !== 'quantity' && d.day >= x.start && d.day <= addDays(x.start, x.days - 1)).forEach((x) => {
        const mine = (x.checkins[myId()] ||= {});
        if (anyFinished) mine[d.day] ||= { value: 1, note: '', photo: null };
        else if (mine[d.day] && !mine[d.day].note && !mine[d.day].photo) delete mine[d.day];
      });
      if (log.finished) { toast('Treino concluído! 💪'); stopRest(); haptic([30, 60, 30]); celebrate('big'); }
      return save(saveLog(log, true));
    }
    case 'chart': return openChart(d.name);
    case 'rest-cycle': {
      const opts = [60, 90, 120, 180];
      const next = opts[(opts.indexOf(restDefault()) + 1) % opts.length];
      setRestDefault(next); toast(`⏱ Descanso entre séries: ${next}s`);
      return render();
    }
    case 'rest-set': setRestDefault(Number(d.v)); return render();
    case 'new-challenge': return openChallengeForm();
    case 'edit-challenge': return openChallengeForm(c);
    case 'invite': return openInvite(c);
    case 'join': return openJoin();
    case 'new-workout': return openWorkoutForm();
    case 'edit-workout': return openWorkoutForm(byId(S.workouts, d.id));
    case 'start-workout': return startWorkout(todayStr(), byId(S.workouts, d.id));
    case 'pick-workout': return openPickWorkout(d.day);
    case 'theme': store.set('theme', d.v); applyTheme(); return render();
    case 'enable-push': return enablePush();
    case 'test-push': return api('push/test', { method: 'POST' }).then((r) => toast(r.sent ? 'Notificação enviada!' : 'Nenhum aparelho inscrito')).catch((e) => toast(`⚠️ ${e.message}`));
    case 'photo': return window.open(t.src, '_blank');
    case 'logout':
      if (!confirm('Sair da conta?')) return;
      if (DEV_USER) store.del('dev-user');
      return logout().catch(() => {}).finally(() => location.reload());
    default:
  }
});

// Ajuste de reps/carga de uma série. Séries seguintes ainda não feitas recebem o mesmo valor.
$view.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'goal') { chipToggle(ev); return; }
  if (t.dataset.action === 'reminder-hour') {
    const hour = t.value === '' ? null : Number(t.value);
    setReminder(hour).then(() => toast(hour === null ? 'Lembrete desligado' : `Lembrete às ${String(hour).padStart(2, '0')}:00`)).catch((e) => toast(`⚠️ ${e.message}`));
    return;
  }
  if (t.dataset.action !== 'set-field') return;
  const w = byId(S.workouts, t.dataset.w);
  const log = getOrCreateLog(t.dataset.day, w);
  const sets = log.exercises[t.dataset.e].sets;
  const val = Number(t.value) || 0;
  sets.forEach((s, i) => {
    if (i === Number(t.dataset.s) || (i > Number(t.dataset.s) && !s.done)) s[t.dataset.field] = val;
  });
  save(saveLog(log));
});

/* ================= Login e início ================= */

function showLogin(message = '') {
  S = null;
  document.body.classList.add('logged-out');
  $('#title').textContent = '';
  $('#hello').textContent = '';
  $('#today').textContent = '';
  const invite = store.get('pending-invite');
  $view.innerHTML = `
    <div class="login">
      <div class="orbit" aria-hidden="true">
        <svg viewBox="0 0 150 150">
          <defs>
            <linearGradient id="lg-sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#ec4899"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
            <radialGradient id="lg-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".5"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
          </defs>
          <circle cx="75" cy="75" r="72" fill="url(#lg-glow)"/>
          <g class="spin"><ellipse cx="75" cy="75" rx="66" ry="24" fill="none" stroke="url(#lg-sun)" stroke-width="3" opacity=".7" transform="rotate(-24 75 75)"/><circle cx="135" cy="50" r="6" fill="#f59e0b"/></g>
          <circle cx="75" cy="75" r="38" fill="none" stroke="url(#lg-sun)" stroke-width="9"/>
          <path d="M60 76l11 11 21-24" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2 class="grad-text">Desafios & Treinos</h2>
      <p class="tag">Desafios com os amigos, treino do dia e planilha de corrida. Tudo num app só, com o astral lá em cima.</p>
      ${invite ? '<p class="chip on" style="display:inline-block;margin-top:14px">Você recebeu um convite! Entre para participar.</p>' : ''}
      <button class="btn-google" id="google-login">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Entrar com Google
      </button>
      ${message ? `<p class="muted" style="margin-top:12px">⚠️ ${esc(message)}</p>` : ''}
      <div class="feat">
        <div><span>🎯</span>Desafios de 21 dias, metas e ranking com amigos</div>
        <div><span>🏋️</span>Treino do dia com carga por série e timer de descanso</div>
        <div><span>🏃</span>Planilha de corrida com ritmos e evolução</div>
        <div><span>🌌</span>Energia, níveis e conquistas a cada dia marcado</div>
      </div>
    </div>`;
  $('#google-login').onclick = () => {
    try { oauthLogin('google'); } catch (e) { showLogin(e.message); }
  };
}

// Dados da versão antiga (só no celular) podem ser enviados para a conta
async function offerLocalImport() {
  const old = store.get('desafios-db-v1');
  if (!old || store.get(`imported-${myId()}`)) return;
  const has = (old.challenges || []).length || (old.workouts || []).length;
  if (!has) return;
  if (confirm('Encontramos desafios e treinos salvos neste celular (versão anterior). Quer enviar para a sua conta?')) {
    try {
      await api('import', { method: 'POST', body: { challenges: old.challenges || [], workouts: old.workouts || [] } });
      await reload(); toast('Dados importados!');
    } catch (e) { toast(`⚠️ ${e.message}`); return; }
  }
  store.set(`imported-${myId()}`, true);
}

async function start() {
  const params = new URLSearchParams(location.search);
  if (params.get('convite')) {
    store.set('pending-invite', params.get('convite').toUpperCase());
    history.replaceState(null, '', location.pathname);
  }

  if (!DEV_USER) {
    try { await handleAuthCallback(); } catch (e) { return showLogin(e.message); }
    const user = await getUser();
    if (!user) {
      try {
        const settings = await getSettings();
        if (!settings.providers?.google) return showLogin('O login com Google ainda não foi ativado no painel da Netlify.');
      } catch { /* segue para a tela de login */ }
      return showLogin();
    }
  }

  try { await reload(); } catch (e) { return showLogin(e.message); }

  if (params.get('assinatura')) {
    history.replaceState(null, '', location.pathname);
    await api('run/refresh', { method: 'POST', body: { today: todayStr() } }).catch(() => {});
    await loadRun(); tab = 'corrida'; render();
    toast(R?.access?.status === 'active' ? 'Assinatura confirmada! 🎉' : 'Recebemos seu pedido. A confirmação pode levar alguns minutos.', 3500);
  }

  const invite = store.get('pending-invite');
  if (invite) { store.del('pending-invite'); openJoin(invite); } else offerLocalImport();
}

initTooltips();
$view.innerHTML = '<div class="empty">Carregando…</div>';
start();

// Atualiza ao voltar para o app (amigos podem ter marcado o dia)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S) reload().catch(() => {}); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
