-- Link sermon-only extracts to the full service recording
ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS parent_recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL;

ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS recording_role TEXT DEFAULT 'full';

UPDATE recordings SET recording_role = 'full' WHERE recording_role IS NULL;

ALTER TABLE recordings ALTER COLUMN recording_role SET NOT NULL;
ALTER TABLE recordings ALTER COLUMN recording_role SET DEFAULT 'full';

CREATE INDEX IF NOT EXISTS idx_recordings_parent_recording_id ON recordings(parent_recording_id);

COMMENT ON COLUMN recordings.parent_recording_id IS 'When recording_role is sermon_only, points to the full service recording row';
COMMENT ON COLUMN recordings.recording_role IS 'full = entire service; sermon_only = extracted sermon audio';
