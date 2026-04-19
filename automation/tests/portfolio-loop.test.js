"use strict";

const { normalizeWorkerTask } = require("../scripts/portfolio-loop");

describe("normalizeWorkerTask", () => {
  test("routes scout queue items through the agent path", () => {
    const normalized = normalizeWorkerTask(
      {
        id: "q-123",
        track: "shared",
        goal: "Security audit: check middleware headers",
        goalMode: "audit",
        priorityLabel: "normal",
        source: "scout"
      },
      "/tmp/q-123.json"
    );

    expect(normalized).toEqual({
      strategy: "agent",
      label: "q-123",
      args: {
        _positional: [],
        area: "shared",
        goal: "Security audit: check middleware headers",
        apply: "safe",
        "goal-mode": "audit"
      }
    });
  });

  test("routes legacy queue items through the pipeline path", () => {
    const normalized = normalizeWorkerTask(
      {
        task_id: "weather-fix-cache-20260419",
        track: "weather",
        idea: "fix-cache",
        goal: "Fix cache invalidation bug",
        area: "weather",
        title: "Weather cache invalidation"
      },
      "/tmp/weather-fix-cache-20260419.json"
    );

    expect(normalized).toEqual({
      strategy: "pipeline",
      label: "weather-fix-cache-20260419",
      args: {
        _positional: [],
        track: "weather",
        idea: "fix-cache",
        goal: "Fix cache invalidation bug",
        area: "weather",
        title: "Weather cache invalidation",
        apply: "safe"
      }
    });
  });

  test("derives a legacy idea from the goal when one is missing", () => {
    const normalized = normalizeWorkerTask(
      {
        task_id: "shared-fix-auth-20260419",
        track: "shared",
        goal: "Fix auth middleware edge cases"
      },
      "/tmp/shared-fix-auth-20260419.json"
    );

    expect(normalized.strategy).toBe("pipeline");
    expect(normalized.args.idea).toBe("fix-auth-middleware-edge-cases");
    expect(normalized.args.title).toBe("Fix auth middleware edge cases");
  });

  test("rejects queued tasks without a track", () => {
    expect(() => normalizeWorkerTask({ goal: "Missing track" }, "/tmp/q-missing.json")).toThrow(
      "Queued task is missing track."
    );
  });
});
