-- Usuários (o id vem do Netlify Identity)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  avatar TEXT,
  reminder_hour INTEGER,            -- hora local do lembrete (0-23) ou NULL = desligado
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Desafios (podem ter vários participantes)
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🎯',
  kind TEXT NOT NULL DEFAULT 'daily',   -- daily | quantity | weekly
  target NUMERIC,                        -- quantity: meta por dia; weekly: vezes por semana
  unit TEXT,                             -- quantity: ex. "L", "páginas"
  days INTEGER NOT NULL,
  start_date DATE NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE challenge_members (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  link_workout BOOLEAN DEFAULT FALSE,   -- marca o dia ao concluir treino
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (challenge_id, user_id)
);

-- Check-in de um participante em um dia
CREATE TABLE checkins (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  day DATE NOT NULL,
  value NUMERIC NOT NULL DEFAULT 1,
  note TEXT,
  photo_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (challenge_id, user_id, day)
);

-- Treinos (privados de cada usuário)
CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  weekdays JSONB NOT NULL DEFAULT '[]',
  exercises JSONB NOT NULL DEFAULT '[]',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registro de um treino feito em um dia (cargas por série ficam em exercises)
CREATE TABLE workout_logs (
  user_id TEXT NOT NULL REFERENCES users(id),
  day DATE NOT NULL,
  workout_id TEXT NOT NULL,
  workout_name TEXT NOT NULL,
  finished BOOLEAN DEFAULT FALSE,
  exercises JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, day, workout_id)
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX checkins_user_idx ON checkins(user_id);
CREATE INDEX members_user_idx ON challenge_members(user_id);
CREATE INDEX logs_user_idx ON workout_logs(user_id, day);
