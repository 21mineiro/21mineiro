import type { Config } from '@netlify/functions';
import { getUser } from '@netlify/identity';
import { runAiGeneration, isCoach } from '../lib/run-routes.mts';

// Gera a planilha com IA em segundo plano (pode levar alguns minutos).
// O app acompanha pelo status da ficha (plan_status) em /api/run/state.
export default async (req: Request) => {
  const devUser = Netlify.env.get('NETLIFY_DEV') === 'true' ? req.headers.get('x-dev-user') : null;
  const user: any = devUser ? JSON.parse(devUser) : await getUser();
  if (!user) return;
  const body: any = await req.json().catch(() => ({}));
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);
  // O treinador pode gerar a planilha de um aluno
  const target = body.athleteId && isCoach(user.email || '') ? String(body.athleteId) : user.id;
  await runAiGeneration(target, today);
};

export const config: Config = { background: true, path: '/bg/plan' };
