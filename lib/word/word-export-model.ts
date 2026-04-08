import { parseMemberSummaryText } from "./parse-member-summary";

export type WordExportModel = {
  churchName: string;
  churchAddress: string;
  /** e.g. April 6, 2026 */
  sermonDate: string;
  /** e.g. 2026.4.6 — matches common bulletin date boxes */
  bulletinDateCompact: string;
  messageTitle: string;
  announcements: string[];
  upcomingEvents: string[];
  /** Upcoming events padded to 6 rows (empty strings for blank lines). */
  upcomingEventsPadded6: string[];
  sharing: string[];
  sermonBullets: string[];
  spotifyLine1: string;
  spotifyLine2: string;
  spotifyChannel: string;
};

export type BuildWordExportModelInput = {
  fullSummary: string;
  sections: Array<{ label: string; startMs: number; endMs: number | null }>;
  transcriptChunks: Array<{ timestampMs: number; speaker?: string }>;
  churchSettings: { church_name?: string; church_address?: string };
};

function resolveSermonSpeakerFromTranscript(
  sections: BuildWordExportModelInput["sections"],
  transcriptChunks: BuildWordExportModelInput["transcriptChunks"]
): string | null {
  const sermonSection = sections.find((s) => s.label === "Sermon");
  if (!sermonSection || transcriptChunks.length === 0) return null;

  const sermonChunks = transcriptChunks.filter(
    (chunk) =>
      chunk.timestampMs >= sermonSection.startMs &&
      (sermonSection.endMs === null || chunk.timestampMs <= sermonSection.endMs) &&
      chunk.speaker &&
      chunk.speaker.trim() !== ""
  );

  if (sermonChunks.length === 0) return null;

  const speakerCounts: Record<string, number> = {};
  sermonChunks.forEach((chunk) => {
    if (chunk.speaker) {
      speakerCounts[chunk.speaker] = (speakerCounts[chunk.speaker] || 0) + 1;
    }
  });

  return Object.keys(speakerCounts).reduce((a, b) =>
    speakerCounts[a] > speakerCounts[b] ? a : b
  );
}

function padUpcomingToSix(events: string[]): string[] {
  const out = [...events];
  while (out.length < 6) out.push("");
  return out.slice(0, 6);
}

export function buildWordExportModel(input: BuildWordExportModelInput): WordExportModel {
  const { parsedSections, messageSpeakerFromSummary } = parseMemberSummaryText(input.fullSummary);

  const churchName = input.churchSettings.church_name || "CHURCH NAME";
  const churchAddress =
    input.churchSettings.church_address || "807 W Vantrees St. Washington, IN 47501";

  const currentDate = new Date();
  const sermonDate = currentDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const bulletinDateCompact = `${currentDate.getFullYear()}.${currentDate.getMonth() + 1}.${currentDate.getDate()}`;

  const speakerName = resolveSermonSpeakerFromTranscript(input.sections, input.transcriptChunks);
  const messageSpeaker = speakerName || messageSpeakerFromSummary;
  const messageTitle = messageSpeaker ? `MESSAGE: ${messageSpeaker}` : "MESSAGE";

  const upcoming = parsedSections["Upcoming Events"];

  return {
    churchName,
    churchAddress,
    sermonDate,
    bulletinDateCompact,
    messageTitle,
    announcements: parsedSections.Announcements,
    upcomingEvents: upcoming,
    upcomingEventsPadded6: padUpcomingToSix(upcoming),
    sharing: parsedSections.Sharing,
    sermonBullets: parsedSections.Sermon,
    spotifyLine1: "ON SPOTIFY...",
    spotifyLine2: "SEARCH FOR CHANNEL...",
    spotifyChannel: "CHAPEL807",
  };
}

/**
 * Data for docxtemplater. The template file is only a layout shell: only text inside
 * `{{tags}}` or loops is replaced. Everything else prints as you designed it in Word.
 */
export function wordExportModelToTemplateData(
  model: WordExportModel,
  fullSummary: string
): Record<string, unknown> {
  const summaryLines = fullSummary.split(/\r?\n/);

  return {
    church_name: model.churchName,
    church_address: model.churchAddress,
    sermon_date: model.sermonDate,
    bulletin_date_compact: model.bulletinDateCompact,
    bulletin_title: "Sunday Bulletin",
    message_title: model.messageTitle,
    message_heading: model.messageTitle,
    announcements: model.announcements,
    upcoming_events: model.upcomingEventsPadded6,
    sharing: model.sharing,
    sermon: model.sermonBullets,
    spotify_line1: model.spotifyLine1,
    spotify_line2: model.spotifyLine2,
    spotify_channel: model.spotifyChannel,
    spotify_footer:
      "Past Sermons are Posted on SPOTIFY – Search for Channel:",
    /** Entire AI member summary (current text from the modal). */
    full_summary: fullSummary,
    /** Same as full_summary — use whichever name you prefer in Word. */
    member_summary: fullSummary,
    message_summary: fullSummary,
    /** One entry per line of the summary — use `{#summary_lines}{.}{/summary_lines}` for line breaks. */
    summary_lines: summaryLines,
  };
}
