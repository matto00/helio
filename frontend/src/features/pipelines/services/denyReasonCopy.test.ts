// HEL-1096 tasks.md 3.5 (design.md D6, ticket AC "Show the red" / Standing Constraint C5): proves
// the deny-copy mapping is mutation-provable, not merely green by construction. The executor
// manually deleted the `ai-step` entry from `denyReasonCopy.ts`'s `DENY_REASON_COPY` map, re-ran
// this suite, and confirmed the "every code covered" test below failed (RED) before restoring the
// entry and re-confirming GREEN — see the executor's handoff for the transcript. This file keeps
// running the SAME assertion on every future run, so a future regression fails the same way.

import { ALL_COST_REASON_CODES, GENERIC_FALLBACK_MESSAGE, denyReasonCopy } from "./denyReasonCopy";
import type { CostReason } from "../types/pipelineStep";

describe("denyReasonCopy coverage (HEL-1096 design.md D6)", () => {
  for (const code of ALL_COST_REASON_CODES) {
    it(`covers '${code}' with a specific-rule sentence, never the generic fallback`, () => {
      const reason: CostReason = { code, detail: `detail for ${code}` };
      const message = denyReasonCopy(reason);

      expect(message).not.toBe(GENERIC_FALLBACK_MESSAGE);
      expect(message.length).toBeGreaterThan(0);
    });
  }

  // The AC's specific-rule requirement, pinned per named code (not just "is non-generic") — this
  // is what actually distinguishes "names the specific rule" from "names SOME non-generic text".
  it("names AI specifically for ai-step, not a generic phrase", () => {
    expect(denyReasonCopy({ code: "ai-step", detail: "" })).toMatch(/\bAI\b/);
  });

  it("names writing back specifically for writeback-step", () => {
    expect(denyReasonCopy({ code: "writeback-step", detail: "" })).toMatch(/writes? back/i);
  });

  it("names row count specifically for rows-above-threshold", () => {
    expect(denyReasonCopy({ code: "rows-above-threshold", detail: "" })).toMatch(/rows/i);
  });

  it("names step count specifically for steps-above-bound", () => {
    expect(denyReasonCopy({ code: "steps-above-bound", detail: "" })).toMatch(/steps/i);
  });

  // design.md D6: the four "nothing is known about risk" codes get HONEST, non-alarming copy —
  // naming what wasn't recognized/available, never claiming it's risky (which would be false).
  it.each(["unclassified-op", "unclassified-source", "row-estimate-unavailable", "no-roots"])(
    "gives honest, non-alarming copy for '%s' (never claims risk it hasn't measured)",
    (code) => {
      const message = denyReasonCopy({ code, detail: "" });
      expect(message.toLowerCase()).not.toMatch(/risk|dangerous|unsafe/);
    },
  );

  it("falls back to a generic message for a code outside the known set (forward-compat only)", () => {
    expect(denyReasonCopy({ code: "some-future-code", detail: "" })).toBe(GENERIC_FALLBACK_MESSAGE);
  });
});
