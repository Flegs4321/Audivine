const LIVE_CAPTION_HALLUCINATION_PATTERNS = [
  /\bshare this video\b/i,
  /\bsocial media\b/i,
  /\bthanks for watching\b/i,
  /\bthank you for watching\b/i,
  /\blike and subscribe\b/i,
  /\bsubscribe to (my|our|the) channel\b/i,
  /\bdon't forget to subscribe\b/i,
];

export function isLikelyLiveCaptionHallucination(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return LIVE_CAPTION_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(normalized));
}
