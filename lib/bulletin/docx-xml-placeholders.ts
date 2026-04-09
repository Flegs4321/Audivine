/**
 * Word stores visible text in multiple <w:t> runs, so "{{DATE}}" in the UI is often
 * "{{</w:t>...<w:t>DATE}}" in word/document.xml. Plain string replace fails; these helpers
 * match placeholders allowing XML tags between characters.
 */

function escapeRegexChar(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pattern for one placeholder token, e.g. {{DATE}}, when XML may appear between chars. */
export function splitPlaceholderRegex(placeholder: string, global: boolean): RegExp {
  const chars = [...placeholder].map((c) => escapeRegexChar(c));
  return new RegExp(chars.join("(?:<[^>]+>)*"), global ? "g" : "");
}

export function findSplitMarkerIndex(xml: string, marker: string): number {
  if (xml.includes(marker)) return xml.indexOf(marker);
  const re = splitPlaceholderRegex(marker, false);
  const m = re.exec(xml);
  return m ? m.index : -1;
}

export function replaceSplitPlaceholder(
  xml: string,
  placeholder: string,
  replacementEscaped: string
): string {
  if (xml.includes(placeholder)) {
    return xml.split(placeholder).join(replacementEscaped);
  }
  return xml.replace(splitPlaceholderRegex(placeholder, true), replacementEscaped);
}
