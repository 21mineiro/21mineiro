-- Treinadores adicionados pelo dono do app (o dono fica em COACH_EMAILS na Netlify)
CREATE TABLE coaches (
  email TEXT PRIMARY KEY,
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
