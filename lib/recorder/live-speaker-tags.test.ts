import { describe, expect, it } from "vitest";
import {
  addLiveSpeakerTag,
  endActiveLiveSpeakerTag,
  shiftLiveSpeakerTagsForSegment,
  undoLastLiveSpeakerTag,
} from "./live-speaker-tags";

describe("live speaker tags", () => {
  it("starts a tag with a grace window", () => {
    const tags = addLiveSpeakerTag([], {
      speakerName: "Jane Doe",
      role: "sharing",
      currentMs: 10_000,
    });

    expect(tags).toEqual([
      {
        timestampMs: 7000,
        endTimestampMs: null,
        speakerName: "Jane Doe",
        role: "sharing",
      },
    ]);
  });

  it("auto-closes the previous open tag when a new speaker starts", () => {
    const first = addLiveSpeakerTag([], {
      speakerName: "Jane",
      role: "sharing",
      currentMs: 10_000,
    });
    const second = addLiveSpeakerTag(first, {
      speakerName: "Mary",
      role: "sharing",
      currentMs: 20_000,
    });

    expect(second[0]).toMatchObject({
      speakerName: "Jane",
      timestampMs: 7000,
      endTimestampMs: 17_000,
    });
    expect(second[1]).toMatchObject({
      speakerName: "Mary",
      timestampMs: 17_000,
      endTimestampMs: null,
    });
  });

  it("ends the active speaker without moving its start", () => {
    const tags = addLiveSpeakerTag([], {
      speakerName: "Jane",
      role: "sharing",
      currentMs: 10_000,
    });
    const ended = endActiveLiveSpeakerTag(tags, 25_000);

    expect(ended[0]).toMatchObject({
      timestampMs: 7000,
      endTimestampMs: 25_000,
    });
  });

  it("undo removes the last tag and restores the previous speaker", () => {
    const tags = addLiveSpeakerTag(
      addLiveSpeakerTag([], {
        speakerName: "Jane",
        role: "sharing",
        currentMs: 10_000,
      }),
      {
        speakerName: "Mary",
        role: "sharing",
        currentMs: 20_000,
      }
    );

    const undone = undoLastLiveSpeakerTag(tags);

    expect(undone.tags).toHaveLength(1);
    expect(undone.currentSpeaker).toBe("Jane");
  });

  it("shifts tags for a sermon-only extract", () => {
    const shifted = shiftLiveSpeakerTagsForSegment(
      [
        {
          timestampMs: 50_000,
          endTimestampMs: 90_000,
          speakerName: "Preacher",
          role: "sermon",
        },
      ],
      60_000,
      120_000
    );

    expect(shifted).toEqual([
      {
        timestampMs: 0,
        endTimestampMs: 30_000,
        speakerName: "Preacher",
        role: "sermon",
      },
    ]);
  });
});
