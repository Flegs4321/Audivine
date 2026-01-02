-- Restrict RLS policies to only allow users to see/delete their own records
-- This ensures users cannot access other users' sermons, even legacy NULL records

-- Drop and recreate SELECT policy to only allow user's own records
DROP POLICY IF EXISTS "Users can read their own recordings" ON recordings;

CREATE POLICY "Users can read their own recordings" ON recordings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Drop and recreate DELETE policy to only allow user's own records
DROP POLICY IF EXISTS "Users can delete their own recordings" ON recordings;

CREATE POLICY "Users can delete their own recordings" ON recordings
  FOR DELETE
  USING (auth.uid() = user_id);

