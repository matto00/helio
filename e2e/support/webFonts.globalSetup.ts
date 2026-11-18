import {
  WEB_FONTS_BASELINE_ENV,
  WEB_FONTS_MARKER_HEADER,
  WEB_FONTS_SERVER_ID,
  webFontsMarkerUrl,
  webFontsPort,
  WEB_FONTS_DIR,
  WEB_FONTS_HOSTS,
} from "./webFontsHost";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

// HEL-1757 — see fixtures/web-fonts/README.md. Reads the local fonts server's identity marker (Node-side, validated
// against the committed test cert; the request goes to 127.0.0.1 with the fonts host as the TLS server name).

export interface WebFontsMarker {
  server: string;
  unknownHits: string[];
}

export function readWebFontsMarker(): Promise<WebFontsMarker> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      webFontsMarkerUrl(),
      {
        // Pin the server's identity: trust only the committed self-signed test cert (SAN: the fonts hosts).
        ca: fs.readFileSync(path.join(WEB_FONTS_DIR, "test-cert.pem")),
        servername: WEB_FONTS_HOSTS[0],
        timeout: 5_000,
      },
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
