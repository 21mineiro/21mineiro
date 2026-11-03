import webpush from 'web-push';
import { getDatabase } from '@netlify/database';

let ready = false;
function setup() {
  if (ready) return true;
  const pub = Netlify.env.get('VAPID_PUBLIC_KEY');
  const priv = Netlify.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return false;
  webpush.setVapidDetails(Netlify.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', pub, priv);
  ready = true;
  return true;
}

// Envia uma notificação; remove a inscrição se o aparelho não existir mais
export async function sendPush(row: { endpoint: string; subscription: any }, payload: { title: string; body: string; url?: string }) {
  if (!setup()) return false;
  try {
    await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await getDatabase().sql`DELETE FROM push_subscriptions WHERE endpoint = ${row.endpoint}`;
    } else {
      console.error('push error', e?.statusCode, e?.body);
    }
    return false;
  }
}
