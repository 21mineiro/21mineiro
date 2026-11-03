-- Ficha do corredor no formato da planilha do treinador + resultado da geração por IA
ALTER TABLE run_profiles ADD COLUMN days_per_week INTEGER;
ALTER TABLE run_profiles ADD COLUMN mark TEXT;          -- marca recente (texto livre)
ALTER TABLE run_profiles ADD COLUMN target_time TEXT;   -- meta de tempo
ALTER TABLE run_profiles ADD COLUMN volume_km INTEGER;  -- volume atual por semana
ALTER TABLE run_profiles ADD COLUMN plan_meta JSONB;    -- título, resumo, zonas e dicas
ALTER TABLE run_profiles ADD COLUMN plan_status TEXT DEFAULT 'ready';  -- generating | ready | error
ALTER TABLE run_profiles ADD COLUMN plan_source TEXT;   -- ia | regras
ALTER TABLE run_profiles ADD COLUMN plan_error TEXT;
ALTER TABLE run_profiles ADD COLUMN plan_started_at TIMESTAMPTZ;
