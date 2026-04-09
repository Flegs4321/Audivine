/**
 * Prayer / sharing rows: strip odd Markdown from AI output and prefix with ➤ per speaker row.
 */

/** Black rightwards arrowhead (Unicode name), used before each sharing line in Word. */
export const SHARING_LINE_ARROWHEAD = "\u27A4";

/** Em dash (long dash) for “Name — what they shared” (typographic, not ASCII hyphen). */
const EM = "\u2014";

/**
 * Removes stray ** / * from markdown that models leave half-closed (e.g. "Rhoda Wagler**").
 */
export function cleanMarkdownArtifactsForPrayer(text: string): string {
  let s = text.trim();
  for (let i = 0; i < 10; i++) {
    const next = s
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/([A-Za-z])\*\*(?=\s|$|[,–—.!?:;])/gu, "$1")
      .replace(/\*\*(?=\s|[,–—.!?:;]|$)/gu, "")
      .replace(/^\*\*\s*/g, "")
      .replace(/\s*\*\*$/gm, "")
      .replace(/\*{2,}/g, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Spaced hyphens / en dashes → em dash (e.g. "Rhoda Wagler - text" → "Rhoda Wagler — text").
 * Tightens stray spaces before commas and periods. Spelling must come from the source summary;
 * this only normalizes punctuation for print.
 */
export function normalizeSharingTypography(text: string): string {
  let s = text.trim();
  if (!s) return s;

  // Spaced hyphen, en dash, or em dash between clauses → em dash (long dash)
  s = s.replace(/\s+[\u2013\u2014\-]\s+/g, ` ${EM} `);

  // No space before comma / period / etc.
  s = s.replace(/\s+([,;:.!?])/g, "$1");

  s = s.replace(/\s+/g, " ").trim();

  return s;
}
