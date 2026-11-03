import { getUser, getSettings, handleAuthCallback, oauthLogin, logout, refreshSession } from '@netlify/identity';

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
  $('meta[name=theme-color]').setAttribute('content', dark ? '#0f172a' : '#f8fafc');
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
  S = await api('state');
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
  }
  store.set(key, earned.map((b) => b.id));
}

/* ================= Renderização ================= */

const $view = $('#view');
const TITLES = { hoje: 'Hoje', desafios: 'Desafios', treinos: 'Treinos', perfil: 'Perfil' };

function render() {
  if (!S) return;
  document.body.classList.remove('logged-out');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  $('#today').textContent = fmtDate(todayStr(), { weekday: 'long', day: '2-digit', month: 'long' });
  $view.innerHTML = { hoje: viewToday, desafios: viewChallenges, treinos: viewWorkouts, perfil: viewProfile }[tab]();
  checkNewBadges();
}

const avatar = (m, size = 26) => m.avatar
  ? `<img class="avatar" src="${esc(m.avatar)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer">`
  : `<span class="avatar" style="width:${size}px;height:${size}px">${esc((m.name || '?')[0].toUpperCase())}</span>`;

function progressLine(c, s, today) {
  const e = myChecks(c)[today];
  if (c.kind === 'quantity') return `Hoje: <b>${fmtNum(e?.value)}</b> / ${fmtNum(c.target)}${esc(unitLabel(c))} · dia ${s.dayNum} de ${c.days} · 🔥 ${s.streak}`;
  if (c.kind === 'weekly') return `Semana ${s.curWeek}/${s.weeks}: <b>${s.curCount}</b> de ${fmtNum(c.target)}x · 🔥 ${s.streak} semanas`;
  return `Dia ${s.dayNum} de ${c.days} · ${s.done} feitos · 🔥 ${s.streak} seguidos`;
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
    : `<button class="check ${on ? 'on' : ''}" data-action="toggle" data-id="${c.id}" data-day="${today}" aria-label="Marcar hoje">✓</button>`;
  return `
  <div class="card">
    <div class="row">
      <div class="emoji">${esc(c.emoji)}</div>
      <div class="grow">
        <div class="name">${esc(c.name)}</div>
        <div class="muted">${progressLine(c, s, today)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
      ${btn}
    </div>
    <div class="row between" style="margin-top:6px">
      ${groupToday(c, today) || '<span></span>'}
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
      <button class="check sm ${s.done ? 'on' : ''}" data-action="set-done" ${a} aria-label="Série feita">✓</button>
    </div>`;
}

function workoutCard(day, w) {
  const log = findLog(day, w.id) || newLog(day, w);
  const total = log.exercises.reduce((t, e) => t + e.sets.length, 0);
  const done = log.exercises.reduce((t, e) => t + e.sets.filter((s) => s.done).length, 0);
  return `
  <div class="card">
    <div class="row between">
      <div class="name">${esc(w.name)}</div>
      <span class="chip ${log.finished ? 'ok' : ''}">${log.finished ? '✓ Concluído' : `${done}/${total} séries`}</span>
    </div>
    ${log.exercises.map((e, ei) => {
      const allDone = e.sets.length && e.sets.every((s) => s.done);
      return `
      <div class="ex ${allDone ? 'done' : ''}">
        <div class="row between">
          <div class="ex-name">${allDone ? '✅ ' : ''}${esc(e.name)}</div>
          <div class="row" style="gap:4px">
            <button class="btn-small" data-action="chart" data-name="${esc(e.name)}" aria-label="Evolução">📈</button>
            <button class="btn-small" data-action="set-remove" data-w="${w.id}" data-e="${ei}" data-day="${day}" aria-label="Remover série">−</button>
            <button class="btn-small" data-action="set-add" data-w="${w.id}" data-e="${ei}" data-day="${day}" aria-label="Adicionar série">+</button>
          </div>
        </div>
        ${e.sets.map((s, si) => setRow(day, w, ei, si, s)).join('')}
      </div>`;
    }).join('')}
    <button class="btn-block ${log.finished ? '' : 'btn-primary'}" style="margin-top:12px" data-action="finish" data-w="${w.id}" data-day="${day}">
      ${log.finished ? 'Desmarcar treino' : 'Concluir treino'}
    </button>
  </div>`;
}

function viewToday() {
  const today = todayStr();
  const active = S.challenges.filter(isActive);
  const scheduled = workoutsForDay(today);
  const extra = S.workouts.filter((w) => !scheduled.includes(w) && findLog(today, w.id));
  const list = [...scheduled, ...extra];
  return `
    <h2>Desafios ativos</h2>
    ${active.length ? active.map((c) => challengeToday(c, today)).join('') : `<div class="card empty">Nenhum desafio ativo.<br><br><button class="btn-primary" data-action="new-challenge">+ Criar desafio</button> <button data-action="join">Entrar com código</button></div>`}
    <h2>Treino de hoje (${WEEKDAYS[parseDate(today).getDay()]})</h2>
    ${list.length ? list.map((w) => workoutCard(today, w)).join('') : `<div class="card empty">${S.workouts.length ? 'Dia de descanso 😴' : 'Cadastre seus treinos na aba Treinos.'}</div>`}
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
    cells.push(`<button class="${cls} ${d === today ? 'today' : ''}" data-action="checkin" data-id="${c.id}" data-day="${d}" ${d > today ? 'disabled' : ''} title="${fmtDate(d)}">${i + 1}${e?.note || e?.photo ? '<i class="dot"></i>' : ''}</button>`);
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
    <div class="bar"><i style="width:${s.pct}%"></i></div>
    <div class="stats">
      <div><b>${s.done}</b><span>${unit} feitos</span></div>
      <div><b>${s.left}</b><span>faltam</span></div>
      <div><b>🔥${s.streak}</b><span>seguidos</span></div>
      <div><b>${s.missed}</b><span>falhas</span></div>
    </div>
    <div class="cal">${cells.join('')}</div>
    ${ranking(c)}
    ${diary(c)}
    <button class="btn-block" style="margin-top:12px" data-action="invite" data-id="${c.id}">👥 Convidar amigos</button>
  </div>`;
}

function viewChallenges() {
  const today = todayStr();
  const order = { ativo: 0, futuro: 1, 'concluído': 2, encerrado: 3 };
  const sorted = [...S.challenges].sort((a, b) => order[challengeStats(a).status] - order[challengeStats(b).status]);
  return `
    <div class="row" style="margin-bottom:14px">
      <button class="btn-primary grow" data-action="new-challenge">+ Novo desafio</button>
      <button class="grow" data-action="join">🔑 Entrar com código</button>
    </div>
    ${sorted.length ? sorted.map((c) => challengeCard(c, today)).join('') : '<div class="empty">Crie um desafio ou entre no de um amigo com o código de convite.</div>'}
  `;
}

function viewWorkouts() {
  return `
    <button class="btn-primary btn-block" data-action="new-workout" style="margin-bottom:14px">+ Novo treino</button>
    ${S.workouts.length ? S.workouts.map((w) => `
      <div class="card">
        <div class="row between">
          <div class="name">${esc(w.name)}</div>
          <button class="btn-small" data-action="edit-workout" data-id="${w.id}">Editar</button>
        </div>
        <div class="chips" style="margin:8px 0">
          ${WEEKDAYS.map((d, i) => `<span class="chip ${w.weekdays.includes(i) ? 'on' : ''}">${d}</span>`).join('')}
        </div>
        ${w.exercises.map((e) => {
          const h = exerciseHistory(e.name);
          const last = h[h.length - 1];
          return `<div class="ex-line">
            <span class="grow">${esc(e.name)} <span class="muted">— ${e.sets}x${e.reps} · ${fmtNum(last ? last.max : e.weight)} kg</span></span>
            <button class="btn-small" data-action="chart" data-name="${esc(e.name)}" aria-label="Evolução de ${esc(e.name)}">📈</button>
          </div>`;
        }).join('') || '<div class="muted">Sem exercícios</div>'}
        <button class="btn-block" style="margin-top:10px" data-action="start-workout" data-id="${w.id}">▶️ Fazer hoje</button>
      </div>`).join('') : '<div class="empty">Cadastre seus treinos (A, B, C…) e os dias da semana de cada um.</div>'}
  `;
}

function viewProfile() {
  const me = S.me;
  const finished = S.logs.filter((l) => l.finished);
  const last30 = finished.filter((l) => diffDays(l.day, todayStr()) < 30).length;
  const won = S.challenges.filter((c) => challengeStats(c).status === 'concluído').length;
  const badges = computeBadges();
  const theme = store.get('theme', 'auto');
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${me.reminderHour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
  const logs = S.logs.filter((l) => l.finished || l.exercises.some((e) => e.sets.some((s) => s.done)));

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
      <div class="muted" style="margin-top:6px">Você só recebe o aviso se tiver desafio sem marcar no dia.</div>`;
  }

  return `
    <div class="card row">
      ${avatar(me, 48)}
      <div class="grow"><div class="name">${esc(me.name)}</div><div class="muted">${esc(me.email)}</div></div>
      <button class="btn-small" data-action="logout">Sair</button>
    </div>
    <div class="card">
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin:0">
        <div><b>${finished.length}</b><span>treinos feitos</span></div>
        <div><b>${last30}</b><span>últimos 30 dias</span></div>
        <div><b>${won}</b><span>desafios vencidos</span></div>
      </div>
    </div>

    <h2>Conquistas (${badges.filter((b) => b.ok).length}/${badges.length})</h2>
    <div class="badges">
      ${badges.map((b) => `<div class="badge ${b.ok ? 'ok' : ''}" title="${esc(b.desc)}"><span>${b.ok ? b.icon : '🔒'}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}
    </div>

    <h2>Lembrete diário</h2>
    <div class="card">${pushBlock}</div>

    <h2>Aparência</h2>
    <div class="card seg">
      ${[['auto', '🌗 Automático'], ['light', '☀️ Claro'], ['dark', '🌙 Escuro']].map(([v, l]) => `<button class="${theme === v ? 'on' : ''}" data-action="theme" data-v="${v}">${l}</button>`).join('')}
    </div>

    <h2>Histórico de treinos</h2>
    ${logs.length ? logs.slice(0, 60).map((l) => `
      <div class="card">
        <div class="row between">
          <div class="name">${esc(l.workoutName)}</div>
          <span class="chip ${l.finished ? 'ok' : ''}">${l.finished ? '✓' : 'parcial'}</span>
        </div>
        <div class="muted" style="margin-bottom:6px">${fmtDate(l.day, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
        ${l.exercises.map((e) => `<div class="muted">${e.sets.every((s) => s.done) ? '✅' : '⬜'} ${esc(e.name)} — ${e.sets.map((s) => `${s.reps}×${fmtNum(s.weight)}`).join(' · ')} kg</div>`).join('')}
      </div>`).join('') : '<div class="empty">Nenhum treino registrado ainda.</div>'}
  `;
}

/* ================= Gráfico de evolução ================= */

function chartSvg(points) {
  if (points.length < 2) return '<div class="empty">Faça este exercício pelo menos 2 vezes para ver o gráfico.</div>';
  const W = 320, H = 180, P = { l: 34, r: 10, t: 12, b: 26 };
  const ys = points.map((p) => p.max);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 5; max += 5; }
  const pad = (max - min) * 0.1; min = Math.max(0, min - pad); max += pad;
  const t0 = parseDate(points[0].day).getTime(), t1 = parseDate(points[points.length - 1].day).getTime();
  const x = (p) => P.l + ((parseDate(p.day).getTime() - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.max).toFixed(1)}`).join(' ');
  const ticks = [min, (min + max) / 2, max];
  return `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolução da carga">
      ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
      <path d="${path}" class="line"/>
      ${points.map((p) => `<circle cx="${x(p)}" cy="${y(p.max)}" r="3.5" class="pt"><title>${fmtDate(p.day)}: ${fmtNum(p.max)} kg</title></circle>`).join('')}
      <text x="${P.l}" y="${H - 6}">${fmtDate(points[0].day)}</text>
      <text x="${W - P.r}" y="${H - 6}" text-anchor="end">${fmtDate(points[points.length - 1].day)}</text>
    </svg>`;
}

function openChart(name) {
  const h = exerciseHistory(name);
  const first = h[0], last = h[h.length - 1], best = h.reduce((a, p) => (p.max > (a?.max ?? -1) ? p : a), null);
  openModal(`
    <h3>📈 ${esc(name)}</h3>
    ${h.length ? `<div class="stats" style="grid-template-columns:repeat(3,1fr);margin:0 0 12px">
      <div><b>${fmtNum(first.max)}</b><span>primeira (kg)</span></div>
      <div><b>${fmtNum(last.max)}</b><span>última (kg)</span></div>
      <div><b>${fmtNum(best.max)}</b><span>recorde (kg)</span></div>
    </div>` : ''}
    ${chartSvg(h)}
    ${h.length ? `<div class="hist">${h.slice().reverse().slice(0, 12).map((p) => `<div class="row between"><span>${fmtDate(p.day, { day: '2-digit', month: 'short', year: '2-digit' })}</span><span>${fmtNum(p.max)} kg <span class="muted">· vol ${fmtNum(p.vol)}</span></span></div>`).join('')}</div>` : ''}
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

/* ================= Eventos ================= */

document.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab; store.set('tab', tab);
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  render(); window.scrollTo(0, 0);
});

$view.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action]');
  if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
  const d = t.dataset;
  const c = d.id ? byId(S.challenges, d.id) : null;
  const w = d.w ? byId(S.workouts, d.w) : null;

  switch (d.action) {
    case 'toggle': {
      const e = myChecks(c)[d.day];
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
      if (log.finished) toast('Treino concluído! 💪');
      return save(saveLog(log, true));
    }
    case 'chart': return openChart(d.name);
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
  $('#title').textContent = 'Desafios & Treinos';
  $('#today').textContent = '';
  const invite = store.get('pending-invite');
  $view.innerHTML = `
    <div class="login">
      <div class="logo">🏆</div>
      <h2 style="text-transform:none;letter-spacing:0;color:var(--text);font-size:22px">Desafios & Treinos</h2>
      <p class="muted">Desafios com os amigos, treinos do dia e contagem de cada dia.</p>
      ${invite ? '<p class="chip on" style="display:inline-block">Você recebeu um convite! Entre para participar.</p>' : ''}
      <button class="btn-google" id="google-login">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Entrar com Google
      </button>
      ${message ? `<p class="muted">⚠️ ${esc(message)}</p>` : ''}
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

  const invite = store.get('pending-invite');
  if (invite) { store.del('pending-invite'); openJoin(invite); } else offerLocalImport();
}

$view.innerHTML = '<div class="empty">Carregando…</div>';
start();

// Atualiza ao voltar para o app (amigos podem ter marcado o dia)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S) reload().catch(() => {}); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
