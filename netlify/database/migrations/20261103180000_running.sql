-- Assinatura da planilha de corrida (Mercado Pago)
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'basico',      -- basico | premium
  status TEXT NOT NULL DEFAULT 'none',      -- none | trial | pending | active | paused | cancelled
  trial_ends_at TIMESTAMPTZ,
  trial_used BOOLEAN DEFAULT FALSE,
  mp_preapproval_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Respostas do questionário do aluno
CREATE TABLE run_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  goal TEXT NOT NULL,              -- 5k | 10k | 21k | 42k
  level TEXT NOT NULL,             -- iniciante | intermediario | avancado
  weekdays JSONB NOT NULL,         -- dias da semana em que corre (0=dom)
  long_day INTEGER NOT NULL,       -- dia do longão
  time_5k INTEGER,                 -- tempo atual nos 5 km, em segundos
  race_date DATE,
  start_date DATE NOT NULL,
  weeks INTEGER NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cada treino de corrida da planilha
CREATE TABLE run_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  day DATE NOT NULL,
  week INTEGER NOT NULL,
  phase TEXT,
  type TEXT NOT NULL,              -- leve | longo | intervalado | ritmo | regenerativo | prova
  title TEXT NOT NULL,
  description TEXT,
  distance_km NUMERIC,
  pace TEXT,                       -- ritmo-alvo, ex. "5:30–5:50/km"
  coach_note TEXT,
  edited_by_coach BOOLEAN DEFAULT FALSE,
  done BOOLEAN DEFAULT FALSE,
  actual_km NUMERIC,
  actual_time TEXT,
  rpe INTEGER,                     -- esforço percebido 1–10
  feedback TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX run_sessions_user_day ON run_sessions(user_id, day);

-- Conversa aluno ↔ treinador (Premium)
CREATE TABLE run_messages (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES users(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX run_messages_athlete ON run_messages(athlete_id, created_at);
