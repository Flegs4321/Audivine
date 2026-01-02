-- Create speakers table for user-specific speaker/preacher lists
CREATE TABLE IF NOT EXISTS speakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name) -- Prevent duplicate speaker names per user
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_speakers_user_id ON speakers(user_id);

-- Create index on name for faster searches
CREATE INDEX IF NOT EXISTS idx_speakers_name ON speakers(name);

-- Enable Row Level Security
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own speakers
CREATE POLICY "Users can view their own speakers" ON speakers
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own speakers
CREATE POLICY "Users can insert their own speakers" ON speakers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own speakers
CREATE POLICY "Users can update their own speakers" ON speakers
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own speakers
CREATE POLICY "Users can delete their own speakers" ON speakers
  FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_speakers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_speakers_updated_at
  BEFORE UPDATE ON speakers
  FOR EACH ROW
  EXECUTE FUNCTION update_speakers_updated_at();

-- Add comment
COMMENT ON TABLE speakers IS 'User-specific list of speakers/preachers for sermons';

