-- Fix RLS policy to allow reading legacy records (NULL user_id)
-- This allows existing recordings created before the migration to be visible

-- Drop the existing policy
DROP POLICY IF EXISTS "Users can read their own recordings" ON recordings;

-- Recreate with support for NULL user_id (legacy records)
CREATE POLICY "Users can read their own recordings" ON recordings
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

