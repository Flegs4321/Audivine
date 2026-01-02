-- Verify that the openai_prompt column exists
-- Run this in Supabase SQL Editor to check

SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'user_settings' 
  AND column_name = 'openai_prompt';

-- If the query returns a row, the column exists
-- If it returns no rows, the migration wasn't applied correctly

