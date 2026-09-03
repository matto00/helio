/**
 * HEL-886 tasks.md 4.2 — hostile-input coverage for `create_connector`'s Zod input schema
 * (design.md Decisions 1-4), mirroring `restDataSourceSchema.test.ts`'s coverage.
 */

import { createConnectorSchema } from "./connectorSchema.js";

describe("createConnectorSchema", () => {
  it("accepts a minimal valid credential-less input", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an explicit authType: none", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      authType: "none",
    });

    expect(result.success).toBe(true);
  });

  it("accepts authType: bearer/api_key at the schema layer (refused later, in the handler)", () => {
    for (const authType of ["bearer", "api_key"]) {
      const result = createConnectorSchema.safeParse({
        name: "Sleeper",
        baseUrl: "https://api.sleeper.app",
        authType,
      });
      expect(result.success).toBe(true);
    }
  });

  // evaluation-1.md CR1: `authType` is a free-form `z.string()`, NOT an enum of the three
  // predicted values -- an enum would make any UNPREDICTED value (e.g. "oauth2") die at a bare
  // Zod "Invalid enum value" error before ever reaching `createConnectorHandler`'s actionable
  // /connectors refusal, which is exactly the "bare validation error" AC3/the spec delta rule
  // out. The schema layer therefore ACCEPTS any non-empty authType -- the actionable refusal
  // for a value other than "none" is the handler's job, proven in `connectorHandlers.test.ts`.
  it("accepts an authType value outside the predicted enum (validation deferred to the handler)", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      authType: "oauth2",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty-string authType", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      authType: "",
    });

    expect(result.success).toBe(false);
  });

  // skeptic-final-2.md CR2 (regression from skeptic-final-1.md's fix, now reverted): the
  // single MOST valuable test on this surface. A `.passthrough()`-based unrecognized-key check
  // walks `Object.keys(parsedValue)` -- but assigning `"__proto__"` on a plain object sets the
  // PROTOTYPE, not an own key, so `Object.keys()` never sees it and the field silently rides
  // through, unchecked, into the tool handler. `.strict(MSG)` does not have this hole: Zod's
  // own unrecognized-key detection walks the RAW input's keys before building any output object.
  // This is the exact input that would silently re-open the hole if anyone reaches for
  // `.passthrough()` + a manual key-walk on this schema again -- keep this test even if every
  // other unrecognized-key test here is ever consolidated away.
  it("rejects a __proto__ payload rather than silently accepting/stripping it (regression guard)", () => {
    const hostile = JSON.parse('{"name":"n","baseUrl":"http://x","__proto__":"sk-LEAK"}') as Record<
      string,
      unknown
    >;
    // Confirm the JSON.parse really did create an OWN "__proto__" property (not merely set the
    // object's prototype), matching what a real MCP client's JSON-RPC payload deserializes to.
    expect(Object.prototype.hasOwnProperty.call(hostile, "__proto__")).toBe(true);

    const result = createConnectorSchema.safeParse(hostile);

    expect(result.success).toBe(false);
    if (!result.success) {
      const unrecognized = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
      expect(unrecognized).toBeDefined();
      if (unrecognized && unrecognized.code === "unrecognized_keys") {
        expect(unrecognized.keys).toContain("__proto__");
      }
    }
  });

  // skeptic-final-2.md CR3: the unrecognized-key issue must fire independently of any other
  // field's failure -- Zod's `.strict()` reports BOTH in the same parse, unlike a
  // `.superRefine`-based check chained after the object (which Zod skips once the inner object
  // parse has already produced a hard issue).
  it("reports the unrecognized-key issue ALONGSIDE another field's failure, not instead of it", () => {
    const result = createConnectorSchema.safeParse({ name: "n", secret: "sk-LEAK" }); // baseUrl absent

    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((issue) => issue.code);
      expect(codes).toContain("invalid_type"); // baseUrl: Required
      const unrecognized = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
      expect(unrecognized).toBeDefined();
      if (unrecognized && unrecognized.code === "unrecognized_keys") {
        expect(unrecognized.keys).toContain("secret");
      }
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("/connectors");
    }
  });

  // skeptic-final-2.md (coordinator-approved spec concession): `.strict()`'s message param is a
  // fixed string that cannot interpolate which key was unrecognized -- the offending key lives
  // on `issue.keys` instead (asserted above/below), never in the message string itself.
  it("rejects an unlisted key, naming /connectors in the message and the key in issue.keys", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      defaultHeaders: { Authorization: "Bearer sk-should-never-be-accepted" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("/connectors");
      const unrecognized = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
      expect(unrecognized).toBeDefined();
      if (unrecognized && unrecognized.code === "unrecognized_keys") {
        expect(unrecognized.keys).toContain("defaultHeaders");
      }
      expect(JSON.stringify(result.error.issues)).not.toContain("sk-should-never-be-accepted");
    }
  });

  // skeptic-final-1.md CR1's exact reproduction: an UNPREDICTED credential-shaped key (not one
  // of the five denylisted names, not `defaultHeaders`) -- the case that most needs the pointer,
  // since it is the one nobody thought to name in advance.
  it("rejects an arbitrary unpredicted key (e.g. secret), naming /connectors and the key in issue.keys", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      secret: "sk-should-never-be-accepted",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("/connectors");
      const unrecognized = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
      expect(unrecognized).toBeDefined();
      if (unrecognized && unrecognized.code === "unrecognized_keys") {
        expect(unrecognized.keys).toContain("secret");
      }
      expect(JSON.stringify(result.error.issues)).not.toContain("sk-should-never-be-accepted");
    }
  });

  // skeptic-final-1.md's second live repro: a whole backend-shaped credential envelope, not a
  // flat key.
  it("rejects a config envelope key (e.g. config: {authType: bearer}), naming /connectors and the key in issue.keys", () => {
    const result = createConnectorSchema.safeParse({
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      config: { authType: "bearer" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("/connectors");
      const unrecognized = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
      expect(unrecognized).toBeDefined();
      if (unrecognized && unrecognized.code === "unrecognized_keys") {
        expect(unrecognized.keys).toContain("config");
      }
    }
  });

  for (const field of ["auth", "apiKey", "token", "password", "credential"]) {
    it(`loudly rejects an extra ${field} field, naming the out-of-band path`, () => {
      const result = createConnectorSchema.safeParse({
        name: "Sleeper",
        baseUrl: "https://api.sleeper.app",
        [field]: "sk-should-never-be-accepted",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message).join(" ");
        expect(messages).toContain("/connectors");
        expect(JSON.stringify(result.error.issues)).not.toContain("sk-should-never-be-accepted");
      }
    });
  }

  it("rejects a request missing name", () => {
    const result = createConnectorSchema.safeParse({ baseUrl: "https://api.sleeper.app" });

    expect(result.success).toBe(false);
  });

  it("rejects a request missing baseUrl", () => {
    const result = createConnectorSchema.safeParse({ name: "Sleeper" });

    expect(result.success).toBe(false);
  });
});
