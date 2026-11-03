-- Desafio da academia: criado pelo treinador para todos os alunos dele
ALTER TABLE challenges ADD COLUMN team_coach TEXT;
CREATE INDEX challenges_team_coach_idx ON challenges (lower(team_coach));
-- Quem saiu de um desafio da academia não é colocado de volta
CREATE TABLE challenge_optouts (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
