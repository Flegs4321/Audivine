import { describe, expect, it } from "vitest";
import { isLikelyLiveCaptionHallucination } from "./live-caption-filter";

describe("isLikelyLiveCaptionHallucination", () => {
  it("filters common outro hallucinations from short live slices", () => {
    expect(
      isLikelyLiveCaptionHallucination(
        "Share this video with your friends on social media."
      )
    ).toBe(true);
    expect(isLikelyLiveCaptionHallucination("Thanks for watching.")).toBe(true);
    expect(isLikelyLiveCaptionHallucination("Don't forget to subscribe.")).toBe(true);
  });

  it("keeps normal church-service speech", () => {
    expect(isLikelyLiveCaptionHallucination("Please pray for my neighbor this week.")).toBe(false);
    expect(isLikelyLiveCaptionHallucination("The announcements are in the bulletin.")).toBe(false);
  });
});
