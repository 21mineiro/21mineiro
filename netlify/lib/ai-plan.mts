/*
 * Geração da planilha com IA, seguindo o método do treinador
 * (mesmas regras e formato da "Planilha de Corrida IA").
 */
import Anthropic from '@anthropic-ai/sdk';

export const DAY_NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const DIST_LABEL: Record<string, string> = { '5k': '5 km', '10k': '10 km', '21k': '21 km (meia maratona)', '42k': '42 km (maratona)' };
const LEVEL_LABEL: Record<string, string> = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };

export type AiInput = {
  goal: string; level: string; weeks: number; daysPerWeek: number;
  longDay: number;        // 0 = segunda … 6 = domingo
  raceDay: number;        // dia da prova na última semana (0 = segunda … 6 = domingo)
  raceDate: string | null;
  mark: string | null; target: string | null; volumeKm: number | null; notes: string | null;
};

export type AiPlan = {
  titulo: string; resumo: string;
  zonas: { nome: string; ritmo: string; descricao: string }[];
  semanas: { numero: number; foco: string; volume_km: number; dias: { tipo: string; km: number; ritmo: string; descricao: string }[] }[];
  dicas: string[];
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'resumo', 'zonas', 'semanas', 'dicas'],
  properties: {
    titulo: { type: 'string' },
    resumo: { type: 'string' },
    zonas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['nome', 'ritmo', 'descricao'],
        properties: { nome: { type: 'string' }, ritmo: { type: 'string' }, descricao: { type: 'string' } },
      },
    },
    semanas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['numero', 'foco', 'volume_km', 'dias'],
        properties: {
          numero: { type: 'integer' },
          foco: { type: 'string' },
          volume_km: { type: 'number' },
          dias: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['tipo', 'km', 'ritmo', 'descricao'],
              properties: {
                tipo: { type: 'string', enum: ['leve', 'tempo', 'intervalado', 'longo', 'regenerativo', 'descanso', 'prova'] },
                km: { type: 'number' },
                ritmo: { type: 'string' },
                descricao: { type: 'string' },
              },
            },
          },
        },
      },
    },
    dicas: { type: 'array', items: { type: 'string' } },
  },
};

export function buildPrompt(v: AiInput) {
  const longao = DAY_NAMES[v.longDay];
  const prova = DAY_NAMES[v.raceDay];
  return `Você é um treinador de corrida experiente. Crie uma planilha de treinamento personalizada em português do Brasil.

DADOS DO CORREDOR
- Objetivo: ${DIST_LABEL[v.goal] || v.goal}
- Nível: ${LEVEL_LABEL[v.level] || v.level}
- Duração: ${v.weeks} semanas (a última semana termina com a prova na ${prova.toLowerCase()}${v.raceDate ? `, dia ${v.raceDate}` : ''})
- Treinos de corrida por semana: ${v.daysPerWeek}
- Dia do longão: ${longao}
- Marca recente: ${v.mark || 'não informada'}
- Meta de tempo: ${v.target || 'não informada (completar bem)'}
- Volume atual: ${v.volumeKm ?? 'não informado'} km/semana
- Observações: ${v.notes || 'nenhuma'}

REGRAS
- Calcule ritmos (min:seg por km) a partir da marca recente.
- Progressão de volume de no máximo ~10% por semana, com semana de recuperação a cada 3–4 semanas e polimento nas 1–2 últimas semanas.
- O plano é SOMENTE de corrida: não inclua musculação, academia, força, mobilidade nem treino cruzado em nenhum dia ou dica.
- Exatamente ${v.daysPerWeek} dias de corrida por semana; os demais dias são "descanso". Nunca coloque treinos intensos em dias seguidos.
- O longão é na ${longao.toLowerCase()}. Na última semana, a ${prova.toLowerCase()} é a "prova" com a distância do objetivo, e nenhum treino vem depois dela.
- Descrições curtas e práticas (máx. ~80 caracteres), ex: "Aquec. 2 km + 6×800 m @ 4:50 (rec. 2 min) + desaq."

FORMATO
- "semanas" tem exatamente ${v.weeks} itens, numerados de 1 a ${v.weeks}.
- Cada semana tem exatamente 7 itens em "dias", na ordem de segunda a domingo.
- Dias de descanso: km 0, ritmo "" e descricao "".
- "ritmo" no formato "6:30" (min:seg por km). Nas zonas, use faixas como "5:20–5:30/km".
- "resumo" tem 2 frases; "dicas" tem de 3 a 5 itens.`;
}

export async function generateAiPlan(v: AiInput): Promise<AiPlan> {
  const client = new Anthropic({ apiKey: Netlify.env.get('ANTHROPIC_API_KEY') });
  const stream = client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // se o pedido for recusado, a própria API tenta outro modelo
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: buildPrompt(v) }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('A IA recusou o pedido. Revise as observações.');
  if (msg.stop_reason === 'max_tokens') throw new Error('A resposta veio incompleta.');
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const plan = JSON.parse(text) as AiPlan;
  if (!Array.isArray(plan.semanas) || !plan.semanas.length) throw new Error('Planilha vazia');
  return plan;
}

/* ---------- Ler a "marca recente" escrita pelo aluno ---------- */

// Ex.: "10 km em 55 min", "5 km a 6:00/km", "21 km em 1h55", "5k 28:30"
export function parseMark(text: string | null): { km: number; seconds: number } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(',', '.');
  const kmM = t.match(/(\d+(?:\.\d+)?)\s*(?:km|k)\b/) || (t.includes('meia') ? ['', '21.1'] : t.includes('maratona') ? ['', '42.2'] : null);
  if (!kmM) return null;
  const km = Number(kmM[1]);
  const pace = t.match(/(\d{1,2}):(\d{2})\s*(?:\/|por)\s*km/) || t.match(/\ba\s+(\d{1,2}):(\d{2})/);
  if (pace) return { km, seconds: (Number(pace[1]) * 60 + Number(pace[2])) * km };
  const hms = t.match(/(\d{1,2})\s*h\s*(\d{1,2})?/);
  if (hms) return { km, seconds: Number(hms[1]) * 3600 + Number(hms[2] || 0) * 60 };
  const mmss = t.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
  if (mmss) return { km, seconds: mmss[3] ? Number(mmss[1]) * 3600 + Number(mmss[2]) * 60 + Number(mmss[3]) : Number(mmss[1]) * 60 + Number(mmss[2]) };
  const min = t.match(/(\d{1,3})\s*(?:min|minutos|')/);
  if (min) return { km, seconds: Number(min[1]) * 60 };
  return null;
}

// Converte a marca para um tempo equivalente nos 5 km (fórmula de Riegel)
export function markTo5k(text: string | null): number | null {
  const m = parseMark(text);
  if (!m || m.km <= 0 || m.seconds <= 0) return null;
  const t5 = m.seconds * (5 / m.km) ** 1.06;
  return t5 > 600 && t5 < 7200 ? Math.round(t5) : null;
}
