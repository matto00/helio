/**
 * HEL-1709 task 6.2: a REAL browser through `/connect/mcp`, starting signed out, on the password + MFA
 * path for a throwaway user (MFA enrolled through the API, the TOTP computed here), back to the consent
 * page, Allow, and on to a working `/mcp` call with the issued token.
 *
 * Prerequisites (this is an evidence script, not a CI test):
 *   - backend at BACKEND_URL, frontend dev server at APP_URL built WITH VITE_MCP_ORIGIN=http://127.0.0.1:19777
 *     (start both with scripts/concertino/start-servers.sh, passing VITE_MCP_ORIGIN in the environment)
 *   - `npm run build` in helio-mcp
 *   BACKEND_URL=http://localhost:10048 APP_URL=http://localhost:7141 SHOT_DIR=<dir> npx tsx e2e/connectMcpBrowser.ts
 *
 * Playwright comes from the repo root; it is imported by a computed specifier so helio-mcp's own
 * typecheck (which does not install it) is unaffected. No PAT, token or key is printed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";

const BACKEND = (process.env.BACKEND_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const APP = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const MCP_PORT = 19777;
const MCP = `http://127.0.0.1:${MCP_PORT}`;
const REDIRECT = "http://127.0.0.1:19888/cb";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const CSRF = { "X-Helio-Requested-With": "1" };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = (mac[mac.length - 1] as number) & 0xf;
  const n = mac.readUInt32BE(off) & 0x7fffffff;
  return String(n % 1_000_000).padStart(6, "0");
}

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const email = `hel1709-browser-${randomBytes(4).toString("hex")}@example.com`;
  const password = randomBytes(12).toString("hex");

  // Setup (out of band): register, enrol MFA.
  const reg = await fetch(`${BACKEND}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "HEL-1709 browser" }),
  });
  if (reg.status !== 201) throw new Error(`register: HTTP ${reg.status}`);
  const cookie = (
    reg.headers.getSetCookie().find((c) => c.startsWith("helio_session=")) ?? ""
  ).split(";")[0] as string;
  const enroll = await fetch(`${BACKEND}/api/auth/mfa/enroll`, {
    method: "POST",
    headers: { Cookie: cookie, ...CSRF },
  });
  const { secret } = (await enroll.json()) as { secret: string };
  const confirm = await fetch(`${BACKEND}/api/auth/mfa/enroll/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...CSRF },
    body: JSON.stringify({ code: totp(secret) }),
  });
  check(
    "setup: MFA enrolled for the throwaway user",
    confirm.status === 200,
    `HTTP ${confirm.status}`,
  );

  const child: ChildProcess = spawn("node", ["dist/http.js"], {
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      PORT: String(MCP_PORT),
      HELIO_MCP_PUBLIC_URL: MCP,
      HELIO_APP_URL: APP,
      HELIO_API_BASE_URL: BACKEND,
      HELIO_MCP_TOKEN_KEY: randomBytes(32).toString("base64"),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  // Stand-in for the connector client's redirect URI: records where the browser ended up.
  let landed: string | undefined;
  const clientCallback = createServer((req, res) => {
    landed = `http://127.0.0.1:19888${req.url ?? ""}`;
    res.writeHead(200, { "Content-Type": "text/plain" }).end("client callback reached");
  });
  await new Promise<void>((r) => clientCallback.listen(19888, "127.0.0.1", r));
  const mod = "@playwright/test";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = (await import(mod)) as { chromium: any };
  const browser = await chromium.launch();
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const client = (await (
      await fetch(`${MCP}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Browser e2e client" }),
      })
    ).json()) as { client_id: string };
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL(`${MCP}/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "browser-state",
    }))
      authorize.searchParams.set(k, v);

    let storage: unknown;
    for (const scheme of ["light"] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      await context.addInitScript(`localStorage.setItem("helio-theme", "light")`);
      const page = await context.newPage();
      // Signed out -> /authorize -> consent URL -> ProtectedRoute -> /login
      await page.goto(authorize.href);
      await page.waitForURL(/\/login/);
      check(
        `${scheme}: signed-out visitor is sent to /login`,
        true,
        page.url().replace(/request=[^&]+/, "request=..."),
      );
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.click("button[type=submit]");
      await page.waitForURL(/\/login\/verify/);
      check(`${scheme}: password step leads to the MFA step`, true);
      // The enrolment confirm already consumed the current 30 s step (replay protection): use the next one.
      await page.fill("#mfa-code", totp(secret, Date.now() + 30_000));
      await page.click("button[type=submit]");
      await page.waitForURL(/\/connect\/mcp\?request=/, { timeout: 10000 }).catch(async () => {
        console.log(
          `DEBUG url=${page.url().replace(/request=[^&]+/, "request=...")} text=${(await page.locator("body").innerText()).slice(0, 300)}`,
        );
        await page.screenshot({ path: `${SHOT_DIR}/debug-${scheme}.png` });
        throw new Error("did not return to the consent page");
      });
      check(`${scheme}: after MFA the visitor is back on /connect/mcp?request=...`, true);

      await page.bringToFront();
      await page.getByText("Browser e2e client").waitFor();
      check(
        `${scheme}: page shows client name and redirect host`,
        (await page.getByText("127.0.0.1:19888").count()) > 0,
      );
      await page.waitForTimeout(600); // let the card entrance animation finish
      await page.screenshot({ path: `${SHOT_DIR}/consent-${scheme}.png` });
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Allow" }).click();
      await page.waitForURL(`${REDIRECT.replace(/\/cb$/, "")}/**`);
      const code = new URL(landed ?? "http://invalid").searchParams.get("code");
      check(
        `${scheme}: Allow ends at the client's redirect URI with a code and state`,
        !!code && new URL(landed as string).searchParams.get("state") === "browser-state",
      );
      storage = await context.storageState();
      await context.close();

      if (scheme === "light") {
        const tok = await fetch(`${MCP}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: client.client_id,
            code: code ?? "",
            code_verifier: verifier,
            redirect_uri: REDIRECT,
          }).toString(),
        });
        const access = ((await tok.json()) as { access_token?: string }).access_token;
        check(
          "token exchange succeeds for the browser-issued code",
          tok.status === 200 && !!access,
        );
        const list = await fetch(`${MCP}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${access}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        check("/mcp tools/list works with the browser-issued token", list.status === 200);
        const tokens = (await (
          await fetch(`${BACKEND}/api/tokens`, { headers: { Cookie: cookie } })
        ).json()) as {
          name: string;
          expiresAt?: string;
        }[];
        const mine = tokens.filter((t) => t.name.startsWith("MCP connector: Browser e2e client"));
        check(
          "Settings token list has exactly one named, expiring connector PAT",
          mine.length === 1 && !!mine[0]?.expiresAt,
          mine[0]?.name ?? "none",
        );
      }
    }

    // Dark theme, already signed in (session reused): consent shows directly; Deny returns access_denied.
    const darkCtx = await browser.newContext({ colorScheme: "dark", storageState: storage });
    await darkCtx.addInitScript(`localStorage.setItem("helio-theme", "dark")`);
    const dark = await darkCtx.newPage();
    landed = undefined;
    await dark.goto(authorize.href);
    await dark.waitForURL(/\/connect\/mcp\?request=/);
    await dark.bringToFront();
    await dark.getByText("Browser e2e client").waitFor();
    await dark.screenshot({ path: `${SHOT_DIR}/consent-dark.png` });
    check("dark: signed-in visitor goes straight to the consent page", true);
    const before = (
      (await (
        await fetch(`${BACKEND}/api/tokens`, { headers: { Cookie: cookie } })
      ).json()) as unknown[]
    ).length;
    await dark.waitForTimeout(800);
    await dark.getByRole("button", { name: "Deny" }).click();
    await dark.waitForURL("http://127.0.0.1:19888/**");
    const denied = new URL(landed ?? "http://invalid");
    check(
      "dark: Deny returns access_denied with state and no code",
      denied.searchParams.get("error") === "access_denied" && !denied.searchParams.get("code"),
    );
    const after = (
      (await (
        await fetch(`${BACKEND}/api/tokens`, { headers: { Cookie: cookie } })
      ).json()) as unknown[]
    ).length;
    check("dark: Deny minted no PAT", after === before, `${before} -> ${after}`);
    await darkCtx.close();
  } finally {
    // CONTRIBUTING.md (HEL-846 rule 2): revoke every connector PAT the Allow click(s) minted.
    try {
      const list = await fetch(`${BACKEND}/api/tokens`, { headers: { Cookie: cookie } });
      const all = (await list.json()) as { id: string; name: string }[];
      for (const t of all.filter((x) => x.name.startsWith("MCP connector: Browser e2e client"))) {
        const del = await fetch(`${BACKEND}/api/tokens/${t.id}`, {
          method: "DELETE",
          headers: { Cookie: cookie, ...CSRF },
        });
        console.log(`cleanup: PAT ${t.id} revoke -> HTTP ${del.status}`);
      }
    } catch (err) {
      console.log(`cleanup failed: ${(err as Error).message}`);
    }
    await browser.close();
    clientCallback.close();
    child.kill("SIGTERM");
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`browser e2e crashed: ${(err as Error).message}`);
  process.exit(2);
});
