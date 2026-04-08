/** Human-readable stamp for filenames, e.g. "June 25 2026 3-45 PM" */
export function formatRecordingDateTimeForFilename(d: Date = new Date()): string {
  const datePart = d
    .toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .replace(/,/g, "")
    .trim();
  const timePart = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/:/g, "-");
  return `${datePart} ${timePart}`;
}

/** Safe for storage path segment (still unique via ISO timestamp suffix in upload). */
export function sanitizeFilenameBase(name: string): string {
  return name
    .replace(/[/:*?"<>|\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
