-- Per-task OpenAI model settings:
-- - member_summary_openai_model: model used when member summary provider is OpenAI
-- - transcription_openai_model: model used for live and post-upload transcription

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS member_summary_openai_model TEXT DEFAULT 'gpt-4o-mini',
ADD COLUMN IF NOT EXISTS transcription_openai_model TEXT DEFAULT 'whisper-1';

COMMENT ON COLUMN user_settings.member_summary_openai_model IS
'OpenAI model for member summaries when member_summary_provider=openai (e.g., gpt-4o-mini, gpt-4o)';

COMMENT ON COLUMN user_settings.transcription_openai_model IS
'OpenAI model for transcription endpoints (e.g., whisper-1, gpt-4o-mini-transcribe, gpt-4o-transcribe).';
