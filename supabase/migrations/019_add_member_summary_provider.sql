-- Which API generates member-facing summary text: 'openai' | 'anthropic'.
-- NULL = legacy behavior (prefer Anthropic when anthropic_api_key is set, else OpenAI).

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS member_summary_provider TEXT;

COMMENT ON COLUMN user_settings.member_summary_provider IS
  'Member summary: openai | anthropic. NULL uses legacy key priority.';
