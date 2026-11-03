/*
 * Gerador da planilha de corrida.
 *
 * Todas as regras do método ficam neste arquivo (volumes, ritmos, fases e treinos-chave),
 * para ser fácil trocar pelo modelo do treinador.
 */

export type Goal = '5k' | '10k' | '21k' | '42k';
export type Level = 'iniciante' | 'intermediario' | 'avancado';

export type Profile = {
  goal: Goal;
  level: Level;
  weekdays: number[];      // dias em que corre (0 = domingo)
  longDay: number;         // dia do longão
  time5k: number | null;   // segundos
  raceDate: string | null; // YYYY-MM-DD
  startDate: string;       // YYYY-MM-DD
};

export type Session = {
  day: string; week: number; phase: string; type: string;
  title: string; description: string; distanceKm: number; pace: string;
};

/* ---------- Parâmetros do método ---------- */

export const GOAL_KM: Record<Goal, number> = { '5k': 5, '10k': 10, '21k': 21.1, '42k': 42.2 };

// Duração padrão da planilha quando não há data de prova (semanas)
const DEFAULT_WEEKS: Record<Goal, number> = { '5k': 8, '10k': 10, '21k': 14, '42k': 18 };
const MIN_WEEKS: Record<Goal, number> = { '5k': 4, '10k': 6, '21k': 8, '42k': 12 };
const MAX_WEEKS = 24;

// Volume semanal inicial (km) por objetivo e nível; o pico é inicial × PEAK_FACTOR
const START_KM: Record<Goal, Record<Level, number>> = {
  '5k': { iniciante: 10, intermediario: 18, avancado: 28 },
  '10k': { iniciante: 14, intermediario: 24, avancado: 35 },
  '21k': { iniciante: 18, intermediario: 30, avancado: 42 },
  '42k': { iniciante: 25, intermediario: 38, avancado: 52 },
};
const PEAK_FACTOR = 1.6;

// Longão máximo (km) por objetivo
const LONG_MAX: Record<Goal, number> = { '5k': 8, '10k': 14, '21k': 19, '42k': 32 };
// Parte do volume semanal que vai para o longão
const LONG_SHARE: Record<Goal, number> = { '5k': 0.3, '10k': 0.33, '21k': 0.4, '42k': 0.42 };

// Tempo de 5 km padrão quando o aluno não sabe (segundos)
const DEFAULT_5K: Record<Level, number> = { iniciante: 35 * 60, intermediario: 27 * 60, avancado: 22 * 60 };

// Ritmos como fator do ritmo de 5 km (min/km): [mais rápido, mais lento]
const PACE_ZONES = {
  regenerativo: [1.35, 1.45],
  leve: [1.22, 1.32],
  longo: [1.2, 1.3],
  ritmo: [1.06, 1.1],      // limiar
  intervalado: [0.96, 1.0], // VO2
};

// Fases (fração da planilha) e semana de recuperação a cada 4
const PHASES = [
  { name: 'Base', until: 0.35 },
  { name: 'Construção', until: 0.75 },
  { name: 'Pico', until: 1 },
];
const TAPER_WEEKS: Record<Goal, number> = { '5k': 1, '10k': 1, '21k': 2, '42k': 2 };
const DELOAD_EVERY = 4;
const DELOAD_FACTOR = 0.8;

/* ---------- Utilidades ---------- */

const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const weekday = (s: string) => parseDate(s).getUTCDay();
const r1 = (n: number) => Math.round(n * 2) / 2; // arredonda para 0,5 km
const km = (n: number) => String(n).replace('.', ','); // 5.5 → "5,5"

export const fmtPace = (secPerKm: number) => {
  const s = Math.round(secPerKm / 5) * 5;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// Ritmos de treino a partir do tempo de 5 km
export function paces(time5k: number | null, level: Level) {
  const p5 = (time5k || DEFAULT_5K[level]) / 5;
  const zone = (k: keyof typeof PACE_ZONES) => `${fmtPace(p5 * PACE_ZONES[k][0])}–${fmtPace(p5 * PACE_ZONES[k][1])}/km`;
  return {
    p5,
    regenerativo: zone('regenerativo'), leve: zone('leve'), longo: zone('longo'),
    ritmo: zone('ritmo'), intervalado: zone('intervalado'),
  };
}

// Previsão de prova (fórmula de Riegel)
export function predictRace(time5k: number | null, level: Level, goal: Goal) {
  const t5 = time5k || DEFAULT_5K[level];
  const t = t5 * (GOAL_KM[goal] / 5) ** 1.06;
  return { seconds: t, time: fmtTime(t), pace: `${fmtPace(t / GOAL_KM[goal])}/km` };
}

export function planWeeks(p: Pick<Profile, 'goal' | 'raceDate' | 'startDate'>) {
  if (!p.raceDate) return DEFAULT_WEEKS[p.goal];
  const weeks = Math.ceil((parseDate(p.raceDate).getTime() - parseDate(p.startDate).getTime()) / (7 * 86400000));
  return Math.max(MIN_WEEKS[p.goal], Math.min(MAX_WEEKS, weeks));
}

/* ---------- Treinos-chave ---------- */

function intervalWorkout(goal: Goal, level: Level, week: number, pace: string) {
  const reps = {
    '5k': ['6 × 400 m', '5 × 600 m', '5 × 800 m', '4 × 1000 m'],
    '10k': ['6 × 600 m', '6 × 800 m', '5 × 1000 m', '4 × 1200 m'],
    '21k': ['6 × 800 m', '5 × 1000 m', '4 × 1500 m', '3 × 2000 m'],
    '42k': ['6 × 1000 m', '5 × 1200 m', '4 × 1600 m', '3 × 2000 m'],
  }[goal];
  const idx = Math.min(reps.length - 1, Math.floor(week / 3) + (level === 'avancado' ? 1 : 0));
  return {
    title: `Intervalado ${reps[idx]}`,
    description: `Aquecimento 2 km leve + 4 educativos.\n${reps[idx]} no ritmo ${pace}, com 2 min de trote entre os tiros.\nDesaquecimento 1–2 km leve.`,
  };
}

function tempoWorkout(total: number, pace: string) {
  const main = Math.max(2, r1(total - 3));
  return {
    title: `Ritmo ${km(main)} km`,
    description: `Aquecimento 2 km leve.\n${km(main)} km contínuos no ritmo ${pace} (forte, mas controlado).\nDesaquecimento 1 km.`,
  };
}

/* ---------- Gerador ---------- */

export function generatePlan(p: Profile): { weeks: number; sessions: Session[] } {
  const weeks = planWeeks(p);
  const z = paces(p.time5k, p.level);
  const days = [...new Set(p.weekdays)].sort((a, b) => a - b);
  if (!days.includes(p.longDay)) days.push(p.longDay);
  const taper = TAPER_WEEKS[p.goal];
  const startKm = START_KM[p.goal][p.level];
  const peakKm = startKm * PEAK_FACTOR;
  const sessions: Session[] = [];

  // Começa na segunda-feira da semana de início
  const monday = addDays(p.startDate, -((weekday(p.startDate) + 6) % 7));

  for (let w = 0; w < weeks; w++) {
    const frac = (w + 1) / weeks;
    const isTaper = w >= weeks - taper;
    const phase = isTaper ? 'Polimento' : PHASES.find((ph) => frac <= ph.until)!.name;
    const deload = !isTaper && (w + 1) % DELOAD_EVERY === 0;

    const buildWeeks = Math.max(1, weeks - taper - 1);
    let volume = startKm + (peakKm - startKm) * Math.min(1, w / buildWeeks);
    if (deload) volume *= DELOAD_FACTOR;
    if (isTaper) volume = peakKm * (w === weeks - 1 ? 0.45 : 0.65);

    // Distribui os dias: longão, um treino de qualidade (dois a partir de 4 dias), o resto leve
    const others = days.filter((d) => d !== p.longDay);
    const quality: number[] = [];
    const raceWeek = isTaper && w === weeks - 1 && !!p.raceDate;
    if ((phase !== 'Base' || w > 0) && !raceWeek) quality.push(others[0]);
    if (others.length >= 3 && phase !== 'Base' && !deload) quality.push(others[Math.floor(others.length / 2)]);

    const longKm = Math.min(LONG_MAX[p.goal], r1(volume * (days.length <= 3 ? LONG_SHARE[p.goal] + 0.08 : LONG_SHARE[p.goal])));
    const rest = Math.max(0, volume - longKm);
    const perDay = others.length ? rest / others.length : 0;

    for (let i = 0; i < 7; i++) {
      const day = addDays(monday, w * 7 + i);
      if (day < p.startDate) continue;
      const wd = weekday(day);
      if (!days.includes(wd)) continue;

      // Dia da prova
      if (p.raceDate && day === p.raceDate) {
        const pred = predictRace(p.time5k, p.level, p.goal);
        sessions.push({ day, week: w + 1, phase, type: 'prova', title: `🏁 Prova ${p.goal.toUpperCase()}`,
          description: `Dia da prova! Previsão: ${pred.time} (${pred.pace}).\nComece controlado no primeiro km e acelere se estiver bem no final.`,
          distanceKm: GOAL_KM[p.goal], pace: pred.pace });
        continue;
      }
      if (p.raceDate && day > p.raceDate) continue;

      let s: Omit<Session, 'day' | 'week' | 'phase'>;
      if (raceWeek && wd !== p.longDay) {
        const d = r1(Math.max(3, Math.min(6, perDay * 0.6)));
        s = { type: 'leve', title: `Leve ${km(d)} km + 4 acelerações`, distanceKm: d, pace: z.leve,
          description: `Semana da prova: ${km(d)} km bem leve e 4 acelerações curtas no final. Nada de forçar.` };
      } else if (wd === p.longDay) {
        s = { type: 'longo', title: `Longão ${km(longKm)} km`, distanceKm: longKm, pace: z.longo,
          description: phase === 'Pico' && p.goal !== '5k'
            ? `${km(longKm)} km contínuos. Faça os últimos ${km(Math.min(5, r1(longKm / 4)))} km mais perto do ritmo de prova.\nTreine a hidratação.`
            : `${km(longKm)} km contínuos em ritmo confortável (dá para conversar).` };
      } else if (quality[0] === wd && phase !== 'Base') {
        const d = r1(Math.max(5, perDay + 1));
        s = { type: 'intervalado', distanceKm: d, pace: z.intervalado, ...intervalWorkout(p.goal, p.level, w, z.intervalado) };
      } else if (quality[0] === wd && phase === 'Base') {
        const d = r1(Math.max(3, perDay));
        s = { type: 'leve', title: `Leve ${km(d)} km + 6 acelerações`, distanceKm: d, pace: z.leve,
          description: `${km(d)} km leve. No final, 6 acelerações de 80 m (soltas, sem forçar), voltando caminhando.` };
      } else if (quality[1] === wd) {
        const d = r1(Math.max(5, perDay + 1));
        s = { type: 'ritmo', distanceKm: d, pace: z.ritmo, ...tempoWorkout(d, z.ritmo) };
      } else if (days.length >= 6 && wd === others[others.length - 1]) {
        const d = r1(Math.max(3, perDay * 0.7));
        s = { type: 'regenerativo', title: `Regenerativo ${km(d)} km`, distanceKm: d, pace: z.regenerativo,
          description: `${km(d)} km bem leve, só para soltar a musculatura.` };
      } else {
        const d = r1(Math.max(3, perDay));
        s = { type: 'leve', title: `Leve ${km(d)} km`, distanceKm: d, pace: z.leve, description: `${km(d)} km em ritmo leve e constante.` };
      }
      if (deload && s.type !== 'prova') s.description += '\nSemana de recuperação: volume menor para o corpo assimilar.';
      if (isTaper) s.description += '\nPolimento: menos volume, pernas descansadas para a prova.';
      sessions.push({ day, week: w + 1, phase, ...s });
    }
  }
  return { weeks, sessions };
}
