-- Add sermon metadata fields: title, sermon_date, sermon_time, and speaker
ALTER TABLE recordings 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS sermon_date DATE,
ADD COLUMN IF NOT EXISTS sermon_time TIME,
ADD COLUMN IF NOT EXISTS speaker TEXT;

-- Create index on sermon_date for faster queries
CREATE INDEX IF NOT EXISTS idx_recordings_sermon_date ON recordings(sermon_date DESC);

-- Create index on speaker for searching
CREATE INDEX IF NOT EXISTS idx_recordings_speaker ON recordings(speaker);

-- Add comment
COMMENT ON COLUMN recordings.title IS 'User-friendly title for the sermon/recording';
COMMENT ON COLUMN recordings.sermon_date IS 'Date when the sermon was delivered';
COMMENT ON COLUMN recordings.sermon_time IS 'Time when the sermon was delivered';
COMMENT ON COLUMN recordings.speaker IS 'Name of the speaker/preacher';

