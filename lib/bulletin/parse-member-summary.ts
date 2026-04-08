/**
 * Parse AI-generated member summary text into bulletin sections.
 */

export type ParsedBulletinSections = {
  Announcements: string[];
  "Upcoming Events": string[];
  Sharing: string[];
  Sermon: string[];
};

export function parseMemberSummaryText(fullSummary: string): {
  parsedSections: ParsedBulletinSections;
  messageSpeakerFromSummary: string | null;
} {
  const lines = fullSummary.split(/\n/);

  const parsedSections: ParsedBulletinSections = {
    Announcements: [],
    "Upcoming Events": [],
    Sharing: [],
    Sermon: [],
  };

  let currentSection: keyof ParsedBulletinSections | null = null;
  let currentItems: string[] = [];
  let messageSpeakerFromSummary: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const announcementsMatch = /^[#\s]*announcements?[:\s]*$/i.test(trimmed);
    const eventsMatch = /^[#\s]*(upcoming\s+)?events?[:\s]*$/i.test(trimmed);
    const sharingMatch = /^[#\s]*(prayer\s+&\s+)?sharing[:\s]*$/i.test(trimmed);
    const sermonMatch = /^[#\s]*sermon[:\s\-]*/i.test(trimmed);
    const messageMatch = /^[\d#\s.)\-]*message[:\s\-]/i.test(trimmed);

    if (announcementsMatch || trimmed.toUpperCase() === "ANNOUNCEMENTS") {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Announcements";
      currentItems = [];
    } else if (eventsMatch || trimmed.toUpperCase().includes("EVENT")) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Upcoming Events";
      currentItems = [];
    } else if (sermonMatch || messageMatch) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Sermon";
      currentItems = [];
      if (messageMatch && /message\s*:\s*/i.test(trimmed)) {
        const afterColon = trimmed.replace(/^[\d#\s.)\-]*message\s*:\s*/i, "").trim();
        if (afterColon.length > 0) messageSpeakerFromSummary = afterColon;
      }
    } else if (
      sharingMatch ||
      (trimmed.toUpperCase().includes("SHARING") && !trimmed.toUpperCase().includes("PRAYER"))
    ) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Sharing";
      currentItems = [];
    } else if (/prayer\s*&?\s*sharing/i.test(trimmed)) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Sharing";
      currentItems = [];
    } else if (currentSection) {
      const bulletMatch = trimmed.match(/^[➤•\-\*\u2022]\s*(.+)$/);
      const numberedMatch = trimmed.match(/^\d+[.)]\s*(.+)$/);

      if (bulletMatch || numberedMatch) {
        const text = bulletMatch ? bulletMatch[1] : numberedMatch ? numberedMatch[1] : trimmed;
        if (text && text.trim().length > 0) {
          currentItems.push(text.trim());
        }
      } else if (trimmed.length > 5 && !trimmed.match(/^[#\s]*$/)) {
        currentItems.push(trimmed);
      }
    } else {
      if (/announcements?/i.test(trimmed) && trimmed.length < 20) {
        currentSection = "Announcements";
        currentItems = [];
      } else {
        if (!currentSection) currentSection = "Sermon";
        const bulletMatch = trimmed.match(/^[➤•\-\*\u2022]\s*(.+)$/);
        const text = bulletMatch ? bulletMatch[1] : trimmed;
        if (text && text.trim().length > 0) {
          currentItems.push(text.trim());
        }
      }
    }
  }

  if (currentSection && currentItems.length > 0) {
    parsedSections[currentSection].push(...currentItems);
  }

  if (!messageSpeakerFromSummary && parsedSections.Sermon.length > 0) {
    const speakerBulletIndex = parsedSections.Sermon.findIndex((item) =>
      /^Speaker:\s*(.+)$/i.test(item)
    );
    if (speakerBulletIndex >= 0) {
      const match = parsedSections.Sermon[speakerBulletIndex].match(/^Speaker:\s*(.+)$/i);
      if (match && match[1].trim()) {
        messageSpeakerFromSummary = match[1].trim();
        parsedSections.Sermon.splice(speakerBulletIndex, 1);
      }
    }
  }

  const totalItems = Object.values(parsedSections).reduce((sum, items) => sum + items.length, 0);
  if (totalItems === 0) {
    const allLines = fullSummary
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    parsedSections.Sermon = allLines
      .map((line) => {
        const bulletMatch = line.match(/^[➤•\-\*\u2022\d+[.)]\s*(.+)$/);
        return bulletMatch ? bulletMatch[1] : line;
      })
      .filter((item) => item.length > 5);
  }

  return { parsedSections, messageSpeakerFromSummary };
}
