import { WEB_FONTS_BASELINE_ENV } from "./webFontsHost";
import { readWebFontsMarker } from "./webFonts.globalSetup";

// HEL-1757 — fails the run when the local fonts server died mid-run (browsers silently fell back to the system
// face), was replaced by a foreign listener, or answered a fonts URL it has no committed copy of.
export default async function globalTeardown(): Promise<void> {
  const baseline = Number(process.env[WEB_FONTS_BASELINE_ENV] ?? "0");
  const marker = await readWebFontsMarker();
  const fresh = marker.unknownHits.slice(baseline);
  if (fresh.length > 0) {
    throw new Error(
      `[HEL-1757] ${fresh.length} fonts request(s) had no committed copy in e2e/fixtures/web-fonts (run refresh.mjs or fix the URL): ${[...new Set(fresh)].join(", ")}`,
    );
  }
}
