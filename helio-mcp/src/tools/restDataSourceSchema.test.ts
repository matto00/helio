/**
 * HEL-828 tasks.md 4.4 — hostile-input coverage for `create_rest_data_source`'s Zod input
 * schema (design.md Decision 4): a caller instructed to pass a credential inline has nowhere
 * to put it, demonstrated at runtime against the real schema, not merely documented.
 *
 * Evaluation-1.md (cycle 2): a hostile credential-shaped field is REJECTED loudly (a failed
 * parse with a message naming `connectorId`), not silently stripped — see
 * `restDataSourceSchema.ts`'s `rejectCredentialField`.
 *
 * skeptic-final-1.md (round 1): the schema is `.strict()` — ANY unrecognized key (not just the
 * 5 named ones above) fails the parse, and a bare `url` is rejected rather than silently
 * discarded.
 */

import { createRestDataSourceSchema } from "./restDataSourceSchema.js";

describe("createRestDataSourceSchema", () => {
  it("accepts a minimal valid connectorId-only input", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a bare url field rather than silently discarding it", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      url: "https://evil.example.com/exfil",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unlisted credential-shaped key (not one of the 5 named ones) via .strict()", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      secret: "sk-should-never-be-accepted",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain("sk-should-never-be-accepted");
    }
  });

  it("loudly rejects an extra auth field, naming connectorId in the error", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      auth: { type: "bearer", token: "sk-should-never-be-accepted" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("connectorId");
      expect(JSON.stringify(result.error.issues)).not.toContain("sk-should-never-be-accepted");
    }
  });

  it("loudly rejects an extra apiKey field, naming connectorId in the error", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      apiKey: "sk-should-never-be-accepted",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("connectorId");
    }
  });

  it("loudly rejects an extra token field, naming connectorId in the error", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      token: "sk-should-never-be-accepted",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("connectorId");
    }
  });

  it("loudly rejects an extra password field, naming connectorId in the error", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      password: "sk-should-never-be-accepted",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("connectorId");
    }
  });

  it("loudly rejects an extra credential field, naming connectorId in the error", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      credential: "sk-should-never-be-accepted",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("connectorId");
    }
  });

  it("rejects a request missing connectorId", () => {
    const result = createRestDataSourceSchema.safeParse({ name: "Widgets" });

    expect(result.success).toBe(false);
  });
});
