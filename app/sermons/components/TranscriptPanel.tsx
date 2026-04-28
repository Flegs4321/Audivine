/**
 * TranscriptPanel
 *
 * Three-tab editor that lives below a sermon row in the library:
 *
 *   1. Original     — read-only view of recordings.transcript_chunks (untouched).
 *   2. Editable     — the user's editable copy, stored in editable_transcripts.
 *   3. Speaker tags — timestamped speaker assignments stored in
 *                     transcript_speaker_tags.
 *   4. Merged       — preview of editable transcript + tags, the format that
 *                     will be sent to member summary.
 *
 * Strict rule: this component never modifies the original recording row's
 * audio file or transcript. The "Original" tab is purely a read of
 * recordings.transcript_chunks; editing happens only in the editable
 * transcript and tags tables.
 */

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
  speaker?: string;
  speakerTag?: boolean;
  source?: "whisper" | "whisper-live";
}

interface SpeakerOption {
  id: string;
  name: string;
}

type SpeakerRole = "sharing" | "sermon" | "general";

interface SpeakerTag {
  id: string;
  recordingId: string;
  timestampMs: number;
  endTimestampMs: number | null;
  speakerName: string;
  role: SpeakerRole;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MergedSection {
  role: SpeakerRole;
  speakerName: string;
  startMs: number;
  endMs: number;
  text: string;
}

interface MergedTranscript {
  fullText: string;
  sermonText: string;
  sharingText: string;
  sections: MergedSection[];
  sermonSpeakerName: string | null;
  sourceTranscript: "editable" | "original";
  tagCount: number;
}

interface Props {
  sermonId: string;
  sermonTitle: string;
  sermonFilename: string;
  originalChunks: TranscriptChunk[];
  speakers: SpeakerOption[];
  transcribing: boolean;
  transcribeStatus: string;
  outerError: string | null;
  onTranscribe: () => void;
  onError: (message: string | null) => void;
  getAccessToken: () => Promise<string | null>;
}

type ViewMode = "original" | "editable" | "tags" | "merged";

const ROW_BTN =
  "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const TAB_BTN_ACTIVE = "bg-white text-slate-900 shadow-sm";
const TAB_BTN_INACTIVE = "text-slate-600 hover:text-slate-900";

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function formatTimestampMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${m}:${pad2(s)}`;
}

/** Parse "MM:SS" or "H:MM:SS" or plain seconds into ms. Empty -> null. */
function parseTimestampInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000;
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  let totalSeconds = 0;
  if (nums.length === 2) totalSeconds = nums[0] * 60 + nums[1];
  else if (nums.length === 3) totalSeconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  else return null;
  return totalSeconds * 1000;
}

function sanitizeFilenameSegment(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "sermon";
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildOriginalText(chunks: TranscriptChunk[]): string {
  return [...chunks]
    .filter((c) => c?.text && !c.speakerTag)
    .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0))
    .map((c) => c.text.trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}

export default function TranscriptPanel({
  sermonId,
  sermonTitle,
  sermonFilename,
  originalChunks,
  speakers,
  transcribing,
  transcribeStatus,
  outerError,
  onTranscribe,
  onError,
  getAccessToken,
}: Props) {
  const [view, setView] = useState<ViewMode>("original");

  // ---- Editable transcript state -------------------------------------------
  const [editableChunks, setEditableChunks] = useState<TranscriptChunk[] | null>(null);
  const [editableLoading, setEditableLoading] = useState(false);
  const [editableSaving, setEditableSaving] = useState(false);
  const [editableDirty, setEditableDirty] = useState(false);

  // ---- Speaker tags state --------------------------------------------------
  const [tags, setTags] = useState<SpeakerTag[] | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [newTagSpeaker, setNewTagSpeaker] = useState<string>("");
  const [newTagRole, setNewTagRole] = useState<SpeakerRole>("general");
  const [newTagTimestamp, setNewTagTimestamp] = useState<string>("");
  const [newTagEndTimestamp, setNewTagEndTimestamp] = useState<string>("");
  const [newTagNote, setNewTagNote] = useState<string>("");

  // ---- Merged preview state ------------------------------------------------
  const [merged, setMerged] = useState<MergedTranscript | null>(null);
  const [mergedLoading, setMergedLoading] = useState(false);

  const hasOriginal = originalChunks.some((c) => c?.text && c.text.trim().length > 0);

  /** Lazy-load the editable transcript the first time the user opens this tab. */
  const loadEditable = useCallback(async () => {
    if (editableChunks !== null) return;
    setEditableLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch(`/api/sermons/${sermonId}/editable-transcript`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Could not load editable transcript.");
      setEditableChunks(Array.isArray(data.editableTranscript?.chunks) ? data.editableTranscript.chunks : []);
      setEditableDirty(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load editable transcript.");
    } finally {
      setEditableLoading(false);
    }
  }, [editableChunks, getAccessToken, onError, sermonId]);

  const saveEditable = useCallback(async () => {
    if (editableChunks === null) return;
    setEditableSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch(`/api/sermons/${sermonId}/editable-transcript`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chunks: editableChunks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Save failed.");
      if (Array.isArray(data.chunks)) setEditableChunks(data.chunks);
      setEditableDirty(false);
      // Bust merged cache since editable changed.
      setMerged(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save editable transcript.");
    } finally {
      setEditableSaving(false);
    }
  }, [editableChunks, getAccessToken, onError, sermonId]);

  const resetEditable = useCallback(async () => {
    if (!confirm("Reset the editable transcript to the original Whisper output? Your edits will be lost. The original recording is not affected.")) {
      return;
    }
    setEditableSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch(`/api/sermons/${sermonId}/editable-transcript/reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Reset failed.");
      setEditableChunks(Array.isArray(data.chunks) ? data.chunks : []);
      setEditableDirty(false);
      setMerged(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not reset editable transcript.");
    } finally {
      setEditableSaving(false);
    }
  }, [getAccessToken, onError, sermonId]);

  const updateChunkText = (index: number, newText: string) => {
    setEditableChunks((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[index] = { ...next[index], text: newText };
      return next;
    });
    setEditableDirty(true);
  };

  /** Lazy-load tags. */
  const loadTags = useCallback(async () => {
    if (tags !== null) return;
    setTagsLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch(`/api/sermons/${sermonId}/speaker-tags`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Could not load speaker tags.");
      setTags(Array.isArray(data.tags) ? data.tags : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load speaker tags.");
    } finally {
      setTagsLoading(false);
    }
  }, [getAccessToken, onError, sermonId, tags]);

  const addTag = useCallback(async () => {
    const speakerName = newTagSpeaker.trim();
    if (!speakerName) {
      onError("Pick a speaker before adding a tag.");
      return;
    }
    const startMs = parseTimestampInput(newTagTimestamp);
    if (startMs === null) {
      onError('Start time is required. Use "MM:SS" or "H:MM:SS".');
      return;
    }
    const endMs = newTagEndTimestamp.trim() ? parseTimestampInput(newTagEndTimestamp) : null;
    if (newTagEndTimestamp.trim() && endMs === null) {
      onError('End time must be in "MM:SS" or "H:MM:SS" format, or left blank.');
      return;
    }

    setTagSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch(`/api/sermons/${sermonId}/speaker-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          speakerName,
          role: newTagRole,
          timestampMs: startMs,
          endTimestampMs: endMs,
          note: newTagNote.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Could not add tag.");
      setTags((prev) => {
        const next = [...(prev || []), data.tag];
        return next.sort((a, b) => a.timestampMs - b.timestampMs);
      });
      setNewTagSpeaker("");
      setNewTagRole("general");
      setNewTagTimestamp("");
      setNewTagEndTimestamp("");
      setNewTagNote("");
      setMerged(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add tag.");
    } finally {
      setTagSaving(false);
    }
  }, [
    getAccessToken,
    newTagEndTimestamp,
    newTagNote,
    newTagRole,
    newTagSpeaker,
    newTagTimestamp,
    onError,
    sermonId,
  ]);

  const deleteTag = useCallback(
    async (tagId: string) => {
      if (!confirm("Delete this speaker tag? The transcript itself will not change.")) return;
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated.");
        const res = await fetch(`/api/speaker-tags/${tagId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || "Delete failed.");
        setTags((prev) => (prev || []).filter((t) => t.id !== tagId));
        setMerged(null);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Could not delete tag.");
      }
    },
    [getAccessToken, onError]
  );

  /** Lazy-load merged preview. */
  const loadMerged = useCallback(async () => {
    setMergedLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch(`/api/sermons/${sermonId}/merged-transcript`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Could not build merged transcript.");
      setMerged({
        fullText: data.fullText || "",
        sermonText: data.sermonText || "",
        sharingText: data.sharingText || "",
        sections: Array.isArray(data.sections) ? data.sections : [],
        sermonSpeakerName: data.sermonSpeakerName || null,
        sourceTranscript: data.sourceTranscript === "editable" ? "editable" : "original",
        tagCount: data.tagCount || 0,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not build merged transcript.");
    } finally {
      setMergedLoading(false);
    }
  }, [getAccessToken, onError, sermonId]);

  const handleSetView = (next: ViewMode) => {
    onError(null);
    setView(next);
    if (next === "editable") loadEditable();
    if (next === "tags") loadTags();
    if (next === "merged") loadMerged();
  };

  const baseFilename = sanitizeFilenameSegment(sermonTitle || sermonFilename || `sermon-${sermonId}`);

  // -----------------------------------------------------------------
  // Renderers
  // -----------------------------------------------------------------

  const renderOriginalTab = () => {
    if (!hasOriginal) {
      if (transcribing) {
        return (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
            <span>{transcribeStatus || "Transcribing with OpenAI Whisper…"}</span>
          </div>
        );
      }
      return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No transcript yet. Click <span className="font-semibold">Transcribe</span> below to generate one with OpenAI Whisper.
        </div>
      );
    }

    const sorted = [...originalChunks]
      .filter((c) => c?.text && !c.speakerTag)
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

    return (
      <>
        {transcribing && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600" />
            <span>{transcribeStatus || "Re-transcribing…"}</span>
          </div>
        )}
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={ROW_BTN}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(buildOriginalText(originalChunks));
              } catch {
                onError("Could not copy to clipboard.");
              }
            }}
          >
            Copy
          </button>
          <button
            type="button"
            className={ROW_BTN}
            onClick={() => downloadText(`${baseFilename} (original).txt`, buildOriginalText(originalChunks))}
          >
            Download .txt
          </button>
          <button type="button" className={ROW_BTN} onClick={onTranscribe} disabled={transcribing}>
            {transcribing ? "Re-running…" : "Re-transcribe"}
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-xs uppercase tracking-wide text-slate-500">
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 font-semibold">Read-only</span>
            <span>Source of truth — never modified by edits or tags</span>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md bg-white p-3">
            <div className="space-y-3 text-sm leading-relaxed text-slate-800">
              {sorted.map((chunk, idx) => (
                <div key={`orig-${idx}`} className="flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-slate-400 pt-0.5">
                    {formatTimestampMs(chunk.timestampMs || 0)}
                  </span>
                  <p className="whitespace-pre-wrap">{chunk.text.trim()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderEditableTab = () => {
    if (editableLoading) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <span>Loading editable transcript…</span>
        </div>
      );
    }
    if (editableChunks === null) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          The editable transcript hasn't been loaded yet.
        </div>
      );
    }
    if (editableChunks.length === 0 && !hasOriginal) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          There's no transcript to edit yet. Run <span className="font-semibold">Transcribe</span> first.
        </div>
      );
    }

    return (
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Editing your copy. The original recording transcript stays untouched.
            {editableDirty && <span className="ml-2 font-semibold text-amber-700">Unsaved changes</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ROW_BTN} onClick={saveEditable} disabled={!editableDirty || editableSaving}>
              {editableSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={ROW_BTN}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(buildOriginalText(editableChunks));
                } catch {
                  onError("Could not copy to clipboard.");
                }
              }}
              disabled={editableDirty}
              title={editableDirty ? "Save your edits first" : "Copy editable transcript"}
            >
              Copy
            </button>
            <button
              type="button"
              className={ROW_BTN}
              onClick={() => downloadText(`${baseFilename} (editable).txt`, buildOriginalText(editableChunks))}
            >
              Download .txt
            </button>
            <button type="button" className={ROW_BTN} onClick={resetEditable} disabled={editableSaving}>
              Reset to original
            </button>
          </div>
        </div>
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
          <div className="space-y-3">
            {editableChunks
              .map((c, originalIndex) => ({ chunk: c, originalIndex }))
              .filter(({ chunk }) => chunk && !chunk.speakerTag)
              .sort((a, b) => (a.chunk.timestampMs || 0) - (b.chunk.timestampMs || 0))
              .map(({ chunk, originalIndex }) => (
                <div key={`edit-${originalIndex}`} className="flex gap-3">
                  <span className="shrink-0 pt-2 font-mono text-xs text-slate-400">
                    {formatTimestampMs(chunk.timestampMs || 0)}
                  </span>
                  <textarea
                    value={chunk.text}
                    onChange={(e) => updateChunkText(originalIndex, e.target.value)}
                    rows={Math.max(1, Math.min(6, Math.ceil((chunk.text || "").length / 80)))}
                    className="flex-1 resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
                  />
                </div>
              ))}
          </div>
        </div>
      </>
    );
  };

  const renderTagsTab = () => {
    if (tagsLoading) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <span>Loading speaker tags…</span>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Tags are independent of the transcript text. Adding or removing a tag here never modifies the original or editable transcripts — they're combined only when you preview or send to member summary.
        </p>

        {/* Add tag form */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">Add a tag</h5>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">Speaker</label>
              <select
                value={newTagSpeaker}
                onChange={(e) => setNewTagSpeaker(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
              >
                <option value="">Pick a speaker…</option>
                {speakers.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              {speakers.length === 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  No speakers yet.{" "}
                  <Link href="/settings" className="text-teal-700 hover:underline">
                    Add some in Settings
                  </Link>
                  .
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Role</label>
              <select
                value={newTagRole}
                onChange={(e) => setNewTagRole(e.target.value as SpeakerRole)}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
              >
                <option value="general">General</option>
                <option value="sharing">Sharing time</option>
                <option value="sermon">Sermon (the message)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Start (MM:SS)</label>
              <input
                type="text"
                value={newTagTimestamp}
                onChange={(e) => setNewTagTimestamp(e.target.value)}
                placeholder="0:00"
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">End (optional)</label>
              <input
                type="text"
                value={newTagEndTimestamp}
                onChange={(e) => setNewTagEndTimestamp(e.target.value)}
                placeholder="leave blank"
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Note (optional)</label>
              <input
                type="text"
                value={newTagNote}
                onChange={(e) => setNewTagNote(e.target.value)}
                placeholder="e.g. testimony, prayer request"
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
              />
            </div>
            <button type="button" className={ROW_BTN} onClick={addTag} disabled={tagSaving}>
              {tagSaving ? "Adding…" : "Add tag"}
            </button>
          </div>
        </div>

        {/* Existing tags */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Tags ({tags?.length || 0})
          </div>
          {(!tags || tags.length === 0) ? (
            <div className="p-4 text-sm text-slate-500">
              No tags yet. Add one above to mark who's speaking during sharing or the sermon.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tags.map((tag) => (
                <li key={tag.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="shrink-0 font-mono text-xs text-slate-500">
                    {formatTimestampMs(tag.timestampMs)}
                    {tag.endTimestampMs != null && ` – ${formatTimestampMs(tag.endTimestampMs)}`}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      tag.role === "sermon"
                        ? "border-teal-200 bg-teal-50 text-teal-800"
                        : tag.role === "sharing"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    {tag.role}
                  </span>
                  <span className="font-semibold text-slate-900">{tag.speakerName}</span>
                  {tag.note && <span className="text-slate-500">— {tag.note}</span>}
                  <span className="ml-auto">
                    <button
                      type="button"
                      onClick={() => deleteTag(tag.id)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const renderMergedTab = () => {
    if (mergedLoading) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <span>Building merged preview…</span>
        </div>
      );
    }
    if (!merged) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No merged preview built yet.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Editable transcript + speaker tags. This is the format member summary will receive.{" "}
          <button
            type="button"
            onClick={loadMerged}
            className="text-teal-700 underline hover:text-teal-900"
          >
            Refresh
          </button>
        </p>

        {merged.sermonSpeakerName && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
            <span className="font-semibold">Sermon speaker:</span> {merged.sermonSpeakerName}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Sharing time
              </span>
              <button
                type="button"
                className={ROW_BTN}
                disabled={!merged.sharingText}
                onClick={() => downloadText(`${baseFilename} (sharing).txt`, merged.sharingText)}
              >
                Download
              </button>
            </div>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-slate-800">
              {merged.sharingText || "No sharing-time tags. Add some on the Speaker tags tab."}
            </pre>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Sermon (the message)
              </span>
              <button
                type="button"
                className={ROW_BTN}
                disabled={!merged.sermonText}
                onClick={() => downloadText(`${baseFilename} (sermon).txt`, merged.sermonText)}
              >
                Download
              </button>
            </div>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-slate-800">
              {merged.sermonText || "No sermon tag yet. Tag the message speaker on the Speaker tags tab."}
            </pre>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Full merged transcript
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={ROW_BTN}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(merged.fullText);
                  } catch {
                    onError("Could not copy to clipboard.");
                  }
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className={ROW_BTN}
                onClick={() => downloadText(`${baseFilename} (merged).txt`, merged.fullText)}
              >
                Download
              </button>
            </div>
          </div>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-slate-800">
            {merged.fullText || "(empty)"}
          </pre>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">Transcript</h4>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
          {([
            ["original", "Original"],
            ["editable", "Editable copy"],
            ["tags", "Speaker tags"],
            ["merged", "Merged preview"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => handleSetView(key)}
              className={`rounded-md px-3 py-1 transition-colors ${
                view === key ? TAB_BTN_ACTIVE : TAB_BTN_INACTIVE
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {outerError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {outerError}
        </div>
      )}

      {view === "original" && renderOriginalTab()}
      {view === "editable" && renderEditableTab()}
      {view === "tags" && renderTagsTab()}
      {view === "merged" && renderMergedTab()}
    </div>
  );
}
