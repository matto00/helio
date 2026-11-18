import {
  WEB_FONTS_BASELINE_ENV,
  WEB_FONTS_MARKER_HEADER,
  WEB_FONTS_SERVER_ID,
  webFontsMarkerUrl,
  webFontsPort,
} from "./webFontsHost";
import https from "node:https";

// HEL-1757 — see fixtures/web-fonts/README.md. Reads the local fonts server's identity marker (Node-side, so
// certificate pinning is skipped: this request is to 127.0.0.1, not a fonts host).

export interface WebFontsMarker {
  server: string;
  unknownHits: string[];
}

export function readWebFontsMarker(): Promise<WebFontsMarker> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      webFontsMarkerUrl(),
      { rejectUnauthorized: false, timeout: 5_000 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body) as WebFontsMarker;
            if (
              res.headers[WEB_FONTS_MARKER_HEADER] !== "local" ||
              parsed.server !== WEB_FONTS_SERVER_ID
            ) {
              throw new Error("marker header or body missing");
            }
            resolve(parsed);
          } catch (e) {
            reject(
              new Error(
                `web-fonts server check failed on ${webFontsMarkerUrl()}: ${(e as Error).message} (status ${res.statusCode}; a foreign listener on the port? set HELIO_E2E_WEB_FONTS_PORT)`,
              ),
            );
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) =>
      reject(new Error(`web-fonts server unreachable at ${webFontsMarkerUrl()}: ${e.message}`)),
    );
  });
}

export default async function globalSetup(): Promise<void> {
  const base = process.env.PLAYWRIGHT_TEST_BASE_URL;
  if (base && new URL(base).port === String(webFontsPort())) {
    throw new Error(`PLAYWRIGHT_TEST_BASE_URL (${base}) points at the web-fonts server port`);
  }
  const marker = await readWebFontsMarker();
  process.env[WEB_FONTS_BASELINE_ENV] = String(marker.unknownHits.length);
}
