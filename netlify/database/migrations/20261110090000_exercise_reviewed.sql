-- Marca se o treinador já conferiu o vídeo do exercício
ALTER TABLE exercises ADD COLUMN reviewed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE exercises ADD COLUMN reviewed_by TEXT;
