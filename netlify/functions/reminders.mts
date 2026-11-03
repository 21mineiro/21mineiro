import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { sendPush } from '../lib/push.mts';

// Roda a cada hora (UTC). Para cada pessoa cuja hora local do lembrete é agora,
// avisa se ainda há desafio sem marcar hoje.
export default async () => {
  const sql = getDatabase().sql;
  const users = await sql`
    SELECT DISTINCT u.id, u.reminder_hour, u.timezone FROM users u
    JOIN push_subscriptions p ON p.user_id = u.id
    WHERE u.reminder_hour IS NOT NULL`;

  const now = new Date();
  for (const u of users) {
    const tz = u.timezone || 'America/Sao_Paulo';
    let hour: number, today: string;
    try {
      hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
      today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
    } catch { continue; }
    if (hour !== u.reminder_hour) continue;

    const pending = await sql`
      SELECT c.name, c.emoji FROM challenges c
      JOIN challenge_members m ON m.challenge_id = c.id AND m.user_id = ${u.id}
      WHERE ${today}::date BETWEEN c.start_date AND c.start_date + (c.days - 1)
        AND NOT EXISTS (SELECT 1 FROM checkins k WHERE k.challenge_id = c.id AND k.user_id = ${u.id} AND k.day = ${today}::date)`;
    const [run] = await sql`SELECT title FROM run_sessions WHERE user_id = ${u.id} AND day = ${today}::date AND NOT done LIMIT 1`;
    if (!pending.length && !run) continue;

    const body = !pending.length
      ? `🏃 Corrida de hoje: ${run.title}`
      : pending.length === 1
      ? `${pending[0].emoji} ${pending[0].name} ainda não foi marcado hoje.`
      : `Você tem ${pending.length} desafios para marcar hoje.`;
    const subs = await sql`SELECT endpoint, subscription FROM push_subscriptions WHERE user_id = ${u.id}`;
    for (const s of subs) await sendPush(s, { title: 'Bora manter a sequência! 🔥', body, url: '/' });
  }
};

export const config: Config = { schedule: '0 * * * *' }; // toda hora cheia, UTC
