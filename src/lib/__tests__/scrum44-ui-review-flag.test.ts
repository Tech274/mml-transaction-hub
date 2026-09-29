import { describe, expect, it } from "vitest";
import { isScrum44UiReviewEnabled } from "@/lib/scrum44-ui-review-flag";

describe("SCRUM-44 UI review feature flag", () => {
  it("stays off for missing and non-true values", () => {
    expect(isScrum44UiReviewEnabled({})).toBe(false);
    expect(isScrum44UiReviewEnabled({ VITE_SCRUM44_UI_REVIEW_ENABLED: "1" })).toBe(false);
    expect(isScrum44UiReviewEnabled({ VITE_SCRUM44_UI_REVIEW_ENABLED: "TRUE" })).toBe(false);
  });

  it("turns on only for the exact true string", () => {
    expect(isScrum44UiReviewEnabled({ VITE_SCRUM44_UI_REVIEW_ENABLED: "true" })).toBe(true);
  });
});
