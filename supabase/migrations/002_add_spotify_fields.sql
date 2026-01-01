-- Add Spotify-related fields to recordings table
-- This allows storing both Spotify imports and direct uploads

ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'upload' CHECK (source IN ('upload', 'spotify')),
ADD COLUMN IF NOT EXISTS spotify_episode_id TEXT,
ADD COLUMN IF NOT EXISTS spotify_show_id TEXT,
ADD COLUMN IF NOT EXISTS spotify_external_url TEXT,
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS speaker TEXT,
ADD COLUMN IF NOT EXISTS date_preached DATE;

-- Create index on source for filtering
CREATE INDEX IF NOT EXISTS idx_recordings_source ON recordings(source);

-- Create index on spotify_episode_id for lookups
CREATE INDEX IF NOT EXISTS idx_recordings_spotify_episode_id ON recordings(spotify_episode_id) WHERE spotify_episode_id IS NOT NULL;

-- Update existing records to have source = 'upload'
UPDATE recordings SET source = 'upload' WHERE source IS NULL;

-- Add comment
COMMENT ON COLUMN recordings.source IS 'Source of the recording: upload (user uploaded) or spotify (imported from Spotify)';
COMMENT ON COLUMN recordings.spotify_episode_id IS 'Spotify episode ID if imported from Spotify';
COMMENT ON COLUMN recordings.spotify_show_id IS 'Spotify show/podcast ID if imported from Spotify';
COMMENT ON COLUMN recordings.title IS 'Sermon title';
COMMENT ON COLUMN recordings.description IS 'Sermon description';
COMMENT ON COLUMN recordings.speaker IS 'Name of the speaker/preacher';
COMMENT ON COLUMN recordings.date_preached IS 'Date when the sermon was preached';

