/**
 * Prayer / sharing rows: strip odd Markdown from AI output and prefix with ➤ per speaker row.
 */

/** Black rightwards arrowhead (Unicode name), used before each sharing line in Word. */
export const SHARING_LINE_ARROWHEAD = "\u27A4";

/** ASCII-style separator for “Name - what they shared”. */
const NAME_SEP = " - ";

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
 * Normalizes speaker separator to " - " and tightens punctuation spacing.
 * Spelling comes from the source summary; this only normalizes punctuation for print.
 */
export function normalizeSharingTypography(text: string): string {
  let s = text.trim();
  if (!s) return s;

  // Keep a clear separator right after speaker names: "Name - testimony"
  s = s.replace(
    /^([A-Z][A-Za-z.'-]*(?:\s+(?:&\s+)?[A-Z][A-Za-z.'-]*){0,5})(?:\s*\([^)]{1,40}\))?\s*[-–—]\s+/u,
    (_m, name) => `${name}${NAME_SEP}`
  );
  // Convert any remaining spaced dash variants to a regular hyphen separator.
  s = s.replace(/\s+[\u2013\u2014\-]\s+/g, NAME_SEP);

  // No space before comma / period / etc.
  s = s.replace(/\s+([,;:.!?])/g, "$1");

  s = s.replace(/\s+/g, " ").trim();

  // Ensure each sharing line ends with terminal punctuation for print readability.
  if (!/[.!?]["')\]]*$/u.test(s)) {
    s = `${s}.`;
  }

  return s;
}
