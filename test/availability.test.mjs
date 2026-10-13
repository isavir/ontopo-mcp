// node --test test/  (npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAvailability } from "../src/availability.js";

// Sushi Room (Herzliya), availability_search 2026-10-14 20:00, read 2026-10-13: no areas, method "phone"
const PHONE_ONLY = {
  page: { title: "There's a few seats available for you", fallback: { method: "phone" } },
  recommended: [{ id: "מסעדה", time: "2000", method: "phone", text: "call" }, { method: "disabled", time: "2015" }],
  method: "phone",
  venue: { slug: "29238105", campaign: null },
  availability_id: "6acde72b1e6004002dc354ec",
};

test("a phone-only venue is not available and says so, with its phone", () => {
  const a = readAvailability(PHONE_ONLY, "+972 9-966-9969");
  assert.equal(a.available, false);
  assert.equal(a.phone_only, true);
  assert.equal(a.phone, "+972 9-966-9969");
  assert.equal(a.availabilityId, "6acde72b1e6004002dc354ec");
});

test("an answer with an availability id but no areas is never 'available'", () => {
  const a = readAvailability({ availability_id: "x1" });
  assert.equal(a.available, false);
  assert.equal(a.phone_only, undefined);
  assert.equal(a.reason, "No bookable time slots returned");
});

test("areas with seats → bookable time slots per area", () => {
  const a = readAvailability({
    page: { title: "t", subtitle: "s" },
    areas: [
      { id: "in", name: "Inside", score: 1, options: [{ time: "2000", method: "seat" }, { time: "2030", method: "standby" }] },
      { id: "bar", name: "Bar", score: 5, options: [{ time: "2000", method: "disabled" }] },
    ],
    recommended: [{ id: "in", text: "Inside", time: "2000", method: "seat" }],
  });
  assert.equal(a.available, true);
  assert.deepEqual(a.areas[0].timeSlots.map((t) => [t.time, t.bookable, t.waitlist]), [["20:00", true, false], ["20:30", false, true]]);
  assert.deepEqual(a.recommended, [{ area: "Inside", areaId: "in", time: "20:00", method: "seat" }]);
});

test("areas without a seat → not available", () => {
  const a = readAvailability({ page: {}, areas: [{ id: "in", name: "Inside", options: [{ time: "2000", method: "disabled" }] }] });
  assert.equal(a.available, false);
});

test("nothing usable → could not load", () => {
  assert.deepEqual(readAvailability(null), { available: false, reason: "Could not load availability data" });
});
