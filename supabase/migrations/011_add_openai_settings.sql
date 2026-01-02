-- Add OpenAI API key and model fields to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
ADD COLUMN IF NOT EXISTS openai_model TEXT DEFAULT 'gpt-4o-mini';

-- Add comment
COMMENT ON COLUMN user_settings.openai_api_key IS 'User-provided OpenAI API key for their own usage';
COMMENT ON COLUMN user_settings.openai_model IS 'User-selected OpenAI model (e.g., gpt-4o-mini, gpt-4, gpt-3.5-turbo)';

