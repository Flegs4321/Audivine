-- Add user_id column to recordings table
ALTER TABLE recordings 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_recordings_user_id ON recordings(user_id);

-- Drop existing public policies
DROP POLICY IF EXISTS "Allow public read access" ON recordings;
DROP POLICY IF EXISTS "Allow public insert" ON recordings;
DROP POLICY IF EXISTS "Allow public delete" ON recordings;

-- Create policy to allow users to read their own recordings
-- Also allow reading records with NULL user_id (legacy records created before migration)
CREATE POLICY "Users can read their own recordings" ON recordings
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Create policy to allow users to insert their own recordings
CREATE POLICY "Users can insert their own recordings" ON recordings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own recordings
CREATE POLICY "Users can update their own recordings" ON recordings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to delete their own recordings
CREATE POLICY "Users can delete their own recordings" ON recordings
  FOR DELETE
  USING (auth.uid() = user_id);

