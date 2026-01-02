-- Add OpenAI custom prompt field to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS openai_prompt TEXT;

-- Add comment
COMMENT ON COLUMN user_settings.openai_prompt IS 'Custom prompt for OpenAI to instruct how to process transcripts (max 1000 characters)';

