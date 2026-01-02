-- Create user_settings table to store user preferences and settings
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  church_logo_url TEXT,
  church_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Enable Row Level Security
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own settings
CREATE POLICY "Users can read own settings" ON user_settings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own settings
CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own settings
CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to delete their own settings (if needed in future)
CREATE POLICY "Users can delete own settings" ON user_settings
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();

-- Add comment
COMMENT ON TABLE user_settings IS 'Stores user preferences and settings including church logo';

