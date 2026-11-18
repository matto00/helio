import { createHash, X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// HEL-1757: the one place that knows how the e2e browsers reach the local web-fonts server (see
// e2e/fixtures/web-fonts/README.md). playwright.config.ts uses `webFontsLaunchArgs()`; the spec
// hel1757-web-fonts-local.spec.ts imports only the constants, never the args, so it passes only if the config wires them.

export const WEB_FONTS_MARKER_PATH = "/__helio_web_fonts";
export const WEB_FONTS_MARKER_HEADER = "x-helio-e2e-web-fonts";
export const WEB_FONTS_SERVER_ID = "helio-e2e-web-fonts";
/** Set by the fonts global setup (same process as the teardown): unknown-hit count when the run started. */
export const WEB_FONTS_BASELINE_ENV = "HELIO_E2E_WEB_FONTS_BASELINE";
export const WEB_FONTS_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"] as const;
export const WEB_FONTS_DIR = path.resolve(__dirname, "../fixtures/web-fonts");

/** `HELIO_E2E_WEB_FONTS_PORT`, else `DEV_PORT + 20000` (below the 32768 ephemeral range). */
export function webFontsPort(): number {
  const raw = process.env.HELIO_E2E_WEB_FONTS_PORT;
  if (raw !== undefined && raw !== "") {
    if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > 65535) {
      throw new Error(`HELIO_E2E_WEB_FONTS_PORT must be a port number, got "${raw}"`);
    }
    return Number(raw);
  }
  const dev = Number(process.env.DEV_PORT ?? "5173");
  const port = dev + 20000;
  if (!Number.isInteger(dev) || port > 32767) {
    throw new Error(
      `cannot derive the web-fonts port from DEV_PORT=${process.env.DEV_PORT}; set HELIO_E2E_WEB_FONTS_PORT`,
    );
  }
  return port;
}

export function webFontsMarkerUrl(): string {
  return `https://127.0.0.1:${webFontsPort()}${WEB_FONTS_MARKER_PATH}`;
}

/** Base64 sha256 of the committed test certificate's SubjectPublicKeyInfo (what Chromium's SPKI list pins). */
export function webFontsSpkiHash(): string {
  const cert = new X509Certificate(fs.readFileSync(path.join(WEB_FONTS_DIR, "test-cert.pem")));
  const spki = cert.publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64");
}

/** Chromium switches: map both fonts hosts to the local server and trust only its pinned test key. */
export function webFontsLaunchArgs(): string[] {
  const target = `127.0.0.1:${webFontsPort()}`;
  return [
    `--host-rules=${WEB_FONTS_HOSTS.map((h) => `MAP ${h} ${target}`).join(",")}`,
    `--ignore-certificate-errors-spki-list=${webFontsSpkiHash()}`,
  ];
}
