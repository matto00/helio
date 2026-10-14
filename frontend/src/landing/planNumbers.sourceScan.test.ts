import fs from "fs";
import path from "path";

import { BETA_DAILY_MESSAGE_LIMIT } from "./planNumbers";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

// The landing copy quotes the beta daily message limit. It is inserted into index.html at build time from
// planNumbers.ts; this test pins planNumbers.ts to the backend default it must equal.
describe("landing plan numbers", () => {
  it("quotes the backend's default beta daily message limit", () => {
    const scala = read("backend/src/main/scala/com/helio/services/auth/UserTierConfig.scala");
    const match = /DefaultBetaDailyMessageLimit:\s*Int\s*=\s*(\d+)/.exec(scala);
    expect(match).not.toBeNull();
    expect(BETA_DAILY_MESSAGE_LIMIT).toBe(Number(match?.[1]));
  });

  it("keeps the number out of the landing HTML as a literal, so only the placeholder can carry it", () => {
    const html = read("frontend/index.html");
    expect(html).toContain("%BETA_DAILY_MESSAGE_LIMIT%");
    expect(html).not.toMatch(new RegExp(`\\b${BETA_DAILY_MESSAGE_LIMIT}\\s+messages`));
  });
});
