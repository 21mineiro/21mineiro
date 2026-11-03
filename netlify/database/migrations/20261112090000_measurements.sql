-- Medidas do corpo por dia (peso em kg, medidas em cm) e foto opcional
CREATE TABLE measurements (
  user_id TEXT NOT NULL,
  day DATE NOT NULL,
  weight NUMERIC,
  waist NUMERIC,
  hip NUMERIC,
  chest NUMERIC,
  arm NUMERIC,
  thigh NUMERIC,
  photo_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);
