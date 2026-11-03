'use strict';

/* ============ Base de dados (localStorage) ============ */

const DB_KEY = 'desafios-db-v1';
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function emptyDb() {
  return { challenges: [], workouts: [], logs: {} };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return Object.assign(emptyDb(), JSON.parse(raw));
  } catch (e) { /* dados inválidos: começa do zero */ }
  return seed();
}

function saveDb() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { toast('Não foi possível salvar'); }
}

// Exemplos para o primeiro uso
function seed() {
  const today = todayStr();
  return {
    challenges: [
      { id: uid(), name: '20 dias sem açúcar', emoji: '🍬', days: 20, start: today, linkWorkout: false, checks: {} },
      { id: uid(), name: '21 dias de academia', emoji: '💪', days: 21, start: today, linkWorkout: true, checks: {} },
    ],
    workouts: [
      { id: uid(), name: 'Treino A – Peito e tríceps', weekdays: [1, 4], exercises: [
        ex('Supino reto', 4, 10, 40), ex('Supino inclinado halter', 3, 12, 16),
        ex('Crucifixo', 3, 12, 12), ex('Tríceps corda', 3, 12, 25),
      ] },
      { id: uid(), name: 'Treino B – Costas e bíceps', weekdays: [2, 5], exercises: [
        ex('Puxada frente', 4, 10, 45), ex('Remada baixa', 3, 12, 40),
        ex('Rosca direta', 3, 12, 12), ex('Rosca martelo', 3, 12, 10),
      ] },
      { id: uid(), name: 'Treino C – Pernas', weekdays: [3, 6], exercises: [
        ex('Agachamento', 4, 10, 50), ex('Leg press', 4, 12, 120),
        ex('Cadeira extensora', 3, 12, 35), ex('Panturrilha', 4, 15, 40),
      ] },
    ],
    logs: {},
  };
}

function ex(name, sets, reps, weight) {
  return { id: uid(), name, sets, reps, weight };
}

let db = loadDb();
let tab = 'hoje';

/* ============ Datas ============ */

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayStr() { return dateStr(new Date()); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
function fmtDate(s, opts = { day: '2-digit', month: 'short' }) {
  return parseDate(s).toLocaleDateString('pt-BR', opts);
}

/* ============ Contagem dos desafios ============ */

function challengeStats(c, today = todayStr()) {
  const end = addDays(c.start, c.days - 1);
  const dayNum = diffDays(c.start, today) + 1;          // dia do desafio em que estamos
  let done = 0, missed = 0;
  for (let i = 0; i < c.days; i++) {
    const d = addDays(c.start, i);
    if (c.checks[d]) done++;
    else if (d < today) missed++;
  }
  // sequência atual: dias seguidos marcados até hoje (ou ontem, se hoje ainda não marcou)
  let streak = 0;
  let cursor = c.checks[today] ? today : addDays(today, -1);
  while (cursor >= c.start && c.checks[cursor]) { streak++; cursor = addDays(cursor, -1); }

  let status = 'ativo';
  if (today < c.start) status = 'futuro';
  else if (done >= c.days) status = 'concluído';
  else if (today > end) status = 'encerrado';

  return {
    end, done, missed, streak, status,
    dayNum: Math.max(0, Math.min(dayNum, c.days)),
    left: Math.max(0, c.days - done),
    pct: Math.min(100, Math.round((done / c.days) * 100)),
  };
}

function isActive(c) { const s = challengeStats(c).status; return s === 'ativo'; }

function toggleCheck(c, date) {
  if (c.checks[date]) delete c.checks[date];
  else c.checks[date] = true;
  saveDb();
}

/* ============ Treinos do dia ============ */

function logKey(date, workoutId) { return `${date}|${workoutId}`; }

function workoutsForDay(date) {
  const wd = parseDate(date).getDay();
  return db.workouts.filter((w) => w.weekdays.includes(wd));
}

// Cria (ou retorna) o registro do treino em um dia, copiando os exercícios do modelo
function getLog(date, w, create = true) {
  const key = logKey(date, w.id);
  if (!db.logs[key] && create) {
    db.logs[key] = {
      date, workoutId: w.id, workoutName: w.name, finished: false,
      exercises: w.exercises.map((e) => ({ exId: e.id, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, done: false })),
    };
  }
  return db.logs[key];
}

function finishWorkout(date, w) {
  const log = getLog(date, w);
  log.finished = !log.finished;
  // marca automaticamente os desafios ligados à academia
  db.challenges.filter((c) => c.linkWorkout).forEach((c) => {
    if (date < c.start || date > addDays(c.start, c.days - 1)) return;
    const anyFinished = Object.values(db.logs).some((l) => l.date === date && l.finished);
    if (anyFinished) c.checks[date] = true;
    else delete c.checks[date];
  });
  saveDb();
  if (log.finished) toast('Treino concluído! 💪');
}

/* ============ Renderização ============ */

const $view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('title').textContent = { hoje: 'Hoje', desafios: 'Desafios', treinos: 'Treinos', historico: 'Histórico' }[tab];
  document.getElementById('today').textContent = fmtDate(todayStr(), { weekday: 'long', day: '2-digit', month: 'long' });
  $view.innerHTML = { hoje: viewToday, desafios: viewChallenges, treinos: viewWorkouts, historico: viewHistory }[tab]();
}

function challengeMini(c, today) {
  const s = challengeStats(c, today);
  const on = !!c.checks[today];
  return `
  <div class="card">
    <div class="row">
      <div class="emoji">${esc(c.emoji)}</div>
      <div class="grow">
        <div class="name">${esc(c.name)}</div>
        <div class="muted">Dia ${s.dayNum} de ${c.days} · ${s.done} feitos · 🔥 ${s.streak} seguidos</div>
        <div class="bar"><i style="width:${s.pct}%"></i></div>
      </div>
      <button class="check ${on ? 'on' : ''}" data-action="check" data-id="${c.id}" data-date="${today}" aria-label="Marcar hoje">✓</button>
    </div>
  </div>`;
}

function workoutCard(date, w, editable = true) {
  const log = db.logs[logKey(date, w.id)];
  const items = log ? log.exercises : w.exercises.map((e) => ({ exId: e.id, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, done: false }));
  const doneCount = items.filter((e) => e.done).length;
  const finished = log && log.finished;
  return `
  <div class="card">
    <div class="row between">
      <div class="name">${esc(w.name)}</div>
      <span class="chip ${finished ? 'ok' : ''}">${finished ? '✓ Concluído' : `${doneCount}/${items.length}`}</span>
    </div>
    ${items.map((e, i) => `
      <div class="ex ${e.done ? 'done' : ''}">
        <button class="check ${e.done ? 'on' : ''}" data-action="ex-done" data-w="${w.id}" data-i="${i}" data-date="${date}" ${editable ? '' : 'disabled'}>✓</button>
        <div class="grow">
          <div class="ex-name">${esc(e.name)}</div>
          <div class="ex-fields">
            <label>Séries<input type="number" inputmode="numeric" min="0" value="${e.sets}" data-action="ex-field" data-field="sets" data-w="${w.id}" data-i="${i}" data-date="${date}"></label>
            <label>Reps<input type="number" inputmode="numeric" min="0" value="${e.reps}" data-action="ex-field" data-field="reps" data-w="${w.id}" data-i="${i}" data-date="${date}"></label>
            <label>Kg<input type="number" inputmode="decimal" min="0" step="0.5" value="${e.weight}" data-action="ex-field" data-field="weight" data-w="${w.id}" data-i="${i}" data-date="${date}"></label>
          </div>
        </div>
      </div>`).join('')}
    <button class="btn-block ${finished ? '' : 'btn-primary'}" style="margin-top:10px" data-action="finish" data-w="${w.id}" data-date="${date}">
      ${finished ? 'Desmarcar treino' : 'Concluir treino'}
    </button>
  </div>`;
}

function viewToday() {
  const today = todayStr();
  const active = db.challenges.filter(isActive);
  const scheduled = workoutsForDay(today);
  // treinos feitos hoje fora da agenda também aparecem
  const extra = db.workouts.filter((w) => !scheduled.includes(w) && db.logs[logKey(today, w.id)]);
  const list = [...scheduled, ...extra];

  return `
    <h2>Desafios ativos</h2>
    ${active.length ? active.map((c) => challengeMini(c, today)).join('') : `<div class="card empty">Nenhum desafio ativo.<br><br><button class="btn-primary" data-action="new-challenge">+ Criar desafio</button></div>`}

    <h2>Treino de hoje (${WEEKDAYS[parseDate(today).getDay()]})</h2>
    ${list.length ? list.map((w) => workoutCard(today, w)).join('') : `<div class="card empty">Dia de descanso 😴</div>`}
    ${db.workouts.length ? `<button class="btn-block" data-action="pick-workout" data-date="${today}">+ Fazer outro treino hoje</button>` : ''}
  `;
}

function viewChallenges() {
  const today = todayStr();
  if (!db.challenges.length) {
    return `<div class="empty">Você ainda não tem desafios.<br><br><button class="btn-primary" data-action="new-challenge">+ Criar desafio</button></div>`;
  }
  const order = { ativo: 0, futuro: 1, 'concluído': 2, encerrado: 3 };
  const sorted = [...db.challenges].sort((a, b) => order[challengeStats(a).status] - order[challengeStats(b).status]);
  return `
    <button class="btn-primary btn-block" data-action="new-challenge" style="margin-bottom:14px">+ Novo desafio</button>
    ${sorted.map((c) => {
      const s = challengeStats(c, today);
      const firstWd = parseDate(c.start).getDay();
      const cells = [];
      for (let i = 0; i < firstWd; i++) cells.push('<span></span>');
      for (let i = 0; i < c.days; i++) {
        const d = addDays(c.start, i);
        const cls = c.checks[d] ? 'done' : d < today ? 'miss' : d > today ? 'future' : '';
        cells.push(`<button class="${cls} ${d === today ? 'today' : ''}" data-action="check" data-id="${c.id}" data-date="${d}" ${d > today ? 'disabled' : ''} title="${fmtDate(d)}">${i + 1}</button>`);
      }
      const statusChip = { ativo: '', futuro: '<span class="chip">Começa em breve</span>', 'concluído': '<span class="chip ok">🏆 Concluído</span>', encerrado: '<span class="chip">Encerrado</span>' }[s.status];
      return `
      <div class="card">
        <div class="row">
          <div class="emoji">${esc(c.emoji)}</div>
          <div class="grow">
            <div class="name">${esc(c.name)}</div>
            <div class="muted">${fmtDate(c.start)} → ${fmtDate(s.end)}${c.linkWorkout ? ' · marca ao concluir treino' : ''}</div>
          </div>
          <button class="btn-small" data-action="edit-challenge" data-id="${c.id}">Editar</button>
        </div>
        ${statusChip ? `<div style="margin-top:8px">${statusChip}</div>` : ''}
        <div class="bar"><i style="width:${s.pct}%"></i></div>
        <div class="stats">
          <div><b>${s.done}</b><span>feitos</span></div>
          <div><b>${s.left}</b><span>faltam</span></div>
          <div><b>🔥${s.streak}</b><span>seguidos</span></div>
          <div><b>${s.missed}</b><span>falhas</span></div>
        </div>
        <div class="cal">${cells.join('')}</div>
      </div>`;
    }).join('')}
  `;
}

function viewWorkouts() {
  return `
    <button class="btn-primary btn-block" data-action="new-workout" style="margin-bottom:14px">+ Novo treino</button>
    ${db.workouts.length ? db.workouts.map((w) => `
      <div class="card">
        <div class="row between">
          <div class="name">${esc(w.name)}</div>
          <button class="btn-small" data-action="edit-workout" data-id="${w.id}">Editar</button>
        </div>
        <div class="chips" style="margin:8px 0">
          ${WEEKDAYS.map((d, i) => `<span class="chip ${w.weekdays.includes(i) ? 'on' : ''}">${d}</span>`).join('')}
        </div>
        ${w.exercises.map((e) => `<div class="muted">• ${esc(e.name)} — ${e.sets}x${e.reps} · ${e.weight} kg</div>`).join('') || '<div class="muted">Sem exercícios</div>'}
      </div>`).join('') : '<div class="empty">Cadastre seus treinos (A, B, C…) e os dias da semana de cada um.</div>'}
  `;
}

function viewHistory() {
  const logs = Object.values(db.logs).filter((l) => l.finished || l.exercises.some((e) => e.done))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = logs.filter((l) => l.finished).length;
  const last30 = logs.filter((l) => l.finished && diffDays(l.date, todayStr()) < 30).length;
  const done = db.challenges.filter((c) => challengeStats(c).status === 'concluído').length;
  return `
    <div class="card">
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin:0">
        <div><b>${total}</b><span>treinos feitos</span></div>
        <div><b>${last30}</b><span>últimos 30 dias</span></div>
        <div><b>${done}</b><span>desafios vencidos</span></div>
      </div>
    </div>
    <h2>Treinos registrados</h2>
    ${logs.length ? logs.map((l) => `
      <div class="card">
        <div class="row between">
          <div class="name">${esc(l.workoutName)}</div>
          <span class="chip ${l.finished ? 'ok' : ''}">${l.finished ? '✓' : 'parcial'}</span>
        </div>
        <div class="muted" style="margin-bottom:6px">${fmtDate(l.date, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
        ${l.exercises.map((e) => `<div class="muted">${e.done ? '✅' : '⬜'} ${esc(e.name)} — ${e.sets}x${e.reps} · ${e.weight} kg</div>`).join('')}
      </div>`).join('') : '<div class="empty">Nenhum treino registrado ainda.</div>'}

    <h2>Backup dos dados</h2>
    <div class="card">
      <div class="muted" style="margin-bottom:10px">Os dados ficam salvos neste aparelho. Exporte um arquivo para guardar ou passar para outro celular.</div>
      <div class="row">
        <button class="grow" data-action="export">⬇️ Exportar</button>
        <button class="grow" data-action="import">⬆️ Importar</button>
      </div>
      <button class="btn-danger btn-block" style="margin-top:10px" data-action="reset">Apagar tudo</button>
    </div>
  `;
}

/* ============ Formulários (modal) ============ */

const $modal = document.getElementById('modal');
const $form = document.getElementById('modal-form');

function openChallengeForm(c) {
  const isNew = !c;
  c = c || { name: '', emoji: '🎯', days: 21, start: todayStr(), linkWorkout: false };
  $form.innerHTML = `
    <h3>${isNew ? 'Novo desafio' : 'Editar desafio'}</h3>
    <label class="field">Nome<input name="name" required value="${esc(c.name)}" placeholder="Ex: 20 dias sem açúcar"></label>
    <div class="row">
      <label class="field" style="width:80px">Emoji<input name="emoji" value="${esc(c.emoji)}" maxlength="4"></label>
      <label class="field grow">Duração (dias)<input name="days" type="number" min="1" max="1000" required value="${c.days}"></label>
    </div>
    <label class="field">Começa em<input name="start" type="date" required value="${c.start}"></label>
    <label class="row" style="font-size:14px;margin-bottom:6px">
      <input type="checkbox" name="linkWorkout" ${c.linkWorkout ? 'checked' : ''}>
      Marcar o dia automaticamente quando eu concluir um treino
    </label>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn-danger" data-modal="delete">Excluir</button>'}
      <button value="cancel" formnovalidate>Cancelar</button>
      <button class="btn-primary" value="ok">Salvar</button>
    </div>`;
  $form.onsubmit = (ev) => {
    if (ev.submitter && ev.submitter.value !== 'ok') return;
    const f = new FormData($form);
    const data = {
      name: f.get('name').trim(), emoji: f.get('emoji').trim() || '🎯',
      days: Math.max(1, parseInt(f.get('days'), 10) || 1), start: f.get('start'),
      linkWorkout: f.get('linkWorkout') === 'on',
    };
    if (isNew) db.challenges.push({ id: uid(), checks: {}, ...data });
    else Object.assign(c, data);
    saveDb(); render();
  };
  $form.querySelector('[data-modal=delete]')?.addEventListener('click', () => {
    if (!confirm(`Excluir "${c.name}"?`)) return;
    db.challenges = db.challenges.filter((x) => x.id !== c.id);
    saveDb(); $modal.close(); render();
  });
  $modal.showModal();
}

function openWorkoutForm(w) {
  const isNew = !w;
  w = w || { name: '', weekdays: [], exercises: [] };
  const exRow = (e = {}) => `
    <div class="ex-edit" data-exid="${e.id || ''}">
      <input name="ex-name" placeholder="Exercício" value="${esc(e.name || '')}">
      <input name="ex-sets" type="number" inputmode="numeric" min="0" value="${e.sets ?? 3}">
      <input name="ex-reps" type="number" inputmode="numeric" min="0" value="${e.reps ?? 12}">
      <input name="ex-weight" type="number" inputmode="decimal" min="0" step="0.5" value="${e.weight ?? 0}">
      <button type="button" data-modal="rm-ex" aria-label="Remover">✕</button>
    </div>`;
  $form.innerHTML = `
    <h3>${isNew ? 'Novo treino' : 'Editar treino'}</h3>
    <label class="field">Nome<input name="name" required value="${esc(w.name)}" placeholder="Ex: Treino A – Peito"></label>
    <div class="field">Dias da semana
      <div class="chips">
        ${WEEKDAYS.map((d, i) => `<label class="chip ${w.weekdays.includes(i) ? 'on' : ''}"><input type="checkbox" name="wd" value="${i}" ${w.weekdays.includes(i) ? 'checked' : ''} hidden>${d}</label>`).join('')}
      </div>
    </div>
    <div class="field">Exercícios
      <div class="ex-edit ex-head"><span>Nome</span><span>Séries</span><span>Reps</span><span>Kg</span><span></span></div>
      <div id="ex-list">${w.exercises.map(exRow).join('')}</div>
      <button type="button" data-modal="add-ex">+ Exercício</button>
    </div>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn-danger" data-modal="delete">Excluir</button>'}
      <button value="cancel" formnovalidate>Cancelar</button>
      <button class="btn-primary" value="ok">Salvar</button>
    </div>`;
  const list = $form.querySelector('#ex-list');
  if (isNew) list.insertAdjacentHTML('beforeend', exRow());
  $form.onclick = (ev) => {
    const t = ev.target.closest('[data-modal]');
    if (ev.target.name === 'wd') ev.target.parentElement.classList.toggle('on', ev.target.checked);
    if (!t) return;
    if (t.dataset.modal === 'add-ex') { list.insertAdjacentHTML('beforeend', exRow()); list.lastElementChild.querySelector('input').focus(); }
    if (t.dataset.modal === 'rm-ex') t.parentElement.remove();
    if (t.dataset.modal === 'delete') {
      if (!confirm(`Excluir "${w.name}"? O histórico será mantido.`)) return;
      db.workouts = db.workouts.filter((x) => x.id !== w.id);
      saveDb(); $modal.close(); render();
    }
  };
  $form.onsubmit = (ev) => {
    if (ev.submitter && ev.submitter.value !== 'ok') return;
    const f = new FormData($form);
    const exercises = [...list.children].map((row) => ({
      id: row.dataset.exid || uid(),
      name: row.querySelector('[name=ex-name]').value.trim(),
      sets: Number(row.querySelector('[name=ex-sets]').value) || 0,
      reps: Number(row.querySelector('[name=ex-reps]').value) || 0,
      weight: Number(row.querySelector('[name=ex-weight]').value) || 0,
    })).filter((e) => e.name);
    const data = { name: f.get('name').trim(), weekdays: f.getAll('wd').map(Number), exercises };
    if (isNew) db.workouts.push({ id: uid(), ...data });
    else Object.assign(w, data);
    saveDb(); render();
  };
  $modal.showModal();
}

function openPickWorkout(date) {
  $form.innerHTML = `
    <h3>Qual treino você vai fazer?</h3>
    ${db.workouts.map((w) => `<button type="button" class="btn-block" style="margin-bottom:8px;text-align:left" data-modal="pick" data-id="${w.id}">${esc(w.name)}</button>`).join('')}
    <div class="actions"><button value="cancel">Cancelar</button></div>`;
  $form.onsubmit = null;
  $form.onclick = (ev) => {
    const t = ev.target.closest('[data-modal=pick]');
    if (!t) return;
    getLog(date, db.workouts.find((w) => w.id === t.dataset.id));
    saveDb(); $modal.close(); render();
  };
  $modal.showModal();
}

/* ============ Eventos ============ */

document.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});

$view.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action]');
  if (!t || t.tagName === 'INPUT') return;
  const { action, id, date } = t.dataset;
  const w = db.workouts.find((x) => x.id === t.dataset.w);

  switch (action) {
    case 'check': toggleCheck(db.challenges.find((c) => c.id === id), date); break;
    case 'ex-done': { const log = getLog(date, w); const e = log.exercises[t.dataset.i]; e.done = !e.done; saveDb(); break; }
    case 'finish': finishWorkout(date, w); break;
    case 'new-challenge': return openChallengeForm();
    case 'edit-challenge': return openChallengeForm(db.challenges.find((c) => c.id === id));
    case 'new-workout': return openWorkoutForm();
    case 'edit-workout': return openWorkoutForm(db.workouts.find((x) => x.id === id));
    case 'pick-workout': return openPickWorkout(date);
    case 'export': return exportData();
    case 'import': return importData();
    case 'reset':
      if (confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) { db = emptyDb(); saveDb(); }
      break;
    default: return;
  }
  render();
});

// Ajustar séries/reps/carga no treino do dia também atualiza o modelo (para a próxima vez)
$view.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.action !== 'ex-field') return;
  const w = db.workouts.find((x) => x.id === t.dataset.w);
  const log = getLog(t.dataset.date, w);
  const e = log.exercises[t.dataset.i];
  const val = Number(t.value) || 0;
  e[t.dataset.field] = val;
  const tpl = w.exercises.find((x) => x.id === e.exId);
  if (tpl) tpl[t.dataset.field] = val;
  saveDb();
});

/* ============ Backup ============ */

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `desafios-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!Array.isArray(data.challenges) || !Array.isArray(data.workouts)) throw new Error();
      if (!confirm('Substituir os dados atuais pelos do arquivo?')) return;
      db = Object.assign(emptyDb(), data); saveDb(); render(); toast('Dados importados');
    } catch (e) { alert('Arquivo inválido.'); }
  };
  input.click();
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

/* ============ Início ============ */

saveDb();
render();
// Atualiza se o app ficar aberto de um dia para o outro
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
