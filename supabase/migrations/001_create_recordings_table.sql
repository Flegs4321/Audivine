-- Create recordings table to store recording metadata
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  duration INTEGER NOT NULL, -- duration in seconds
  segments JSONB DEFAULT '[]'::jsonb, -- array of segment objects
  transcript_chunks JSONB DEFAULT '[]'::jsonb, -- array of transcript chunk objects
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL, -- file size in bytes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on created_at for faster queries
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at DESC);

-- Create index on filename for searching
CREATE INDEX IF NOT EXISTS idx_recordings_filename ON recordings(filename);

-- Enable Row Level Security
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access (you can modify this based on your needs)
CREATE POLICY "Allow public read access" ON recordings
  FOR SELECT
  USING (true);

-- Create policy to allow public insert (for uploading recordings)
CREATE POLICY "Allow public insert" ON recordings
  FOR INSERT
  WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_recordings_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment to table
COMMENT ON TABLE recordings IS 'Stores metadata for audio recordings including segments and transcripts';

