import { randomBytes } from "node:crypto";
import { open, seal, SealError, type SealKeys } from "./seal.js";

const keys = (): SealKeys => ({ current: randomBytes(32) });
const NOW = 1_800_000_000_000;

describe("seal", () => {
  it("round-trips a payload", () => {
    const k = keys();
    const token = seal(k, "access", { pat: "x", n: 1 }, 60, NOW);
    expect(open(k, "access", token, NOW)).toMatchObject({ pat: "x", n: 1, kind: "access" });
  });

  it("rejects a one-byte tamper", () => {
    const k = keys();
    const token = seal(k, "code", { a: 1 }, 60, NOW);
    const raw = Buffer.from(token.split(".")[2] as string, "base64url");
    raw[0] = (raw[0] as number) ^ 1;
    const [v, iv] = token.split(".");
    expect(() => open(k, "code", `${v}.${iv}.${raw.toString("base64url")}`, NOW)).toThrow(
      SealError,
    );
  });

  it("rejects a seal opened as another kind", () => {
    const k = keys();
    const token = seal(k, "code", { a: 1 }, 60, NOW);
    expect(() => open(k, "access", token, NOW)).toThrow(SealError);
  });

  it("rejects an expired seal and writes exp in seconds", () => {
    const k = keys();
    const token = seal(k, "pending", {}, 600, NOW);
    const body = open<{ exp: number }>(k, "pending", token, NOW);
    expect(body.exp).toBe(NOW / 1000 + 600);
    expect(() => open(k, "pending", token, NOW + 601_000)).toThrow("seal expired");
    expect(() => open(k, "pending", token, NOW + 599_000)).not.toThrow();
  });

  it("never expires a client seal and stores no exp", () => {
    const k = keys();
    const token = seal(k, "client", { n: 1 }, 1, NOW);
    const body = open(k, "client", token, NOW + 10 * 365 * 86_400_000);
    expect(body).not.toHaveProperty("exp");
  });

  it("opens with the previous key but seals with the current one", () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const legacy = seal({ current: oldKey }, "access", { a: 1 }, 60, NOW);
    expect(open({ current: newKey, previous: oldKey }, "access", legacy, NOW)).toMatchObject({
      a: 1,
    });
    expect(() => open({ current: newKey }, "access", legacy, NOW)).toThrow(SealError);
    const fresh = seal({ current: newKey, previous: oldKey }, "access", { a: 2 }, 60, NOW);
    expect(open({ current: newKey }, "access", fresh, NOW)).toMatchObject({ a: 2 });
    expect(() => open({ current: oldKey }, "access", fresh, NOW)).toThrow(SealError);
  });

  it("rejects malformed input", () => {
    const k = keys();
    for (const bad of ["", "v1.a.b", "x.y.z", "v1..", "v2.AAAA.AAAA"]) {
      expect(() => open(k, "access", bad, NOW)).toThrow(SealError);
    }
  });
});
