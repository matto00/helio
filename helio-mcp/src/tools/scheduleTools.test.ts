/**
 * HEL-863 tasks.md 4, 6, 7 — `buildSetPipelineScheduleBody`, the tool
 * description contracts, and the schedule/rename handlers' call-routing +
 * error-propagation behaviour. Imports from `./scheduleTools.js` (NOT
 * `./write.js`) deliberately — see that module's header and design.md D10:
 * `write.ts`'s full Zod-schema surface OOMs the type-checker under this
 * repo's root `tsconfig.json`/ts-jest combination.
 *
 * Tasks 7.3/7.4/7.6/7.8: these handler tests construct a `HelioApiError`
 * directly in a fake `HelioApi` (the `pipelineProposalHandlers.test.ts`/
 * `context.test.ts` precedent) and assert the handler REJECTS with that
 * error's `status`/`message` intact. This proves the handler does not
 * swallow or convert the error into a success value — it does NOT prove
 * `guarded()`'s `isError`/message-wrapper formatting, which is
 * module-private to `write.ts` (unimportable — see design.md D10) and is
 * pre-existing, covered-by-convention logic re-exercised end-to-end only by
 * the section-8 stdio probe.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { DashboardResponse, PipelineScheduleResponse } from "../types.js";
import {
  buildSetPipelineScheduleBody,
  DELETE_PIPELINE_SCHEDULE_DESCRIPTION,
  deletePipelineScheduleHandler,
  GET_PIPELINE_SCHEDULE_DESCRIPTION,
  getPipelineScheduleHandler,
  SET_PIPELINE_SCHEDULE_DESCRIPTION,
  setPipelineScheduleHandler,
  UPDATE_DASHBOARD_DESCRIPTION,
  updateDashboardHandler,
} from "./scheduleTools.js";

/** Extracts the field names of a Scala `final case class <className>(...)` in
 *  declaration order, by regex over the raw source text — no Scala parser, just
 *  enough structure to read a flat, paren-free field list (every field type in
 *  `PipelineScheduleResponse` is a bare name or `Option[X]`, never something with
 *  its own parens, so a non-greedy match up to the FIRST `)` after the class name
 *  is exactly the field-list body). Returns `[]` if `className` isn't found, so a
 *  renamed class or a moved file fails LOUD via the caller's non-empty-array
 *  assertion rather than silently comparing against nothing. */
function extractCaseClassFields(scalaSource: string, className: string): string[] {
  const classPattern = new RegExp(`final case class ${className}\\(([\\s\\S]*?)\\)`);
  const match = scalaSource.match(classPattern);
  if (!match) return [];
  return (match[1] ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => field.match(/^(\w+)\s*:/))
    .filter((fieldMatch): fieldMatch is RegExpMatchArray => fieldMatch !== null)
    .map((fieldMatch) => fieldMatch[1] ?? "")
    .filter(Boolean);
}

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    getPipelineSchedule: async () => {
      throw new Error("getPipelineSchedule not stubbed");
    },
    setPipelineSchedule: async () => {
      throw new Error("setPipelineSchedule not stubbed");
    },
    deletePipelineSchedule: async () => {
      throw new Error("deletePipelineSchedule not stubbed");
    },
    updateDashboard: async () => {
      throw new Error("updateDashboard not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

const schedule: PipelineScheduleResponse = {
  id: "sched-1",
  pipelineId: "pipe-1",
  kind: "cron",
  expression: "0 9 * * *",
  enabled: true,
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("buildSetPipelineScheduleBody", () => {
  it("omits the `enabled` key entirely when the argument is not supplied", () => {
    const body = buildSetPipelineScheduleBody({
      kind: "cron",
      expression: "0 9 * * *",
      timezone: "UTC",
    });

    expect("enabled" in body).toBe(false);
    expect(body).toEqual({ kind: "cron", expression: "0 9 * * *", timezone: "UTC" });
  });

  it("includes `enabled: false` explicitly (the arm a naive truthiness check would drop)", () => {
    const body = buildSetPipelineScheduleBody({
      kind: "interval",
      expression: "15m",
      timezone: "UTC",
      enabled: false,
    });

    expect("enabled" in body).toBe(true);
    expect(body.enabled).toBe(false);
  });

  it("includes `enabled: true` when explicitly supplied", () => {
    const body = buildSetPipelineScheduleBody({
      kind: "interval",
      expression: "15m",
      timezone: "UTC",
      enabled: true,
    });

    expect(body.enabled).toBe(true);
  });
});

describe("description contracts (standing requirement 4 — wording is behaviour)", () => {
  it("set_pipeline_schedule names both kind values and all four interval units", () => {
    expect(SET_PIPELINE_SCHEDULE_DESCRIPTION).toContain('"cron"');
    expect(SET_PIPELINE_SCHEDULE_DESCRIPTION).toContain('"interval"');
    expect(SET_PIPELINE_SCHEDULE_DESCRIPTION).toMatch(/s\/m\/h\/d/);
  });

  it("get_pipeline_schedule states the no-schedule case is a 404", () => {
    expect(GET_PIPELINE_SCHEDULE_DESCRIPTION).toMatch(/404/);
  });

  it("get_pipeline_schedule's field enumeration names every field the LIVE PipelineScheduleResponse case class carries (parsed from the Scala source, not a hand-maintained snapshot)", () => {
    // skeptic-final-1.md CR1: a prior version of this test pinned the field
    // list as a frozen TS array literal. That is blind, in BOTH directions,
    // to a change on the Scala side: a field added there, or a field
    // renamed there, leaves the stale description and the stale TS literal
    // still agreeing with each other — GREEN either way, despite the
    // description now being wrong. Fixed here by reading the actual
    // `PipelineScheduleResponse` case class out of
    // `PipelineScheduleProtocol.scala` and deriving the expected field set
    // from IT, so a future Scala-side add/rename changes what this test
    // expects, not just what it's compared against.
    const fields = extractCaseClassFields(
      readFileSync(
        resolve(
          __dirname,
          "../../../backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineScheduleProtocol.scala",
        ),
        "utf8",
      ),
      "PipelineScheduleResponse",
    );

    // Guard against the regex silently matching nothing (e.g. the class was
    // renamed, or the file moved) and this test then vacuously passing on
    // an empty expected set — that failure mode would recreate the exact
    // defect this fix closes, one layer down.
    expect(fields.length).toBeGreaterThan(0);
    expect(fields).toEqual([
      "id",
      "pipelineId",
      "kind",
      "expression",
      "enabled",
      "timezone",
      "nextRunAt",
      "lastRunAt",
      "createdAt",
      "updatedAt",
    ]);

    for (const field of fields) {
      expect(GET_PIPELINE_SCHEDULE_DESCRIPTION).toContain(field);
    }
  });

  describe("extractCaseClassFields (the drift guard's own parsing logic)", () => {
    it("extracts field names, in declaration order, from a Scala case class body", () => {
      const source = `final case class Foo(
        alpha: String,
        beta: Option[Int],
        gamma: Boolean
      )`;

      expect(extractCaseClassFields(source, "Foo")).toEqual(["alpha", "beta", "gamma"]);
    });

    it("returns an empty array when the named class is absent (the caller's non-empty guard catches this)", () => {
      const source = `final case class SomethingElse(x: String)`;

      expect(extractCaseClassFields(source, "Foo")).toEqual([]);
    });

    it("picks up an ADDED field — proves the guard would go red on an 11th Scala field the description never mentions", () => {
      const withExtraField = `final case class PipelineScheduleResponse(
        id: String,
        pipelineId: String,
        kind: String,
        expression: String,
        enabled: Boolean,
        timezone: String,
        nextRunAt: Option[String],
        lastRunAt: Option[String],
        createdAt: String,
        updatedAt: String,
        runCount: Int
      )`;

      const fields = extractCaseClassFields(withExtraField, "PipelineScheduleResponse");

      expect(fields).toContain("runCount");
      // The real description never mentions a field the real backend doesn't have yet —
      // this is exactly the case the old, frozen-literal version of the test could not
      // catch. Asserting "every derived field is in the description" against the
      // simulated-added-field set must be FALSE (not merely "one field missing" — a
      // deterministic boolean assertion, unlike the old conditional-skip pattern this
      // replaces), which is exactly the RED the old test could never produce.
      expect(fields.every((field) => GET_PIPELINE_SCHEDULE_DESCRIPTION.includes(field))).toBe(
        false,
      );
    });

    it("picks up a RENAMED field — proves the guard would go red on lastRunAt becoming previousRunAt", () => {
      const withRenamedField = `final case class PipelineScheduleResponse(
        id: String,
        pipelineId: String,
        kind: String,
        expression: String,
        enabled: Boolean,
        timezone: String,
        nextRunAt: Option[String],
        previousRunAt: Option[String],
        createdAt: String,
        updatedAt: String
      )`;

      const fields = extractCaseClassFields(withRenamedField, "PipelineScheduleResponse");

      expect(fields).toContain("previousRunAt");
      expect(fields).not.toContain("lastRunAt");
      // The real (unmutated) description still says "lastRunAt", not "previousRunAt" — so
      // deriving the expected set from the renamed class must fail against the real
      // description, exactly the RED the old frozen-literal test could never produce.
      expect(GET_PIPELINE_SCHEDULE_DESCRIPTION).not.toContain("previousRunAt");
    });
  });

  it("update_dashboard does not advertise appearance or layout as accepted fields", () => {
    // Negative lookbehind excludes the description's own legitimate "does not
    // accept `appearance`" wording from tripping this guard, while still
    // catching an affirmative "accept(s) `appearance`"/"accept(s) appearance"
    // anywhere else in the string (backtick/quote-tolerant, per CR2).
    expect(UPDATE_DASHBOARD_DESCRIPTION).not.toMatch(/(?<!not )accepts?\s+[`'"]?appearance/i);
    expect(UPDATE_DASHBOARD_DESCRIPTION).not.toMatch(/(?<!not )accepts?\s+[`'"]?layout/i);
    expect(UPDATE_DASHBOARD_DESCRIPTION).toContain("does not accept");
  });

  it("set_pipeline_schedule states the nextRunAt reset asymmetry: cadence change resets it, enabled-only toggle preserves it", () => {
    expect(SET_PIPELINE_SCHEDULE_DESCRIPTION).toMatch(/RESETS the schedule's next firing/);
    expect(SET_PIPELINE_SCHEDULE_DESCRIPTION).toMatch(/toggling `enabled` alone PRESERVES it/);
  });
});

describe("getPipelineScheduleHandler", () => {
  it("returns the schedule from api.getPipelineSchedule", async () => {
    const api = makeFakeApi({ getPipelineSchedule: async () => schedule });

    const result = await getPipelineScheduleHandler(api, "pipe-1");

    expect(result).toBe(schedule);
  });

  it("propagates a 404 HelioApiError (no-schedule case) as a rejected promise, not a converted success value", async () => {
    const api = makeFakeApi({
      getPipelineSchedule: async () => {
        throw new HelioApiError(
          404,
          "/api/pipelines/pipe-1/schedule",
          "Pipeline schedule not found",
        );
      },
    });

    await expect(getPipelineScheduleHandler(api, "pipe-1")).rejects.toMatchObject({
      status: 404,
      message: "Pipeline schedule not found",
    });
  });
});

describe("setPipelineScheduleHandler", () => {
  it("calls api.setPipelineSchedule with the correct pipelineId and an enabled-omitted body when enabled is not supplied", async () => {
    let calledPipelineId: string | undefined;
    let calledBody: unknown;
    const api = makeFakeApi({
      setPipelineSchedule: async (pipelineId: string, body: unknown) => {
        calledPipelineId = pipelineId;
        calledBody = body;
        return schedule;
      },
    });

    await setPipelineScheduleHandler(api, {
      pipelineId: "pipe-1",
      kind: "cron",
      expression: "0 9 * * *",
      timezone: "UTC",
    });

    expect(calledPipelineId).toBe("pipe-1");
    expect(calledBody).toEqual({ kind: "cron", expression: "0 9 * * *", timezone: "UTC" });
    expect("enabled" in (calledBody as object)).toBe(false);
  });

  it("issues the SAME call shape (same pipelineId, upsert) on a second call against the same pipeline", async () => {
    const calls: unknown[] = [];
    const api = makeFakeApi({
      setPipelineSchedule: async (pipelineId: string, body: unknown) => {
        calls.push({ pipelineId, body });
        return schedule;
      },
    });

    const args = { pipelineId: "pipe-1", kind: "cron", expression: "0 9 * * *", timezone: "UTC" };
    await setPipelineScheduleHandler(api, args);
    await setPipelineScheduleHandler(api, args);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });

  it("propagates a 400 HelioApiError from a malformed expression as a rejected promise with the backend's message", async () => {
    const api = makeFakeApi({
      setPipelineSchedule: async () => {
        throw new HelioApiError(
          400,
          "/api/pipelines/pipe-1/schedule",
          "Invalid cron expression: expected 5 fields, got 3",
        );
      },
    });

    await expect(
      setPipelineScheduleHandler(api, {
        pipelineId: "pipe-1",
        kind: "cron",
        expression: "bad",
        timezone: "UTC",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Invalid cron expression: expected 5 fields, got 3",
    });
  });
});

describe("deletePipelineScheduleHandler", () => {
  it("returns { deleted: true, pipelineId } from api.deletePipelineSchedule", async () => {
    const api = makeFakeApi({
      deletePipelineSchedule: async (pipelineId: string) => ({
        deleted: true as const,
        pipelineId,
      }),
    });

    const result = await deletePipelineScheduleHandler(api, "pipe-1");

    expect(result).toEqual({ deleted: true, pipelineId: "pipe-1" });
  });

  it("propagates a 404 HelioApiError (deleting an absent schedule) rather than resolving to a success value", async () => {
    const api = makeFakeApi({
      deletePipelineSchedule: async () => {
        throw new HelioApiError(
          404,
          "/api/pipelines/pipe-1/schedule",
          "Pipeline schedule not found",
        );
      },
    });

    await expect(deletePipelineScheduleHandler(api, "pipe-1")).rejects.toMatchObject({
      status: 404,
      message: "Pipeline schedule not found",
    });
  });
});

describe("updateDashboardHandler", () => {
  it("calls api.updateDashboard with exactly the given dashboardId and name", async () => {
    let calledArgs: [string, string] | undefined;
    const response = { id: "dash-1", name: "Renamed" } as unknown as DashboardResponse;
    const api = makeFakeApi({
      updateDashboard: async (dashboardId: string, name: string) => {
        calledArgs = [dashboardId, name];
        return response;
      },
    });

    const result = await updateDashboardHandler(api, "dash-1", "Renamed");

    expect(calledArgs).toEqual(["dash-1", "Renamed"]);
    expect(result).toBe(response);
  });
});
