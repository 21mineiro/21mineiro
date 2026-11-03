/*
 * Gerador da planilha de corrida (sem IA, sem custo).
 *
 * Segue o método da planilha do treinador:
 * - dias de descanso entre os treinos; o treino forte é na quinta, alternando intervalado e tempo;
 * - véspera do longão leve com educativos/acelerações; longão no sábado ou domingo;
 * - volume começa no volume atual e sobe no máximo ~10% por semana;
 * - semana de recuperação a cada 4 e polimento no final, terminando com a prova;
 * - ritmos calculados a partir da marca recente.
 * Todas as regras ficam neste arquivo para facilitar ajustes.
 */

export type Goal = '5k' | '10k' | '21k' | '42k';
export type Level = 'iniciante' | 'intermediario' | 'avancado';

export type Profile = {
  goal: Goal;
  level: Level;
  daysPerWeek: number;     // 3 a 6
  longDay: number;         // 6 = sábado, 0 = domingo
  time5k: number | null;   // tempo equivalente nos 5 km (segundos)
  volumeKm: number | null; // volume atual por semana
  weeks: number;
  startDate: string;       // segunda-feira da semana 1 (YYYY-MM-DD)
  raceDate: string | null; // se houver, a prova é nesse dia
  target?: string | null;  // meta de tempo (texto livre)
};

export type Session = {
  day: string; week: number; phase: string; type: string;
  title: string; description: string; distanceKm: number; pace: string;
};

export type PlanMeta = {
  titulo: string; resumo: string;
  zonas: { nome: string; ritmo: string; descricao: string }[];
  dicas: string[];
};

/* ---------- Parâmetros do método ---------- */

export const GOAL_KM: Record<Goal, number> = { '5k': 5, '10k': 10, '21k': 21.1, '42k': 42.2 };
const GOAL_NAME: Record<Goal, string> = { '5k': '5K', '10k': '10K', '21k': '21K', '42k': '42K' };
const LEVEL_NAME: Record<Level, string> = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };

// Volume semanal inicial quando o aluno não informa (km)
const START_KM: Record<Goal, Record<Level, number>> = {
  '5k': { iniciante: 10, intermediario: 18, avancado: 28 },
  '10k': { iniciante: 14, intermediario: 22, avancado: 35 },
  '21k': { iniciante: 20, intermediario: 30, avancado: 42 },
  '42k': { iniciante: 28, intermediario: 40, avancado: 55 },
};
// Teto de volume semanal (km)
const PEAK_MAX: Record<Goal, Record<Level, number>> = {
  '5k': { iniciante: 22, intermediario: 35, avancado: 50 },
  '10k': { iniciante: 30, intermediario: 45, avancado: 65 },
  '21k': { iniciante: 40, intermediario: 55, avancado: 80 },
  '42k': { iniciante: 55, intermediario: 75, avancado: 100 },
};
const WEEKLY_GROWTH = 1.1;      // +10% por semana no máximo
const RECOVERY_EVERY = 4;       // semana de recuperação a cada 4
const RECOVERY_FACTOR = 0.8;
const TAPER_WEEKS: Record<Goal, number> = { '5k': 1, '10k': 1, '21k': 2, '42k': 2 };

// Longão: parte do volume semanal e limite em km
const LONG_SHARE: Record<Goal, number> = { '5k': 0.32, '10k': 0.35, '21k': 0.38, '42k': 0.4 };
const LONG_MAX: Record<Goal, number> = { '5k': 10, '10k': 16, '21k': 21, '42k': 32 };

// Tempo de 5 km padrão quando o aluno não informa a marca (segundos)
const DEFAULT_5K: Record<Level, number> = { iniciante: 35 * 60, intermediario: 27 * 60, avancado: 22 * 60 };

// Ritmos como fator do ritmo de 5 km: [mais rápido, mais lento]
const PACE_ZONES = {
  regenerativo: [1.35, 1.42],
  leve: [1.22, 1.3],
  longo: [1.24, 1.32],
  tempo: [1.06, 1.09],
  intervalado: [0.97, 1.0],
};

// Dias de corrida (0 = segunda … 6 = domingo) por nº de treinos e dia do longão.
// Quinta (3) é sempre o treino forte.
const DAY_SETS: Record<'sab' | 'dom', Record<number, number[]>> = {
  dom: { 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6] },
  sab: { 3: [1, 3, 5], 4: [0, 1, 3, 5], 5: [0, 1, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5] },
};

// Tiros por objetivo, do mais curto ao mais longo (avança ao longo da planilha)
const INTERVALS: Record<Goal, { reps: string; km: number; rec: string }[]> = {
  '5k': [{ reps: '6×400 m', km: 2.4, rec: '1:30' }, { reps: '8×400 m', km: 3.2, rec: '1:30' }, { reps: '5×600 m', km: 3, rec: '2 min' }, { reps: '5×800 m', km: 4, rec: '2 min' }, { reps: '4×1000 m', km: 4, rec: '2 min' }],
  '10k': [{ reps: '6×400 m', km: 2.4, rec: '1:30' }, { reps: '5×800 m', km: 4, rec: '2 min' }, { reps: '6×800 m', km: 4.8, rec: '2 min' }, { reps: '5×1000 m', km: 5, rec: '2 min' }, { reps: '4×1500 m', km: 6, rec: '3 min' }],
  '21k': [{ reps: '6×400 m', km: 2.4, rec: '1:30' }, { reps: '6×800 m', km: 4.8, rec: '2 min' }, { reps: '5×1000 m', km: 5, rec: '2 min' }, { reps: '4×1500 m', km: 6, rec: '3 min' }, { reps: '3×2000 m', km: 6, rec: '3 min' }, { reps: '3×3000 m', km: 9, rec: '3 min' }],
  '42k': [{ reps: '6×800 m', km: 4.8, rec: '2 min' }, { reps: '5×1000 m', km: 5, rec: '2 min' }, { reps: '4×1500 m', km: 6, rec: '3 min' }, { reps: '3×2000 m', km: 6, rec: '3 min' }, { reps: '3×3000 m', km: 9, rec: '3 min' }, { reps: '2×5000 m', km: 10, rec: '4 min' }],
};

/* ---------- Utilidades ---------- */

const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s: string, n: number) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mon0 = (s: string) => (parseDate(s).getUTCDay() + 6) % 7; // 0 = segunda
const r1 = (n: number) => Math.round(n * 2) / 2; // arredonda para 0,5 km
const km = (n: number) => String(n).replace('.', ',');

export const fmtPace = (secPerKm: number) => {
  const s = Math.round(secPerKm / 5) * 5;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// Faixas de ritmo a partir do tempo de 5 km
export function paces(time5k: number | null, level: Level) {
  const p5 = (time5k || DEFAULT_5K[level]) / 5;
  const zone = (k: keyof typeof PACE_ZONES) => `${fmtPace(p5 * PACE_ZONES[k][0])}–${fmtPace(p5 * PACE_ZONES[k][1])}/km`;
  return { p5, regenerativo: zone('regenerativo'), leve: zone('leve'), longo: zone('longo'), ritmo: zone('tempo'), intervalado: zone('intervalado') };
}

// Previsão de prova (fórmula de Riegel)
export function predictRace(time5k: number | null, level: Level, goal: Goal) {
  const t = (time5k || DEFAULT_5K[level]) * (GOAL_KM[goal] / 5) ** 1.06;
  return { seconds: t, time: fmtTime(t), pace: `${fmtPace(t / GOAL_KM[goal])}/km` };
}

/* ---------- Gerador ---------- */

export function generatePlan(p: Profile): { weeks: number; sessions: Session[]; meta: PlanMeta } {
  const weeks = Math.max(1, p.weeks);
  const p5 = (p.time5k || DEFAULT_5K[p.level]) / 5;
  const pace = (k: keyof typeof PACE_ZONES) => `${fmtPace(p5 * (PACE_ZONES[k][0] + PACE_ZONES[k][1]) / 2)}/km`;
  const race = predictRace(p.time5k, p.level, p.goal);
  const racePace = fmtPace(race.seconds / GOAL_KM[p.goal]);

  const longDay = p.longDay === 6 ? 5 : 6; // em índice segunda = 0
  const days = DAY_SETS[longDay === 5 ? 'sab' : 'dom'][Math.min(6, Math.max(3, p.daysPerWeek))];
  const raceDay = p.raceDate ? mon0(p.raceDate) : longDay;
  const taper = Math.min(TAPER_WEEKS[p.goal], Math.max(0, weeks - 2));

  // Volume: parte do atual, +10% por semana até o teto; recuperação a cada 4; polimento no fim
  const start = Math.max(p.daysPerWeek * 3, p.volumeKm && p.volumeKm > 0 ? p.volumeKm : START_KM[p.goal][p.level]);
  const peak = Math.max(start, PEAK_MAX[p.goal][p.level]);
  const volumes: number[] = [];
  let build = start;
  for (let w = 0; w < weeks; w++) {
    if (w >= weeks - taper) { volumes.push(build * (w === weeks - 1 ? 0.55 : 0.75)); continue; }
    if (w > 0) build = Math.min(peak, build * WEEKLY_GROWTH);
    volumes.push((w + 1) % RECOVERY_EVERY === 0 ? build * RECOVERY_FACTOR : build);
  }

  const sessions: Session[] = [];
  let quality = 0; // conta os treinos fortes (alterna intervalado / tempo)
  for (let w = 0; w < weeks; w++) {
    const isLast = w === weeks - 1;
    const isTaper = w >= weeks - taper;
    const isRecovery = !isTaper && (w + 1) % RECOVERY_EVERY === 0;
    const frac = (w + 1) / Math.max(1, weeks - taper);
    const phase = isTaper ? 'Polimento' : isRecovery ? 'Recuperação' : frac <= 0.35 ? 'Base' : 'Construção';
    const vol = volumes[w];

    let longKm = Math.min(LONG_MAX[p.goal], r1(vol * (days.length === 3 ? LONG_SHARE[p.goal] + 0.08 : LONG_SHARE[p.goal])));
    if (isRecovery || isTaper) longKm = r1(longKm * 0.75); // recuperação e polimento: longão mais curto
    const easyDays = days.filter((d) => d !== longDay && d !== 3);

    // Treino forte de quinta: alterna intervalado e tempo; os tiros ficam mais longos ao longo da planilha
    const isInterval = quality % 2 === 0;
    // O treino forte não passa de ~35% do volume da semana (com aquecimento e desaquecimento)
    const maxQ = Math.max(6, vol * 0.35);
    const list = INTERVALS[p.goal].filter((x, i) => i === 0 || x.km + 4 <= maxQ);
    const iv = list[Math.min(list.length - 1, Math.floor((w / Math.max(1, weeks - 1)) * (INTERVALS[p.goal].length - 1)) + (p.level === 'avancado' ? 1 : 0))];
    const tempoKm = r1(Math.max(2, Math.min(GOAL_KM[p.goal] * 0.6, vol * 0.12, maxQ - 4)));
    const qKm = isInterval ? r1(iv.km + 4) : r1(tempoKm + 4);
    const easyKm = r1(Math.max(3, (vol - longKm - qKm) / Math.max(1, easyDays.length)));

    for (const d of days) {
      if (isLast && d > raceDay) continue; // nada depois da prova
      const day = p.raceDate && isLast && d === raceDay ? p.raceDate : addDays(p.startDate, w * 7 + d);
      let s: Omit<Session, 'day' | 'week' | 'phase'>;

      if (isLast && d === raceDay) {
        s = { type: 'prova', title: `🏁 Prova ${GOAL_NAME[p.goal]}`, distanceKm: GOAL_KM[p.goal], pace: `${racePace}/km`,
          description: `Prova! Previsão ${race.time}. Comece controlado e acelere no final.` };
      } else if (isLast) {
        const k = r1(Math.max(3, Math.min(6, easyKm * 0.6)));
        s = { type: 'leve', title: `Leve ${km(k)} km`, distanceKm: k, pace: pace('leve'), description: 'Leve + 4 acelerações curtas' };
      } else if (d === longDay) {
        const fast = Math.min(5, r1(longKm / 5));
        s = { type: 'longo', title: `Longão ${km(longKm)} km`, distanceKm: longKm, pace: pace('longo'),
          description: isRecovery || isTaper ? 'Longão curto' : phase === 'Construção' && p.goal !== '5k' && fast >= 1 ? `Últimos ${km(fast)} km a ${racePace}` : 'Longão constante' };
      } else if (d === 3) {
        quality++;
        if (isInterval) {
          s = { type: 'intervalado', title: `Intervalado ${km(qKm)} km`, distanceKm: qKm, pace: pace('intervalado'),
            description: `Aquec. 2 km + ${iv.reps} (rec. ${iv.rec}) + desaq.` };
        } else {
          s = { type: 'ritmo', title: `Tempo ${km(qKm)} km`, distanceKm: qKm, pace: pace('tempo'),
            description: isRecovery || isTaper ? `${km(r1(tempoKm / 2))} km tempo × 2 (rec. 3 min)` : `2 km leve + ${km(tempoKm)} km tempo + 2 km leve` };
        }
      } else if (d === (longDay + 1) % 7) {
        const k = r1(Math.max(3, easyKm * 0.75));
        s = { type: 'regenerativo', title: `Regenerativo ${km(k)} km`, distanceKm: k, pace: pace('regenerativo'), description: 'Bem solto' };
      } else if (d === longDay - 1) {
        s = { type: 'leve', title: `Leve ${km(easyKm)} km`, distanceKm: easyKm, pace: pace('leve'),
          description: phase === 'Base' ? 'Leve + 4 educativos' : isRecovery ? 'Bem solto' : 'Leve + 6 acelerações' };
      } else {
        s = { type: 'leve', title: `Leve ${km(easyKm)} km`, distanceKm: easyKm, pace: pace('leve'), description: 'Rodagem leve' };
      }
      sessions.push({ day, week: w + 1, phase, ...s });
    }
  }

  const z = paces(p.time5k, p.level);
  const meta: PlanMeta = {
    titulo: `${GOAL_NAME[p.goal]} em ${weeks} semanas · ${LEVEL_NAME[p.level]}`,
    resumo: `Plano de ${weeks} semanas com ${p.daysPerWeek} treinos por semana, começando em ~${Math.round(volumes[0])} km e chegando a ~${Math.round(Math.max(...volumes))} km no pico. `
      + (p.time5k ? `Previsão para a prova: ${race.time} (${racePace}/km).` : 'Informe uma marca recente para ritmos mais precisos.'),
    zonas: [
      { nome: 'Leve', ritmo: z.leve, descricao: 'Conversa fácil, base aeróbica' },
      { nome: 'Tempo', ritmo: z.ritmo, descricao: 'Confortavelmente difícil, ~20–30 min' },
      { nome: 'Intervalado', ritmo: z.intervalado, descricao: 'Tiros de 400 m a 2 km' },
      { nome: 'Longão', ritmo: z.longo, descricao: 'Constante, sem forçar' },
      { nome: 'Regenerativo', ritmo: z.regenerativo, descricao: 'Bem solto, para recuperar' },
    ],
    dicas: [
      'Faça os treinos leves realmente leves: se não consegue conversar, desacelere.',
      'Aqueça 10 min antes de intervalados e tempo.',
      'Durma 7–9 h e respeite as semanas de recuperação.',
      ...(p.target ? [`Sua meta (${p.target}) guia os treinos fortes; ajuste se os ritmos ficarem pesados.`] : []),
    ],
  };
  return { weeks, sessions, meta };
}
