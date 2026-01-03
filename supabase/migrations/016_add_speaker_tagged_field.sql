-- Add tagged field to speakers table for easy access during sharing time
-- Tagged speakers will appear at the top of the list

ALTER TABLE speakers ADD COLUMN IF NOT EXISTS tagged BOOLEAN DEFAULT FALSE;

-- Create index for faster queries on tagged speakers
CREATE INDEX IF NOT EXISTS idx_speakers_tagged ON speakers(tagged) WHERE tagged = TRUE;

-- Add comment
COMMENT ON COLUMN speakers.tagged IS 'If true, this speaker will appear at the top of the list for easy access during sharing time';

