import fs from "fs";
import path from "path";

import { SIGNED_IN_HINT_KEY } from "../features/auth/state/signedInHint";
import { ThemeStorageKey } from "../theme/theme";
import { CASES } from "./cases";

const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

describe("landing index.html", () => {
  it("reads the same storage keys the app writes", () => {
    expect(html).toContain(`getItem("${SIGNED_IN_HINT_KEY}")`);
    expect(html).toContain(`getItem("${ThemeStorageKey}")`);
  });

  it("carries the hero text and a static first ending without running JS", () => {
    expect(html).toContain("Give me a dashboard for");
    expect(html).toContain("my app's launch week.");
  });

  it("ships a capture pair for every reel case", () => {
    for (const { key } of CASES) {
      expect(html).toContain(`uc-${key}-light.jpg`);
      expect(html).toContain(`uc-${key}-dark.jpg`);
    }
  });

  it("has four verbatim follow-up prompts per case, 24 in all", () => {
    expect(CASES.flatMap((c) => c.hints)).toHaveLength(24);
  });

  it("has no eyebrow or tier label above a heading", () => {
    expect(html).not.toMatch(/class="(eyebrow|tier)"/);
  });

  it("loads no app entry and has no React root", () => {
    expect(html).not.toContain("/src/main.tsx");
    expect(html).not.toContain('id="root"');
  });
});
