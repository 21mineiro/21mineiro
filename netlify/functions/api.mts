import type { Config, Context } from '@netlify/functions';
import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { sendPush } from '../lib/push.mts';
import { handleRun, handleMpWebhook, isCoach } from '../lib/run-routes.mts';

const db = getDatabase();
const sql = db.sql;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const err = (msg: string, status = 400) => json({ error: msg }, status);

const rid = () => crypto.randomUUID();
const inviteCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => chars[n % chars.length]).join('');
};
const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

type Me = { id: string; email: string; name: string; avatar: string | null };

async function ensureUser(u: { id: string; email?: string; name?: string; pictureUrl?: string }): Promise<Me> {
  const me = {
    id: u.id,
    email: u.email || '',
    name: u.name || (u.email || '').split('@')[0] || 'Usuário',
    avatar: u.pictureUrl || null,
  };
  await sql`
    INSERT INTO users (id, email, name, avatar) VALUES (${me.id}, ${me.email}, ${me.name}, ${me.avatar})
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar = COALESCE(EXCLUDED.avatar, users.avatar)`;
  return me;
}

async function isMember(challengeId: string, userId: string) {
  const rows = await sql`SELECT 1 FROM challenge_members WHERE challenge_id = ${challengeId} AND user_id = ${userId}`;
  return rows.length > 0;
}

/* ---------- Estado completo do usuário ---------- */

async function getState(me: Me) {
  const role = await roleOf(me.email);
  const [profile] = await sql`SELECT reminder_hour, timezone FROM users WHERE id = ${me.id}`;

  const challenges = await sql`
    SELECT c.*, to_char(c.start_date, 'YYYY-MM-DD') AS start, m.link_workout
    FROM challenges c JOIN challenge_members m ON m.challenge_id = c.id AND m.user_id = ${me.id}
    ORDER BY c.created_at`;
  const ids = challenges.map((c: any) => c.id);

  const members = ids.length ? await sql`
    SELECT m.challenge_id, u.id, u.name, u.avatar
    FROM challenge_members m JOIN users u ON u.id = m.user_id
    WHERE m.challenge_id = ANY(${ids}) ORDER BY m.joined_at` : [];

  const checkins = ids.length ? await sql`
    SELECT challenge_id, user_id, to_char(day, 'YYYY-MM-DD') AS day, value, note, photo_key
    FROM checkins WHERE challenge_id = ANY(${ids})` : [];

  const workouts = await sql`SELECT id, name, weekdays, exercises FROM workouts WHERE user_id = ${me.id} ORDER BY position, created_at`;
  const logs = await sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, workout_id, workout_name, finished, exercises, cardio
    FROM workout_logs WHERE user_id = ${me.id} ORDER BY day DESC`;

  return {
    me: { ...me, coach: role.coach, owner: role.owner, reminderHour: profile?.reminder_hour ?? null, timezone: profile?.timezone || null },
    challenges: challenges.map((c: any) => ({
      id: c.id, ownerId: c.owner_id, name: c.name, emoji: c.emoji, kind: c.kind,
      target: num(c.target), unit: c.unit, days: c.days, start: c.start,
      inviteCode: c.invite_code, linkWorkout: c.link_workout,
      members: members.filter((m: any) => m.challenge_id === c.id).map((m: any) => ({ id: m.id, name: m.name, avatar: m.avatar })),
      checkins: checkins.filter((k: any) => k.challenge_id === c.id).reduce((acc: any, k: any) => {
        (acc[k.user_id] ||= {})[k.day] = { value: Number(k.value), note: k.note || '', photo: k.photo_key || null };
        return acc;
      }, {}),
    })),
    workouts: workouts.map((w: any) => ({ id: w.id, name: w.name, weekdays: w.weekdays, exercises: w.exercises })),
    logs: logs.map(logOut),
  };
}

const logOut = (l: any) => ({ day: l.day, workoutId: l.workout_id, workoutName: l.workout_name, finished: l.finished, exercises: l.exercises, cardio: l.cardio || null });

// Cardio: feito ou não, minutos e tipo
function cardioIn(c: any) {
  if (!c || typeof c !== 'object') return null;
  const minutes = Math.min(600, Math.max(0, Math.round(Number(c.minutes) || 0)));
  if (!c.done && !minutes) return null;
  return { done: !!c.done, minutes, type: String(c.type || '').slice(0, 30) };
}

function workoutIn(body: any) {
  const weekdays = (Array.isArray(body.weekdays) ? body.weekdays : []).map(Number).filter((n: number) => n >= 0 && n <= 6);
  const exercises = (Array.isArray(body.exercises) ? body.exercises : []).slice(0, 40).map((e: any) => ({
    id: String(e.id || rid()), name: String(e.name || '').slice(0, 80),
    sets: Number(e.sets) || 0, reps: Number(e.reps) || 0, weight: Number(e.weight) || 0,
    ...(e.unit === 'seg' ? { unit: 'seg' } : {}),
  }));
  return { name: String(body.name || 'Treino').slice(0, 80), weekdays, exercises, position: Number(body.position) || 0 };
}

// Dono = e-mails em COACH_EMAILS (Netlify). Treinador = dono ou alguém que o dono adicionou.
async function roleOf(email: string) {
  const owner = isCoach(email);
  if (owner) return { owner: true, coach: true };
  const rows = await sql`SELECT 1 FROM coaches WHERE email = ${String(email || '').toLowerCase()}`;
  return { owner: false, coach: rows.length > 0 };
}

/* ---------- Desafios ---------- */

function challengeFields(b: any) {
  const kind = ['daily', 'quantity', 'weekly'].includes(b.kind) ? b.kind : 'daily';
  const days = Math.min(1000, Math.max(1, parseInt(b.days, 10) || 1));
  if (!b.name || !isDay(b.start)) throw new Error('Dados inválidos');
  return {
    name: String(b.name).slice(0, 80), emoji: String(b.emoji || '🎯').slice(0, 8), kind,
    target: kind === 'daily' ? null : Math.max(0.1, Number(b.target) || 1),
    unit: kind === 'quantity' ? String(b.unit || '').slice(0, 20) : null,
    days, start: b.start,
  };
}

// Marca/desmarca automaticamente os desafios ligados ao treino
async function syncWorkoutChallenges(userId: string, day: string) {
  const [{ any_finished }] = await sql`
    SELECT EXISTS (SELECT 1 FROM workout_logs WHERE user_id = ${userId} AND day = ${day} AND finished) AS any_finished`;
  const linked = await sql`
    SELECT c.id FROM challenges c JOIN challenge_members m ON m.challenge_id = c.id
    WHERE m.user_id = ${userId} AND m.link_workout AND c.kind <> 'quantity'
      AND ${day}::date BETWEEN c.start_date AND c.start_date + (c.days - 1)`;
  for (const c of linked) {
    if (any_finished) {
      await sql`INSERT INTO checkins (challenge_id, user_id, day, value) VALUES (${c.id}, ${userId}, ${day}, 1)
                ON CONFLICT (challenge_id, user_id, day) DO NOTHING`;
    } else {
      await sql`DELETE FROM checkins WHERE challenge_id = ${c.id} AND user_id = ${userId} AND day = ${day} AND photo_key IS NULL AND COALESCE(note, '') = ''`;
    }
  }
}

/* ---------- Roteador ---------- */

export default async (req: Request, context: Context) => {
  // Avisos do Mercado Pago chegam sem login
  if (new URL(req.url).pathname === '/api/mp/webhook' && req.method === 'POST') return handleMpWebhook(req);

  // Só no "netlify dev" (local), onde o login do Google não funciona: aceita um usuário de teste
  const devUser = Netlify.env.get('NETLIFY_DEV') === 'true' ? req.headers.get('x-dev-user') : null;
  const user = devUser ? JSON.parse(devUser) : await getUser();
  if (!user) return err('Faça login', 401);
  const me = await ensureUser(user as any);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [res, id] = parts;
  const method = req.method;
  const body: any = ['POST', 'PUT'].includes(method) && !req.headers.get('content-type')?.startsWith('image/')
    ? await req.json().catch(() => ({})) : {};

  try {
    // Estado
    if (res === 'state' && method === 'GET') return json(await getState(me));

    // Planilha de corrida (assinatura)
    if (res === 'run') return await handleRun(req, url, parts, me, body);

    // Preferências (lembrete)
    if (res === 'me' && method === 'PUT') {
      const hour = body.reminderHour === null ? null : Math.min(23, Math.max(0, parseInt(body.reminderHour, 10)));
      const tz = typeof body.timezone === 'string' ? body.timezone.slice(0, 60) : 'America/Sao_Paulo';
      await sql`UPDATE users SET reminder_hour = ${Number.isNaN(hour) ? null : hour}, timezone = ${tz} WHERE id = ${me.id}`;
      return json({ ok: true });
    }

    // Desafios
    if (res === 'challenges' && method === 'POST') {
      const f = challengeFields(body);
      const cid = rid();
      await sql`INSERT INTO challenges (id, owner_id, name, emoji, kind, target, unit, days, start_date, invite_code)
                VALUES (${cid}, ${me.id}, ${f.name}, ${f.emoji}, ${f.kind}, ${f.target}, ${f.unit}, ${f.days}, ${f.start}, ${inviteCode()})`;
      await sql`INSERT INTO challenge_members (challenge_id, user_id, link_workout) VALUES (${cid}, ${me.id}, ${!!body.linkWorkout})`;
      return json({ id: cid });
    }
    if (res === 'challenges' && id && method === 'PUT') {
      if (!(await isMember(id, me.id))) return err('Sem acesso', 403);
      await sql`UPDATE challenge_members SET link_workout = ${!!body.linkWorkout} WHERE challenge_id = ${id} AND user_id = ${me.id}`;
      const [c] = await sql`SELECT owner_id FROM challenges WHERE id = ${id}`;
      if (c.owner_id === me.id) {
        const f = challengeFields(body);
        await sql`UPDATE challenges SET name = ${f.name}, emoji = ${f.emoji}, kind = ${f.kind}, target = ${f.target},
                  unit = ${f.unit}, days = ${f.days}, start_date = ${f.start} WHERE id = ${id}`;
      }
      return json({ ok: true });
    }
    if (res === 'challenges' && id && method === 'DELETE') {
      const [c] = await sql`SELECT owner_id FROM challenges WHERE id = ${id}`;
      if (!c) return err('Não encontrado', 404);
      if (c.owner_id === me.id) {
        await sql`DELETE FROM challenges WHERE id = ${id}`; // apaga para todos
      } else {
        await sql`DELETE FROM checkins WHERE challenge_id = ${id} AND user_id = ${me.id}`;
        await sql`DELETE FROM challenge_members WHERE challenge_id = ${id} AND user_id = ${me.id}`;
      }
      return json({ ok: true });
    }

    // Convite: ver e entrar
    if (res === 'invite' && id && method === 'GET') {
      const [c] = await sql`
        SELECT c.id, c.name, c.emoji, c.days, to_char(c.start_date, 'YYYY-MM-DD') AS start, u.name AS owner,
               (SELECT COUNT(*) FROM challenge_members WHERE challenge_id = c.id) AS members
        FROM challenges c JOIN users u ON u.id = c.owner_id WHERE c.invite_code = ${id.toUpperCase()}`;
      if (!c) return err('Código não encontrado', 404);
      return json({ ...c, members: Number(c.members), joined: await isMember(c.id, me.id) });
    }
    if (res === 'join' && method === 'POST') {
      const [c] = await sql`SELECT id FROM challenges WHERE invite_code = ${String(body.code || '').toUpperCase().trim()}`;
      if (!c) return err('Código não encontrado', 404);
      await sql`INSERT INTO challenge_members (challenge_id, user_id) VALUES (${c.id}, ${me.id}) ON CONFLICT DO NOTHING`;
      return json({ id: c.id });
    }

    // Check-ins
    if (res === 'checkins' && method === 'PUT') {
      const { challengeId, day } = body;
      if (!isDay(day) || !(await isMember(challengeId, me.id))) return err('Sem acesso', 403);
      const value = Math.max(0, Number(body.value ?? 1) || 0);
      const note = body.note ? String(body.note).slice(0, 1000) : null;
      const photo = typeof body.photo === 'string' && body.photo.startsWith(`${challengeId}/${me.id}/`) ? body.photo : null;
      await sql`
        INSERT INTO checkins (challenge_id, user_id, day, value, note, photo_key, updated_at)
        VALUES (${challengeId}, ${me.id}, ${day}, ${value}, ${note}, ${photo}, NOW())
        ON CONFLICT (challenge_id, user_id, day) DO UPDATE
        SET value = EXCLUDED.value, note = EXCLUDED.note, photo_key = EXCLUDED.photo_key, updated_at = NOW()`;
      return json({ ok: true });
    }
    if (res === 'checkins' && method === 'DELETE') {
      const challengeId = url.searchParams.get('challengeId') || '';
      const day = url.searchParams.get('day');
      if (!isDay(day)) return err('Dia inválido');
      await sql`DELETE FROM checkins WHERE challenge_id = ${challengeId} AND user_id = ${me.id} AND day = ${day}`;
      return json({ ok: true });
    }

    // Fotos (Netlify Blobs). Só participantes do desafio podem ver.
    if (res === 'photos' && method === 'POST') {
      const challengeId = url.searchParams.get('challengeId') || '';
      const day = url.searchParams.get('day');
      if (!isDay(day) || !(await isMember(challengeId, me.id))) return err('Sem acesso', 403);
      const data = await req.arrayBuffer();
      if (data.byteLength > 4 * 1024 * 1024) return err('Foto muito grande');
      const key = `${challengeId}/${me.id}/${day}-${rid().slice(0, 8)}.jpg`;
      await getStore('photos').set(key, data, { metadata: { type: req.headers.get('content-type') || 'image/jpeg' } });
      return json({ key });
    }
    if (res === 'photos' && method === 'GET') {
      const key = url.searchParams.get('key') || '';
      const challengeId = key.split('/')[0];
      if (!(await isMember(challengeId, me.id))) return err('Sem acesso', 403);
      const blob = await getStore('photos').get(key, { type: 'arrayBuffer' });
      if (!blob) return err('Não encontrada', 404);
      return new Response(blob, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' } });
    }

    // Treinos
    if (res === 'workouts' && id && method === 'PUT') {
      const weekdays = (Array.isArray(body.weekdays) ? body.weekdays : []).map(Number).filter((n: number) => n >= 0 && n <= 6);
      const exercises = (Array.isArray(body.exercises) ? body.exercises : []).slice(0, 40).map((e: any) => ({
        id: String(e.id || rid()), name: String(e.name || '').slice(0, 80),
        sets: Number(e.sets) || 0, reps: Number(e.reps) || 0, weight: Number(e.weight) || 0,
        ...(e.unit === 'seg' ? { unit: 'seg' } : {}), // exercício por tempo (ex.: prancha)
      }));
      const [owner] = await sql`SELECT user_id FROM workouts WHERE id = ${id}`;
      if (owner && owner.user_id !== me.id) return err('Sem acesso', 403);
      await sql`
        INSERT INTO workouts (id, user_id, name, weekdays, exercises, position)
        VALUES (${id}, ${me.id}, ${String(body.name || 'Treino').slice(0, 80)}, ${JSON.stringify(weekdays)}::jsonb, ${JSON.stringify(exercises)}::jsonb, ${Number(body.position) || 0})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, weekdays = EXCLUDED.weekdays, exercises = EXCLUDED.exercises`;
      return json({ ok: true });
    }
    if (res === 'workouts' && id && method === 'DELETE') {
      await sql`DELETE FROM workouts WHERE id = ${id} AND user_id = ${me.id}`;
      return json({ ok: true });
    }

    // Registro do treino do dia
    if (res === 'logs' && method === 'PUT') {
      const { day, workoutId } = body;
      if (!isDay(day) || !workoutId) return err('Dados inválidos');
      await sql`
        INSERT INTO workout_logs (user_id, day, workout_id, workout_name, finished, exercises, cardio, updated_at)
        VALUES (${me.id}, ${day}, ${workoutId}, ${String(body.workoutName || '').slice(0, 80)}, ${!!body.finished}, ${JSON.stringify(body.exercises || [])}::jsonb, ${JSON.stringify(cardioIn(body.cardio))}::jsonb, NOW())
        ON CONFLICT (user_id, day, workout_id) DO UPDATE
        SET workout_name = EXCLUDED.workout_name, finished = EXCLUDED.finished, exercises = EXCLUDED.exercises, cardio = EXCLUDED.cardio, updated_at = NOW()`;
      if (body.syncChallenges) await syncWorkoutChallenges(me.id, day);
      return json({ ok: true });
    }
    if (res === 'logs' && method === 'DELETE') {
      const day = url.searchParams.get('day');
      if (!isDay(day)) return err('Dia inválido');
      await sql`DELETE FROM workout_logs WHERE user_id = ${me.id} AND day = ${day} AND workout_id = ${url.searchParams.get('workoutId') || ''}`;
      await syncWorkoutChallenges(me.id, day!);
      return json({ ok: true });
    }

    /* ----- Área do treinador ----- */
    if (res === 'coach') {
      const role = await roleOf(me.email);
      if (!role.coach) return err('Só para o treinador', 403);
      const [, sub, sid] = parts;
      const today = isDay(url.searchParams.get('today')) ? url.searchParams.get('today')! : new Date().toISOString().slice(0, 10);

      if (sub === 'users' && method === 'GET') {
        const rows = await sql`
          SELECT u.id, u.name, u.email, u.avatar,
            (SELECT COUNT(*) FROM workout_logs l WHERE l.user_id = u.id AND l.finished AND l.day > ${today}::date - 7) AS w7,
            (SELECT COUNT(*) FROM workout_logs l WHERE l.user_id = u.id AND l.finished AND l.day > ${today}::date - 30) AS w30,
            (SELECT COALESCE(SUM((l.cardio->>'minutes')::int), 0) FROM workout_logs l WHERE l.user_id = u.id AND l.cardio IS NOT NULL AND l.day > ${today}::date - 7) AS cardio7,
            (SELECT to_char(MAX(l.day), 'YYYY-MM-DD') FROM workout_logs l WHERE l.user_id = u.id AND l.finished) AS last_day,
            (SELECT l.workout_name FROM workout_logs l WHERE l.user_id = u.id AND l.finished ORDER BY l.day DESC LIMIT 1) AS last_name,
            (SELECT string_agg(DISTINCT split_part(w.id, '-', 1) || '-' || split_part(w.id, '-', 2), ',') FROM workouts w WHERE w.user_id = u.id) AS kinds,
            (SELECT COUNT(*) FROM workouts w WHERE w.user_id = u.id) AS nworkouts,
            EXISTS (SELECT 1 FROM coaches k WHERE k.email = lower(u.email)) AS is_coach
          FROM users u ORDER BY last_day DESC NULLS LAST, u.name`;
        return json(rows.map((r: any) => ({
          id: r.id, name: r.name, email: r.email, avatar: r.avatar, w7: Number(r.w7), w30: Number(r.w30), cardio7: Number(r.cardio7),
          lastDay: r.last_day, lastName: r.last_name, kinds: r.kinds || '', nworkouts: Number(r.nworkouts),
          coach: r.is_coach || isCoach(r.email || ''), owner: isCoach(r.email || ''),
        })));
      }
      if (sub === 'user' && sid && method === 'GET') {
        const [u] = await sql`SELECT id, name, email, avatar FROM users WHERE id = ${sid}`;
        if (!u) return err('Aluno não encontrado', 404);
        u.coach = (await roleOf(u.email)).coach; u.owner = isCoach(u.email || '');
        const workouts = await sql`SELECT id, name, weekdays, exercises FROM workouts WHERE user_id = ${sid} ORDER BY position, created_at`;
        const logs = await sql`
          SELECT to_char(day, 'YYYY-MM-DD') AS day, workout_id, workout_name, finished, exercises, cardio
          FROM workout_logs WHERE user_id = ${sid} AND day > ${today}::date - 90 ORDER BY day DESC`;
        return json({ user: u, workouts: workouts.map((w: any) => ({ id: w.id, name: w.name, weekdays: w.weekdays, exercises: w.exercises })), logs: logs.map(logOut) });
      }
      // Treinos montados pelo treinador para um aluno (id começa com "co-")
      if (sub === 'workouts' && sid && method === 'PUT') {
        if (!sid.startsWith('co-') || !body.athleteId) return err('Dados inválidos');
        const w = workoutIn(body);
        const [owner] = await sql`SELECT user_id FROM workouts WHERE id = ${sid}`;
        if (owner && owner.user_id !== body.athleteId) return err('Sem acesso', 403);
        await sql`
          INSERT INTO workouts (id, user_id, name, weekdays, exercises, position)
          VALUES (${sid}, ${body.athleteId}, ${w.name}, ${JSON.stringify(w.weekdays)}::jsonb, ${JSON.stringify(w.exercises)}::jsonb, ${w.position})
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, weekdays = EXCLUDED.weekdays, exercises = EXCLUDED.exercises, position = EXCLUDED.position`;
        return json({ ok: true });
      }
      // Só o dono: tornar alguém treinador ou tirar
      if (sub === 'role' && sid && method === 'PUT') {
        if (!role.owner) return err('Só o dono do app pode mudar treinadores', 403);
        const [u] = await sql`SELECT email FROM users WHERE id = ${sid}`;
        if (!u?.email) return err('Usuário não encontrado', 404);
        if (isCoach(u.email)) return err('Este é o dono do app');
        if (body.coach) await sql`INSERT INTO coaches (email, added_by) VALUES (${u.email.toLowerCase()}, ${me.email}) ON CONFLICT DO NOTHING`;
        else await sql`DELETE FROM coaches WHERE email = ${u.email.toLowerCase()}`;
        return json({ ok: true });
      }
      // Apagar treinos de um aluno (para trocar pelo treino do treinador)
      if (sub === 'workouts' && sid && method === 'DELETE') {
        await sql`DELETE FROM workouts WHERE id = ${sid}`;
        return json({ ok: true });
      }
      return err('Rota não encontrada', 404);
    }

    // Importar dados da versão antiga (salvos só no celular)
    if (res === 'import' && method === 'POST') {
      for (const c of body.challenges || []) {
        const f = challengeFields({ ...c, kind: 'daily' });
        const cid = rid();
        await sql`INSERT INTO challenges (id, owner_id, name, emoji, kind, target, unit, days, start_date, invite_code)
                  VALUES (${cid}, ${me.id}, ${f.name}, ${f.emoji}, 'daily', NULL, NULL, ${f.days}, ${f.start}, ${inviteCode()})`;
        await sql`INSERT INTO challenge_members (challenge_id, user_id, link_workout) VALUES (${cid}, ${me.id}, ${!!c.linkWorkout})`;
        for (const day of Object.keys(c.checks || {}).filter(isDay)) {
          await sql`INSERT INTO checkins (challenge_id, user_id, day, value) VALUES (${cid}, ${me.id}, ${day}, 1) ON CONFLICT DO NOTHING`;
        }
      }
      for (const [i, w] of (body.workouts || []).entries()) {
        await sql`INSERT INTO workouts (id, user_id, name, weekdays, exercises, position)
                  VALUES (${rid()}, ${me.id}, ${String(w.name).slice(0, 80)}, ${JSON.stringify(w.weekdays || [])}::jsonb, ${JSON.stringify(w.exercises || [])}::jsonb, ${i})`;
      }
      return json({ ok: true });
    }

    // Notificações
    if (res === 'push' && id === 'key' && method === 'GET') {
      return json({ key: Netlify.env.get('VAPID_PUBLIC_KEY') || null });
    }
    if (res === 'push' && id === 'subscribe' && method === 'POST') {
      const s = body.subscription;
      if (!s?.endpoint) return err('Inscrição inválida');
      await sql`INSERT INTO push_subscriptions (endpoint, user_id, subscription) VALUES (${s.endpoint}, ${me.id}, ${JSON.stringify(s)}::jsonb)
                ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription`;
      return json({ ok: true });
    }
    if (res === 'push' && id === 'test' && method === 'POST') {
      const subs = await sql`SELECT endpoint, subscription FROM push_subscriptions WHERE user_id = ${me.id}`;
      for (const s of subs) await sendPush(s, { title: 'Tudo certo! 🔔', body: 'Os lembretes estão funcionando.' });
      return json({ sent: subs.length });
    }

    return err('Rota não encontrada', 404);
  } catch (e: any) {
    console.error(e);
    return err(e?.message || 'Erro no servidor', 500);
  }
};

export const config: Config = { path: '/api/*' };
