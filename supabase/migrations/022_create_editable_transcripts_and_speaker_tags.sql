-- Migration: editable transcripts + per-recording speaker tag timeline.
-- Goals:
--   1. Keep `recordings.transcript_chunks` as the *original*, untouched
--      Whisper output (the source-of-truth transcript).
--   2. Provide a separate `editable_transcripts` row per recording that the
--      user can freely edit without ever modifying the original.
--   3. Provide a `transcript_speaker_tags` table for timestamped speaker
--      assignments that can be merged with the editable transcript at
--      read time. Tags are independent of any transcript text — no risk
--      of corrupting either transcript when adding/removing tags.

-- =============================================================================
-- 1. editable_transcripts: one editable copy per recording
-- =============================================================================
CREATE TABLE IF NOT EXISTS editable_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transcript_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(recording_id)
);

CREATE INDEX IF NOT EXISTS idx_editable_transcripts_recording_id
  ON editable_transcripts(recording_id);
CREATE INDEX IF NOT EXISTS idx_editable_transcripts_user_id
  ON editable_transcripts(user_id);

ALTER TABLE editable_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own editable transcripts"
  ON editable_transcripts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own editable transcripts"
  ON editable_transcripts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own editable transcripts"
  ON editable_transcripts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own editable transcripts"
  ON editable_transcripts FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_editable_transcripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_editable_transcripts_updated_at ON editable_transcripts;
CREATE TRIGGER update_editable_transcripts_updated_at
  BEFORE UPDATE ON editable_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION update_editable_transcripts_updated_at();

COMMENT ON TABLE editable_transcripts IS
  'Editable, user-modifiable copy of a recording''s transcript. Never touches recordings.transcript_chunks (the original Whisper output).';
COMMENT ON COLUMN editable_transcripts.transcript_chunks IS
  'Same JSONB shape as recordings.transcript_chunks (array of {text, timestampMs, speaker?, speakerTag?, source?}). Edited freely by the user.';

-- =============================================================================
-- 2. transcript_speaker_tags: timestamped speaker assignments
-- =============================================================================
CREATE TABLE IF NOT EXISTS transcript_speaker_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
  end_timestamp_ms INTEGER NULL CHECK (end_timestamp_ms IS NULL OR end_timestamp_ms >= timestamp_ms),
  speaker_name TEXT NOT NULL CHECK (length(trim(speaker_name)) > 0),
  role TEXT NOT NULL DEFAULT 'general' CHECK (role IN ('sharing', 'sermon', 'general')),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_speaker_tags_recording_ts
  ON transcript_speaker_tags(recording_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_transcript_speaker_tags_user_id
  ON transcript_speaker_tags(user_id);

ALTER TABLE transcript_speaker_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own speaker tags"
  ON transcript_speaker_tags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own speaker tags"
  ON transcript_speaker_tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own speaker tags"
  ON transcript_speaker_tags FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own speaker tags"
  ON transcript_speaker_tags FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_transcript_speaker_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_transcript_speaker_tags_updated_at ON transcript_speaker_tags;
CREATE TRIGGER update_transcript_speaker_tags_updated_at
  BEFORE UPDATE ON transcript_speaker_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_transcript_speaker_tags_updated_at();

COMMENT ON TABLE transcript_speaker_tags IS
  'Timestamped speaker assignments for a recording. Independent of any transcript so adding/removing tags never modifies transcript text.';
COMMENT ON COLUMN transcript_speaker_tags.timestamp_ms IS
  'Inclusive start time in milliseconds. The next tag implicitly ends this one unless end_timestamp_ms is set.';
COMMENT ON COLUMN transcript_speaker_tags.end_timestamp_ms IS
  'Optional explicit end time. NULL means "until the next tag" (or end of recording).';
COMMENT ON COLUMN transcript_speaker_tags.role IS
  'Section role: sharing (member sharing time), sermon (the message speaker), or general.';
