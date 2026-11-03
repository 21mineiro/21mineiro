import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDatabase } from '@netlify/database';
import { generatePlan, paces, predictRace, type Goal, type Level } from './running-plan.mts';
import { generateAiPlan, markTo5k, type AiPlan } from './ai-plan.mts';

const sql = getDatabase().sql;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const err = (msg: string, status = 400) => json({ error: msg }, status);
const rid = () => crypto.randomUUID();
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const PLANS = {
  basico: { name: 'Básico', price: 20 },
  premium: { name: 'Premium', price: 50 },
} as const;
type PlanId = keyof typeof PLANS;
const TRIAL_DAYS = 7;

type Me = { id: string; email: string; name: string };

export const isCoach = (email: string) =>
  (Netlify.env.get('COACH_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());

/* ---------- Assinatura ---------- */

async function getSub(userId: string) {
  const [s] = await sql`SELECT * FROM subscriptions WHERE user_id = ${userId}`;
  return s || { plan: 'basico', status: 'none', trial_ends_at: null, trial_used: false, mp_preapproval_id: null };
}

function access(s: any) {
  const trialLeft = s.trial_ends_at ? Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000) : 0;
  const inTrial = s.status === 'trial' || (s.trial_ends_at && trialLeft > 0 && s.status === 'pending');
  const active = s.status === 'active' || (inTrial && trialLeft > 0);
  return {
    plan: s.plan as PlanId, status: s.status, active, trialUsed: !!s.trial_used,
    trialDaysLeft: inTrial ? Math.max(0, trialLeft) : 0, hasPayment: !!s.mp_preapproval_id && s.status === 'active',
  };
}

/* ---------- Planilha ---------- */

function rowToSession(r: any) {
  return {
    id: r.id, day: r.day, week: r.week, phase: r.phase, type: r.type, title: r.title, description: r.description,
    distanceKm: r.distance_km === null ? null : Number(r.distance_km), pace: r.pace, coachNote: r.coach_note,
    editedByCoach: r.edited_by_coach, done: r.done, actualKm: r.actual_km === null ? null : Number(r.actual_km),
    actualTime: r.actual_time, rpe: r.rpe, feedback: r.feedback,
  };
}

const sessionsOf = async (userId: string) => (await sql`
  SELECT *, to_char(day, 'YYYY-MM-DD') AS day FROM run_sessions WHERE user_id = ${userId} ORDER BY run_sessions.day`).map(rowToSession);

const GEN_TIMEOUT_MIN = 8; // geração por IA "travada" depois disso

function profileOut(p: any) {
  if (!p) return null;
  let status = p.plan_status || 'ready';
  if (status === 'generating' && p.plan_started_at && Date.now() - new Date(p.plan_started_at).getTime() > GEN_TIMEOUT_MIN * 60000) status = 'stale';
  return {
    goal: p.goal, level: p.level, weekdays: p.weekdays, longDay: p.long_day, time5k: p.time_5k,
    raceDate: p.race_date, startDate: p.start_date, weeks: p.weeks, notes: p.notes,
    daysPerWeek: p.days_per_week || (p.weekdays || []).length, mark: p.mark, target: p.target_time, volumeKm: p.volume_km,
    meta: p.plan_meta || null, status, source: p.plan_source, error: p.plan_error,
    paces: paces(p.time_5k, p.level), prediction: predictRace(p.time_5k, p.level, p.goal),
  };
}
const profileRow = async (userId: string) => (await sql`
  SELECT *, to_char(race_date, 'YYYY-MM-DD') AS race_date, to_char(start_date, 'YYYY-MM-DD') AS start_date
  FROM run_profiles WHERE user_id = ${userId}`)[0];
const profileOf = async (userId: string) => profileOut(await profileRow(userId));

const addDaysStr = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const jsDay = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay(); // 0 = domingo
const mondayOf = (s: string) => addDaysStr(s, -((jsDay(s) + 6) % 7));
const toMon0 = (js: number) => (js + 6) % 7;  // 0 = segunda
const fromMon0 = (m: number) => (m + 1) % 7;

// Dias de corrida padrão para o gerador de reserva (0 = domingo), a partir do nº de dias e do longão
function defaultWeekdays(n: number, longDay: number) {
  const base: Record<number, number[]> = { 3: [2, 4], 4: [2, 4, 6], 5: [1, 2, 4, 5], 6: [1, 2, 3, 4, 5] };
  const set = new Set((base[n] || base[4]).map((d) => (d === longDay ? (d + 6) % 7 : d)));
  set.delete(longDay);
  return [...set, longDay];
}

// Salva a ficha do corredor (formato da planilha do treinador)
async function saveProfile(userId: string, b: any, today: string) {
  const goal: Goal = ['5k', '10k', '21k', '42k'].includes(b.goal) ? b.goal : '10k';
  const level: Level = ['iniciante', 'intermediario', 'avancado'].includes(b.level) ? b.level : 'intermediario';
  const daysPerWeek = Math.min(6, Math.max(3, parseInt(b.daysPerWeek, 10) || 4));
  const longDay = [0, 1, 2, 3, 4, 5, 6].includes(Number(b.longDay)) ? Number(b.longDay) : 0;
  const mark = b.mark ? String(b.mark).slice(0, 120) : null;
  const target = b.target ? String(b.target).slice(0, 120) : null;
  const volumeKm = b.volumeKm === '' || b.volumeKm == null ? null : Math.min(300, Math.max(0, Math.round(Number(b.volumeKm)) || 0));
  const notes = b.notes ? String(b.notes).slice(0, 1000) : null;
  const start = mondayOf(today);
  const raceDate = isDay(b.raceDate) && b.raceDate > today ? b.raceDate : null;
  const weeks = raceDate
    ? Math.min(20, Math.max(1, Math.floor((new Date(`${raceDate}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / (7 * 86400000)) + 1))
    : Math.min(20, Math.max(4, parseInt(b.weeks, 10) || 8));
  const time5k = markTo5k(mark);
  const weekdays = defaultWeekdays(daysPerWeek, longDay);
  await sql`
    INSERT INTO run_profiles (user_id, goal, level, weekdays, long_day, time_5k, race_date, start_date, weeks, notes,
      days_per_week, mark, target_time, volume_km, updated_at)
    VALUES (${userId}, ${goal}, ${level}, ${JSON.stringify(weekdays)}::jsonb, ${longDay}, ${time5k}, ${raceDate}, ${start}, ${weeks}, ${notes},
      ${daysPerWeek}, ${mark}, ${target}, ${volumeKm}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET goal = EXCLUDED.goal, level = EXCLUDED.level, weekdays = EXCLUDED.weekdays,
      long_day = EXCLUDED.long_day, time_5k = EXCLUDED.time_5k, race_date = EXCLUDED.race_date, start_date = EXCLUDED.start_date,
      weeks = EXCLUDED.weeks, notes = EXCLUDED.notes, days_per_week = EXCLUDED.days_per_week, mark = EXCLUDED.mark,
      target_time = EXCLUDED.target_time, volume_km = EXCLUDED.volume_km, updated_at = NOW()`;
}

async function replaceSessions(userId: string, today: string, sessions: { day: string; week: number; phase: string; type: string; title: string; description: string; distanceKm: number | null; pace: string | null }[]) {
  await sql`DELETE FROM run_sessions WHERE user_id = ${userId} AND (day >= ${today} OR NOT done)`;
  for (const s of sessions) {
    if (s.day < today) continue;
    await sql`INSERT INTO run_sessions (id, user_id, day, week, phase, type, title, description, distance_km, pace)
              VALUES (${rid()}, ${userId}, ${s.day}, ${s.week}, ${s.phase}, ${s.type}, ${s.title}, ${s.description}, ${s.distanceKm}, ${s.pace})`;
  }
}

const AI_TYPE: Record<string, string> = { tempo: 'ritmo' };
const TITLE: Record<string, string> = { leve: 'Leve', ritmo: 'Tempo', intervalado: 'Intervalado', longo: 'Longão', regenerativo: 'Regenerativo', prova: '🏁 Prova' };
const kmStr = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

// Converte a planilha da IA (semana × dia, segunda a domingo) em treinos com data
function aiToSessions(plan: AiPlan, start: string) {
  const out: any[] = [];
  plan.semanas.forEach((w, wi) => {
    (w.dias || []).slice(0, 7).forEach((d, di) => {
      const type = AI_TYPE[d.tipo] || d.tipo;
      if (type === 'descanso' || !TITLE[type]) return;
      const km = Number(d.km) || null;
      const pace = d.ritmo ? (/km/.test(d.ritmo) ? d.ritmo : `${d.ritmo}/km`) : null;
      out.push({
        day: addDaysStr(start, (Number(w.numero) - 1 || wi) * 7 + di), week: Number(w.numero) || wi + 1, phase: w.foco || '',
        type, title: `${TITLE[type]}${km ? ` ${kmStr(km)} km` : ''}`, description: d.descricao || '', distanceKm: km, pace,
      });
    });
  });
  return out;
}

async function rulesPlan(userId: string, today: string, error: string | null = null) {
  const p = await profileRow(userId);
  const { weeks, sessions, meta } = generatePlan({
    goal: p.goal, level: p.level, daysPerWeek: p.days_per_week || 4, longDay: p.long_day, time5k: p.time_5k,
    volumeKm: p.volume_km, weeks: p.weeks, startDate: p.start_date, raceDate: p.race_date, target: p.target_time,
  });
  await replaceSessions(userId, today, sessions);
  await sql`UPDATE run_profiles SET plan_status = 'ready', plan_source = 'regras', weeks = ${weeks},
            plan_meta = ${JSON.stringify(meta)}::jsonb, plan_error = ${error} WHERE user_id = ${userId}`;
}

// Chamada pela função de segundo plano: gera com IA e, se falhar, usa o gerador de reserva
export async function runAiGeneration(userId: string, today: string) {
  const p = await profileRow(userId);
  if (!p || p.plan_status !== 'generating') return;
  const raceDay = p.race_date ? toMon0(jsDay(p.race_date)) : toMon0(p.long_day);
  try {
    const plan = await generateAiPlan({
      goal: p.goal, level: p.level, weeks: p.weeks, daysPerWeek: p.days_per_week || 4, longDay: toMon0(p.long_day), raceDay,
      raceDate: p.race_date, mark: p.mark, target: p.target_time, volumeKm: p.volume_km, notes: p.notes,
    });
    let sessions = aiToSessions(plan, p.start_date);
    if (p.race_date) sessions = sessions.filter((s) => s.day <= p.race_date);
    await replaceSessions(userId, today, sessions);
    const meta = { titulo: plan.titulo, resumo: plan.resumo, zonas: plan.zonas, dicas: plan.dicas };
    await sql`UPDATE run_profiles SET plan_status = 'ready', plan_source = 'ia', plan_error = NULL, weeks = ${plan.semanas.length}, plan_meta = ${JSON.stringify(meta)}::jsonb WHERE user_id = ${userId}`;
  } catch (e: any) {
    console.error('IA', e);
    await rulesPlan(userId, today, `A IA não respondeu (${String(e?.message || e).slice(0, 120)}). Usamos o gerador padrão.`);
  }
}

// Salva a ficha e decide como gerar: IA em segundo plano (se configurada) ou gerador de reserva na hora
async function startPlan(userId: string, b: any, today: string) {
  await saveProfile(userId, b, today);
  if (Netlify.env.get('ANTHROPIC_API_KEY') && b.mode !== 'regras') {
    await sql`UPDATE run_profiles SET plan_status = 'generating', plan_started_at = NOW(), plan_error = NULL WHERE user_id = ${userId}`;
    return { mode: 'ia' };
  }
  await rulesPlan(userId, today);
  return { mode: 'regras' };
}

const messagesOf = async (athleteId: string) => (await sql`
  SELECT m.id, m.author_id, u.name AS author, m.body, m.created_at FROM run_messages m JOIN users u ON u.id = m.author_id
  WHERE m.athlete_id = ${athleteId} ORDER BY m.created_at`).map((m: any) => ({
  id: m.id, authorId: m.author_id, author: m.author, body: m.body, at: m.created_at,
}));

/* ---------- Mercado Pago ---------- */

async function mp(path: string, init: RequestInit = {}) {
  const token = Netlify.env.get('MP_ACCESS_TOKEN');
  if (!token) throw new Error('Pagamento ainda não configurado. Fale com o treinador.');
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('mercadopago', res.status, data); throw new Error(data.message || 'Erro no Mercado Pago'); }
  return data;
}

const MP_STATUS: Record<string, string> = { authorized: 'active', paused: 'paused', cancelled: 'cancelled', pending: 'pending' };

async function syncPreapproval(id: string) {
  const pre = await mp(`/preapproval/${encodeURIComponent(id)}`);
  const [userId, plan] = String(pre.external_reference || '').split('|');
  if (!userId || !(plan in PLANS)) return;
  const status = MP_STATUS[pre.status] || 'pending';
  const current = await getSub(userId);
  // Assinatura nova ainda pendente não tira o teste grátis
  if (status === 'pending' && current.status === 'trial') {
    await sql`UPDATE subscriptions SET mp_preapproval_id = ${id}, plan = ${plan}, updated_at = NOW() WHERE user_id = ${userId}`;
    return;
  }
  // Ignora avisos de uma assinatura antiga quando já existe outra
  if (current.mp_preapproval_id && current.mp_preapproval_id !== id && status !== 'active') return;
  await sql`
    INSERT INTO subscriptions (user_id, plan, status, mp_preapproval_id, updated_at) VALUES (${userId}, ${plan}, ${status}, ${id}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, mp_preapproval_id = EXCLUDED.mp_preapproval_id, updated_at = NOW()`;
}

function validSignature(req: Request, dataId: string) {
  const secret = Netlify.env.get('MP_WEBHOOK_SECRET');
  if (!secret) return true;
  const sig = req.headers.get('x-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${req.headers.get('x-request-id') || ''};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

// Avisos do Mercado Pago (sem login). Sempre confirma o status consultando a API.
export async function handleMpWebhook(req: Request) {
  const url = new URL(req.url);
  const body: any = await req.json().catch(() => ({}));
  const type = body.type || url.searchParams.get('type') || url.searchParams.get('topic');
  const dataId = String(body.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
  if (!dataId) return json({ ok: true });
  if (!validSignature(req, dataId)) return err('Assinatura inválida', 401);
  try {
    if (type === 'subscription_preapproval' || type === 'preapproval') await syncPreapproval(dataId);
    if (type === 'subscription_authorized_payment') {
      const pay = await mp(`/authorized_payments/${encodeURIComponent(dataId)}`);
      if (pay.preapproval_id) await syncPreapproval(pay.preapproval_id);
    }
  } catch (e) { console.error('webhook', e); return err('Erro', 500); }
  return json({ ok: true });
}

/* ---------- Rotas /api/run/* ---------- */

export async function handleRun(req: Request, url: URL, parts: string[], me: Me, body: any): Promise<Response> {
  const method = req.method;
  const [, a, b] = parts; // parts[0] === 'run'
  const today = isDay(body?.today) ? body.today : isDay(url.searchParams.get('today')) ? url.searchParams.get('today')! : new Date().toISOString().slice(0, 10);
  const coach = isCoach(me.email);
  const sub = await getSub(me.id);
  // Cobrança desligada (fase de testes): todos têm acesso completo. Para ligar, crie PAYMENTS_ENABLED=true na Netlify.
  const paymentsOn = Netlify.env.get('PAYMENTS_ENABLED') === 'true';
  const acc = !paymentsOn
    ? { plan: 'premium' as PlanId, status: 'active', active: true, trialUsed: true, trialDaysLeft: 0, hasPayment: false, free: true }
    : coach ? { ...access(sub), active: true, plan: 'premium' as PlanId } : access(sub);

  if (a === 'state' && method === 'GET') {
    const premium = acc.active && acc.plan === 'premium';
    if (premium) await sql`UPDATE run_messages SET read_at = NOW() WHERE athlete_id = ${me.id} AND author_id <> ${me.id} AND read_at IS NULL`;
    return json({
      coach, plans: PLANS, trialDays: TRIAL_DAYS, access: acc,
      profile: await profileOf(me.id),
      sessions: acc.active ? await sessionsOf(me.id) : [],
      messages: premium ? await messagesOf(me.id) : [],
      paymentsReady: !!Netlify.env.get('MP_ACCESS_TOKEN'),
    });
  }

  // Teste grátis
  if (a === 'trial' && method === 'POST') {
    const plan: PlanId = body.plan in PLANS ? body.plan : 'basico';
    if (sub.trial_used) return err('O teste grátis já foi usado nesta conta');
    await sql`
      INSERT INTO subscriptions (user_id, plan, status, trial_ends_at, trial_used, updated_at)
      VALUES (${me.id}, ${plan}, 'trial', NOW() + ${`${TRIAL_DAYS} days`}::interval, TRUE, NOW())
      ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = 'trial', trial_ends_at = EXCLUDED.trial_ends_at, trial_used = TRUE, updated_at = NOW()`;
    return json({ ok: true });
  }

  // Assinar pelo Mercado Pago
  if (a === 'subscribe' && method === 'POST') {
    const plan: PlanId = body.plan in PLANS ? body.plan : 'basico';
    if (sub.mp_preapproval_id && sub.status === 'active') {
      await mp(`/preapproval/${sub.mp_preapproval_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => {});
    }
    // Durante o teste, a primeira cobrança só acontece quando o teste acaba
    const trialEnd = sub.status === 'trial' && sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date() ? new Date(sub.trial_ends_at) : null;
    const pre = await mp('/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: `Planilha de corrida – ${PLANS[plan].name}`,
        external_reference: `${me.id}|${plan}`,
        payer_email: me.email,
        back_url: `${url.origin}/?assinatura=ok`,
        status: 'pending',
        auto_recurring: {
          frequency: 1, frequency_type: 'months', transaction_amount: PLANS[plan].price, currency_id: 'BRL',
          ...(trialEnd ? { start_date: trialEnd.toISOString() } : {}),
        },
      }),
    });
    await sql`INSERT INTO subscriptions (user_id, plan, status) VALUES (${me.id}, ${plan}, 'pending') ON CONFLICT (user_id) DO NOTHING`;
    return json({ url: pre.init_point });
  }
  if (a === 'cancel' && method === 'POST') {
    if (sub.mp_preapproval_id) await mp(`/preapproval/${sub.mp_preapproval_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    await sql`UPDATE subscriptions SET status = 'cancelled', trial_ends_at = LEAST(trial_ends_at, NOW()), updated_at = NOW() WHERE user_id = ${me.id}`;
    return json({ ok: true });
  }
  // Ao voltar do Mercado Pago, confere o status na hora
  if (a === 'refresh' && method === 'POST') {
    if (sub.mp_preapproval_id) await syncPreapproval(sub.mp_preapproval_id).catch(() => {});
    return json({ ok: true });
  }

  /* ----- Painel do treinador ----- */
  if (a === 'coach') {
    if (!coach) return err('Só para o treinador', 403);
    const [, , c, id] = parts;

    if (c === 'athletes' && method === 'GET') {
      const rows = await sql`
        SELECT u.id, u.name, u.email, u.avatar, s.plan, s.status, s.trial_ends_at, p.goal, to_char(p.race_date, 'YYYY-MM-DD') AS race_date,
          (SELECT COUNT(*) FROM run_sessions r WHERE r.user_id = u.id AND r.day >= ${today}::date - 28
             AND (r.day < ${today}::date OR (r.day = ${today}::date AND r.done))) AS past,
          (SELECT COUNT(*) FROM run_sessions r WHERE r.user_id = u.id AND r.done AND r.day <= ${today}::date AND r.day >= ${today}::date - 28) AS done,
          (SELECT COUNT(*) FROM run_messages m WHERE m.athlete_id = u.id AND m.author_id = u.id AND m.read_at IS NULL) AS unread,
          (SELECT MAX(updated_at) FROM run_sessions r WHERE r.user_id = u.id AND r.done) AS last_run
        FROM users u
        LEFT JOIN subscriptions s ON s.user_id = u.id
        LEFT JOIN run_profiles p ON p.user_id = u.id
        WHERE (s.status IS NOT NULL AND s.status <> 'none') OR p.user_id IS NOT NULL
        ORDER BY unread DESC, u.name`;
      return json(rows.map((r: any) => ({
        id: r.id, name: r.name, email: r.email, avatar: r.avatar, goal: r.goal, raceDate: r.race_date,
        access: access({ plan: r.plan || 'basico', status: r.status || 'none', trial_ends_at: r.trial_ends_at }),
        past: Number(r.past), done: Number(r.done), unread: Number(r.unread), lastRun: r.last_run,
      })));
    }
    if (c === 'athlete' && id && method === 'GET') {
      await sql`UPDATE run_messages SET read_at = NOW() WHERE athlete_id = ${id} AND author_id = ${id} AND read_at IS NULL`;
      const [u] = await sql`SELECT id, name, email, avatar FROM users WHERE id = ${id}`;
      if (!u) return err('Aluno não encontrado', 404);
      return json({ user: u, access: access(await getSub(id)), profile: await profileOf(id), sessions: await sessionsOf(id), messages: await messagesOf(id) });
    }
    if (c === 'regenerate' && id && method === 'POST') return json(await startPlan(id, body, today));
    if (c === 'fallback' && id && method === 'POST') { await rulesPlan(id, today); return json({ ok: true }); }
    if (c === 'sessions' && method === 'POST') {
      if (!isDay(body.day) || !body.athleteId) return err('Dados inválidos');
      await sql`INSERT INTO run_sessions (id, user_id, day, week, phase, type, title, description, distance_km, pace, coach_note, edited_by_coach)
                VALUES (${rid()}, ${body.athleteId}, ${body.day}, ${Number(body.week) || 0}, ${body.phase || null}, ${body.type || 'leve'},
                        ${String(body.title || 'Treino').slice(0, 100)}, ${body.description || null}, ${Number(body.distanceKm) || null},
                        ${body.pace || null}, ${body.coachNote || null}, TRUE)`;
      return json({ ok: true });
    }
    if (c === 'sessions' && id && method === 'PUT') {
      if (!isDay(body.day)) return err('Dia inválido');
      await sql`UPDATE run_sessions SET day = ${body.day}, type = ${body.type || 'leve'}, title = ${String(body.title || '').slice(0, 100)},
                description = ${body.description || null}, distance_km = ${Number(body.distanceKm) || null}, pace = ${body.pace || null},
                coach_note = ${body.coachNote || null}, edited_by_coach = TRUE, updated_at = NOW() WHERE id = ${id}`;
      return json({ ok: true });
    }
    if (c === 'sessions' && id && method === 'DELETE') {
      await sql`DELETE FROM run_sessions WHERE id = ${id}`;
      return json({ ok: true });
    }
    // Liberar acesso manualmente (ex.: pagamento por fora)
    if (c === 'access' && id && method === 'PUT') {
      const plan: PlanId = body.plan in PLANS ? body.plan : 'basico';
      const status = ['active', 'cancelled'].includes(body.status) ? body.status : 'active';
      await sql`INSERT INTO subscriptions (user_id, plan, status) VALUES (${id}, ${plan}, ${status})
                ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, updated_at = NOW()`;
      return json({ ok: true });
    }
    if (c === 'messages' && id && method === 'POST') {
      const text = String(body.body || '').trim().slice(0, 2000);
      if (!text) return err('Mensagem vazia');
      await sql`INSERT INTO run_messages (id, athlete_id, author_id, body) VALUES (${rid()}, ${id}, ${me.id}, ${text})`;
      return json({ ok: true });
    }
    return err('Rota não encontrada', 404);
  }

  /* ----- Aluno (precisa de acesso) ----- */
  if (!acc.active) return err('Assine um plano para usar a planilha de corrida', 402);

  if (a === 'profile' && method === 'POST') return json(await startPlan(me.id, body, today));
  if (a === 'fallback' && method === 'POST') { await rulesPlan(me.id, today); return json({ ok: true }); }
  if (a === 'sessions' && b && method === 'PUT') {
    await sql`UPDATE run_sessions SET done = ${!!body.done}, actual_km = ${body.actualKm === '' || body.actualKm == null ? null : Number(body.actualKm)},
              actual_time = ${body.actualTime ? String(body.actualTime).slice(0, 12) : null},
              rpe = ${body.rpe ? Math.min(10, Math.max(1, parseInt(body.rpe, 10))) : null},
              feedback = ${body.feedback ? String(body.feedback).slice(0, 1000) : null}, updated_at = NOW()
              WHERE id = ${b} AND user_id = ${me.id}`;
    return json({ ok: true });
  }
  if (a === 'messages' && method === 'POST') {
    if (acc.plan !== 'premium') return err('O chat com o treinador é do plano Premium', 402);
    const text = String(body.body || '').trim().slice(0, 2000);
    if (!text) return err('Mensagem vazia');
    await sql`INSERT INTO run_messages (id, athlete_id, author_id, body) VALUES (${rid()}, ${me.id}, ${me.id}, ${text})`;
    return json({ ok: true });
  }
  return err('Rota não encontrada', 404);
}
