import { describe, expect, it } from "vitest";
import { BOOKING_TRANSITIONS, generateBookingReference } from "../server/db";

describe("booking status state machine", () => {
  it("allows valid transitions from pending", () => {
    expect(BOOKING_TRANSITIONS.pending).toContain("confirmed");
    expect(BOOKING_TRANSITIONS.pending).toContain("rejected");
    expect(BOOKING_TRANSITIONS.pending).toContain("cancelled");
  });

  it("blocks skipping straight from pending to completed", () => {
    expect(BOOKING_TRANSITIONS.pending).not.toContain("completed");
  });

  it("treats completed/cancelled/rejected as terminal states", () => {
    expect(BOOKING_TRANSITIONS.completed).toHaveLength(0);
    expect(BOOKING_TRANSITIONS.cancelled).toHaveLength(0);
    expect(BOOKING_TRANSITIONS.rejected).toHaveLength(0);
  });

  it("follows the full happy path pending → confirmed → in_progress → completed", () => {
    expect(BOOKING_TRANSITIONS.pending).toContain("confirmed");
    expect(BOOKING_TRANSITIONS.confirmed).toContain("in_progress");
    expect(BOOKING_TRANSITIONS.in_progress).toContain("completed");
  });
});

describe("generateBookingReference", () => {
  it("matches DRK-YYYYMMDD-XXXX format", () => {
    const ref = generateBookingReference(new Date("2026-07-23T12:00:00Z"));
    expect(ref).toMatch(/^DRK-20260723-[A-Z0-9]{4}$/);
  });

  it("generates unique-ish references", () => {
    const refs = new Set(Array.from({ length: 50 }, () => generateBookingReference()));
    expect(refs.size).toBeGreaterThan(40);
  });
});
