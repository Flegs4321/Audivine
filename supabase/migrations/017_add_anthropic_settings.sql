-- Claude (Anthropic) API for member summary / Word export when preferred over OpenAI
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT,
ADD COLUMN IF NOT EXISTS claude_model TEXT DEFAULT 'claude-sonnet-4-20250514';

COMMENT ON COLUMN user_settings.anthropic_api_key IS 'User Anthropic API key for Claude (member summary, Word export)';
COMMENT ON COLUMN user_settings.claude_model IS 'Claude model id for Messages API (e.g. claude-sonnet-4-20250514)';
