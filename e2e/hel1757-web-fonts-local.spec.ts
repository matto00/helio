import { expect, test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { renderedFaces } from "./support/homeLoadProbe";
import { waitForWebFonts } from "./support/webFonts";
import { WEB_FONTS_DIR, WEB_FONTS_HOSTS, WEB_FONTS_MARKER_HEADER } from "./support/webFontsHost";

// HEL-1757 — e2e browsers never depend on the third-party fonts hosts, and still render the real web fonts.
//
// The shared mechanism (playwright.config.ts: Chromium --host-rules + SPKI pin, local server) is what is under test,
// so this file NEVER imports the launch switches: it only appends a STALLED upstream (`--host-resolver-rules` to a
// TCP black hole that accepts and never answers; the resolver layer sits below `--host-rules`) to the INHERITED
// launch options. It passes only if the config routes the fonts hosts to the local server; with the wiring disabled
// (`HELIO_E2E_WEB_FONTS_LOCAL=0`) the bare `page.goto` below times out on the stall, exactly the HEL-1754 hang.

interface Hole {
  port: number;
  connections: () => number;
}

const test = base.extend<object, { hole: Hole }>({
  hole: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      let count = 0;
      const sockets = new Set<net.Socket>();
      const server = net.createServer((socket) => {
        count += 1;
        sockets.add(socket);
        socket.on("error", () => undefined);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as net.AddressInfo).port;
      await use({ port, connections: () => count });
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
    { scope: "worker" },
  ],
  launchOptions: [
    async ({ launchOptions, hole }, use) => {
      const stall = `--host-resolver-rules=${WEB_FONTS_HOSTS.map((h) => `MAP ${h} 127.0.0.1:${hole.port}`).join(",")}`;
      await use({ ...launchOptions, args: [...(launchOptions.args ?? []), stall] });
    },
    { scope: "worker" },
  ],
});

// The elements this spec reads. Fraunces and JetBrains Mono 700 are only rasterised when laid-out text uses them
// (the login page has none), so the spec renders its own probe elements in the three families at weight 700.
const PROBES = [
  { id: "probe-schibsted", family: "Schibsted Grotesk" },
  { id: "probe-fraunces", family: "Fraunces" },
  { id: "probe-jetbrains", family: "JetBrains Mono" },
] as const;

async function expectLocalWebFonts(page: Page, hole: Hole, fontResponses: string[]) {
  await page.evaluate((probes) => {
    const box = document.createElement("div");
    for (const p of probes) {
      const el = document.createElement("p");
      el.id = p.id;
      el.textContent = "Hamburgefonstiv 0123456789";
      el.style.cssText = `font: 700 24px "${p.family}", monospace; font-synthesis: none`;
      box.append(el);
    }
    document.body.append(box);
  }, PROBES);
  // Settled faces, never just `document.fonts.ready` (vacuously true before the stylesheet applies).
  await waitForWebFonts(page.locator("#probe-fraunces"));
  for (const p of PROBES) {
    await expect
      .poll(
        async () =>
          (await renderedFaces(page, `#${p.id}`)).map((f) => `${f.familyName}:${f.isCustomFont}`),
        {
          message: `${p.family} 700 rasterised as a web face`,
          timeout: 10_000,
        },
      )
      .toEqual([`${p.family}:true`]);
  }
  expect(hole.connections(), "the stalled upstream received no connection").toBe(0);
  expect(fontResponses.length, "fonts responses seen").toBeGreaterThan(0);
  expect(
    fontResponses.every((h) => h === "local"),
    "every fonts response came from the local server",
  ).toBe(true);
}

function watchFonts(page: Page): string[] {
  const seen: string[] = [];
  page.on("response", (res) => {
    if (WEB_FONTS_HOSTS.includes(new URL(res.url()).hostname as (typeof WEB_FONTS_HOSTS)[number])) {
      seen.push(res.headers()[WEB_FONTS_MARKER_HEADER] ?? "missing");
    }
  });
  return seen;
}

test.describe("HEL-1757 web fonts are served locally", () => {
  test("a bare page.goto completes with the upstream stalled, and the web faces rasterise", async ({
    page,
    hole,
  }) => {
    const seen = watchFonts(page);
    await page.goto("/login"); // default `load` wait: the HEL-1754 hang
    await expectLocalWebFonts(page, hole, seen);
  });

  test("the same in a context the spec creates itself", async ({ browser, hole }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const seen = watchFonts(page);
      await page.goto("/login");
      await expectLocalWebFonts(page, hole, seen);
    } finally {
      await context.close();
    }
  });

  test("the same with a page route that continues every request", async ({ page, hole }) => {
    await page.route("**/*", (route) => route.continue());
    const seen = watchFonts(page);
    await page.goto("/login");
    await expectLocalWebFonts(page, hole, seen);
  });
});

// Guard (no browser): the committed copy covers every font URL the app requests, and nothing fetches a fonts host
// from Node, where browser switches do not apply.
test.describe("HEL-1757 committed copy guard", () => {
  const repo = path.resolve(__dirname, "..");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(WEB_FONTS_DIR, "manifest.json"), "utf8"),
  ) as {
    css: Record<string, { file: string }>;
    fonts: Record<string, { file: string }>;
  };

  test("every css2 URL in the app HTML entries has a committed stylesheet", () => {
    const missing: string[] = [];
    for (const html of ["frontend/app.html", "frontend/index.html"]) {
      const text = fs.readFileSync(path.join(repo, html), "utf8");
      for (const m of text.matchAll(/https:\/\/fonts\.googleapis\.com(\/css2\?[^"'\s]+)/g)) {
        const key = decodeURIComponent(m[1].replaceAll("&amp;", "&"));
        const entry = manifest.css[key];
        if (!entry || !fs.existsSync(path.join(WEB_FONTS_DIR, "files", entry.file)))
          missing.push(`${html}: ${key}`);
      }
    }
    expect(
      missing,
      "app font URL with no committed stylesheet (run e2e/fixtures/web-fonts/refresh.mjs)",
    ).toEqual([]);
  });

  test("every font file a committed stylesheet references is committed", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(manifest.css)) {
      const css = fs.readFileSync(path.join(WEB_FONTS_DIR, "files", entry.file), "utf8");
      for (const m of css.matchAll(/https:\/\/fonts\.gstatic\.com(\/[^)\s'"]+)/g)) {
        const font = manifest.fonts[m[1]];
        if (!font || !fs.existsSync(path.join(WEB_FONTS_DIR, "files", font.file)))
          missing.push(`${key} -> ${m[1]}`);
      }
    }
    expect(
      missing,
      "font file with no committed copy (run e2e/fixtures/web-fonts/refresh.mjs)",
    ).toEqual([]);
  });

  test("no e2e file requests a fonts host from Node", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "fixtures" && entry.name !== "node_modules") walk(full);
        } else if (/\.(ts|mjs|cjs)$/.test(entry.name) && !entry.name.startsWith("hel1757-")) {
          const text = fs.readFileSync(full, "utf8");
          if (
            /(route\.fetch|request\.(get|post|put|patch|delete|head|fetch)|fetch)\s*\(\s*[^)]*fonts\.(googleapis|gstatic)\.com/.test(
              text,
            )
          ) {
            offenders.push(path.relative(repo, full));
          }
        }
      }
    };
    walk(__dirname);
    expect(offenders).toEqual([]);
  });
});
