-- Combined migration: Add OpenAI settings and transcription method
-- This combines migrations 011 and 012 for easier application

-- Add OpenAI API key and model fields to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
ADD COLUMN IF NOT EXISTS openai_model TEXT DEFAULT 'gpt-4o-mini';

-- Add transcription method field
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS transcription_method TEXT DEFAULT 'browser';

-- Add comments
COMMENT ON COLUMN user_settings.openai_api_key IS 'User-provided OpenAI API key for their own usage';
COMMENT ON COLUMN user_settings.openai_model IS 'User-selected OpenAI model (e.g., gpt-4o-mini, gpt-4, gpt-3.5-turbo)';
COMMENT ON COLUMN user_settings.transcription_method IS 'Transcription method: "browser" (browser speech recognition) or "openai" (OpenAI Whisper API)';

