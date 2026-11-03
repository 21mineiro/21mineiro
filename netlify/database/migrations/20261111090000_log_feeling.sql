-- Como o aluno sentiu o treino (fácil / ok / pesado) e um recado opcional
ALTER TABLE workout_logs ADD COLUMN feeling JSONB;
