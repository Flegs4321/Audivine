-- Tag provenance: manual (UI) vs live (derived from recorder transcript_chunks on sync).
ALTER TABLE transcript_speaker_tags
  ADD COLUMN IF NOT EXISTS tag_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (tag_source IN ('manual', 'live'));

COMMENT ON COLUMN transcript_speaker_tags.tag_source IS
  'manual = created/edited in sermon UI; live = synced from live-recording speakerTag chunks (safe to replace on re-sync).';

CREATE INDEX IF NOT EXISTS idx_transcript_speaker_tags_recording_source
  ON transcript_speaker_tags(recording_id, tag_source);
