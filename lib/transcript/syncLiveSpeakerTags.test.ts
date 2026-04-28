import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSpeakerTagMarkerText, deriveLiveSpeakerTagsFromChunks } from "./liveTagsFromChunks";
import { syncLiveSpeakerTagsFromRecordingChunks } from "./syncLiveSpeakerTags";

describe("parseSpeakerTagMarkerText", () => {
  it("parses live recorder sharing marker", () => {
    const r = parseSpeakerTagMarkerText("Jane Doe - sharing:");
    expect(r).toEqual({ speakerName: "Jane Doe", role: "sharing" });
  });

  it("parses live recorder sermon marker", () => {
    const r = parseSpeakerTagMarkerText("Rev. Smith - sermon speaker:");
    expect(r).toEqual({ speakerName: "Rev. Smith", role: "sermon" });
  });

  it("returns null for plain speech", () => {
    expect(parseSpeakerTagMarkerText("Hello world")).toBeNull();
  });
});

describe("deriveLiveSpeakerTagsFromChunks", () => {
  it("keeps only speakerTag chunks in timestamp order", () => {
    const derived = deriveLiveSpeakerTagsFromChunks([
      { text: "hello", timestampMs: 100, isFinal: true },
      {
        text: "A - sharing:",
        timestampMs: 2000,
        speakerTag: true,
      },
      { text: "B - sermon speaker:", timestampMs: 500, speakerTag: true },
    ]);
    expect(derived).toHaveLength(2);
    expect(derived[0]).toMatchObject({
      timestamp_ms: 500,
      speaker_name: "B",
      role: "sermon",
    });
    expect(derived[1]).toMatchObject({
      timestamp_ms: 2000,
      speaker_name: "A",
      role: "sharing",
    });
  });
});

function createMockSupabase() {
  const insertedRows: object[] = [];
  let deleteCalled = false;
  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== "transcript_speaker_tags") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        delete: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => {
                deleteCalled = true;
                return { error: null };
              },
            }),
          }),
        }),
        insert: (rows: object[]) => {
          insertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ error: null });
        },
      };
    }),
  };
  return { supabase, insertedRows, get deleteCalled() {
    return deleteCalled;
  } };
}

describe("syncLiveSpeakerTagsFromRecordingChunks", () => {
  let mock: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    mock = createMockSupabase();
  });

  it("deletes live tags then inserts derived rows with tag_source live", async () => {
    const chunks = [
      { text: "Word", timestampMs: 100, isFinal: true },
      { text: "Pat Lee - sharing:", timestampMs: 5000, speakerTag: true },
    ];
    const result = await syncLiveSpeakerTagsFromRecordingChunks(
      mock.supabase as any,
      {
        recordingId: "rec-1",
        userId: "user-1",
        transcriptChunks: chunks,
      }
    );
    expect(result).toEqual({ ok: true, inserted: 1 });
    expect(mock.deleteCalled).toBe(true);
    expect(mock.insertedRows).toHaveLength(1);
    expect(mock.insertedRows[0]).toMatchObject({
      recording_id: "rec-1",
      user_id: "user-1",
      timestamp_ms: 5000,
      speaker_name: "Pat Lee",
      role: "sharing",
      tag_source: "live",
    });
  });

  it("returns inserted 0 when no tag markers and still runs delete", async () => {
    const result = await syncLiveSpeakerTagsFromRecordingChunks(
      mock.supabase as any,
      {
        recordingId: "rec-1",
        userId: "user-1",
        transcriptChunks: [{ text: "no tags", timestampMs: 0 }],
      }
    );
    expect(result).toEqual({ ok: true, inserted: 0 });
    expect(mock.deleteCalled).toBe(true);
    expect(mock.insertedRows).toHaveLength(0);
  });
});
