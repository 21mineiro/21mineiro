-- Treinador responsável por cada aluno (e-mail do treinador)
ALTER TABLE users ADD COLUMN coach_email TEXT;
CREATE INDEX users_coach_email ON users (lower(coach_email));
