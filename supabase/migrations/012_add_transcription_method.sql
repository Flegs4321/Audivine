-- Add transcription method field to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS transcription_method TEXT DEFAULT 'browser';

-- Add comment
COMMENT ON COLUMN user_settings.transcription_method IS 'Transcription method: "browser" (browser speech recognition) or "openai" (OpenAI Whisper API)';

