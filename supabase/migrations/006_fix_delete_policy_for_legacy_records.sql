-- Fix RLS policy to allow deleting legacy records (NULL user_id)
-- This allows existing recordings created before the migration to be deleted

-- Drop the existing delete policy
DROP POLICY IF EXISTS "Users can delete their own recordings" ON recordings;

-- Recreate with support for NULL user_id (legacy records)
CREATE POLICY "Users can delete their own recordings" ON recordings
  FOR DELETE
  USING (auth.uid() = user_id OR user_id IS NULL);

