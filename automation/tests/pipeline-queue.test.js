"use strict";

const {
  makeQueueFingerprint,
  findDuplicateItem,
  normalizeGoalText
} = require("../scripts/pipeline-queue");

describe("normalizeGoalText", () => {
  test("normalizes whitespace and casing", () => {
    expect(normalizeGoalText("  Fix   Weather   Drift  ")).toBe("fix weather drift");
  });
});

describe("makeQueueFingerprint", () => {
  test("stable across equivalent goal formatting", () => {
    const a = makeQueueFingerprint("weather", "Fix weather drift", "audit");
    const b = makeQueueFingerprint("WEATHER", "  fix   weather drift  ", "audit");
    expect(a).toBe(b);
  });

  test("changes when mode changes", () => {
    const audit = makeQueueFingerprint("weather", "Fix weather drift", "audit");
    const edit = makeQueueFingerprint("weather", "Fix weather drift", "edit");
    expect(audit).not.toBe(edit);
  });
});

describe("findDuplicateItem", () => {
  test("finds active duplicates without cooldown", () => {
    const fingerprint = makeQueueFingerprint("weather", "Fix weather drift", "audit");
    const duplicate = findDuplicateItem(
      [
        {
          id: "q-1",
          track: "weather",
          goal: "Fix weather drift",
          goalMode: "audit",
          fingerprint,
          status: "pending",
          createdAt: "2026-04-19T00:00:00.000Z"
        }
      ],
      { track: "weather", goal: "  fix   weather drift ", goalMode: "audit" }
    );

    expect(duplicate).toBeTruthy();
    expect(duplicate.id).toBe("q-1");
  });

  test("respects cooldown for completed items", () => {
    const fingerprint = makeQueueFingerprint("kortex", "Audit tenant isolation", "audit");
    const nowMs = new Date("2026-04-19T12:00:00.000Z").getTime();

    const duplicate = findDuplicateItem(
      [
        {
          id: "q-2",
          track: "kortex",
          goal: "Audit tenant isolation",
          goalMode: "audit",
          fingerprint,
          status: "done",
          completedAt: "2026-04-19T10:30:00.000Z"
        }
      ],
      { track: "kortex", goal: "Audit tenant isolation", goalMode: "audit" },
      { cooldownMs: 3 * 60 * 60 * 1000, nowMs }
    );

    expect(duplicate).toBeTruthy();
    expect(duplicate.id).toBe("q-2");
  });

  test("ignores stale completed items outside cooldown", () => {
    const fingerprint = makeQueueFingerprint("kortex", "Audit tenant isolation", "audit");
    const nowMs = new Date("2026-04-20T12:00:00.000Z").getTime();

    const duplicate = findDuplicateItem(
      [
        {
          id: "q-3",
          track: "kortex",
          goal: "Audit tenant isolation",
          goalMode: "audit",
          fingerprint,
          status: "failed",
          failedAt: "2026-04-19T10:30:00.000Z"
        }
      ],
      { track: "kortex", goal: "Audit tenant isolation", goalMode: "audit" },
      { cooldownMs: 3 * 60 * 60 * 1000, nowMs }
    );

    expect(duplicate).toBeNull();
  });
});
