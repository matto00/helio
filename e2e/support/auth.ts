import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { isolateLivePage, uiLogin } from "./isolateLivePage";

// HEL-1330 — the one shared "register a throwaway user, then (optionally) log in through the UI"
// helper. It replaces the ~32 near-identical local `registerAndLogin` copies the e2e specs grew;
// each call site passes exactly the flags its former local copy had, so behaviour is preserved.

export const CSRF_HEADER = "X-Helio-Requested-With";
export const TEST_PASSWORD = "correcthorsebattery1";

export interface Credentials {
  email: string;
  password: string;
}

export interface RegisterUserOptions {
  /** Email prefix, e.g. `hel1003` -> `hel1003-<label>-<ts>-<rand>@example.test`. */
  prefix: string;
  /** Optional label spliced into the email and appended to `displayName`. */
  label?: string;
  /** Display name; `label` is appended (space-separated) when given. */
  displayName: string;
  /** Email domain. Defaults to `example.test`; some specs have always used `example.com`. */
  domain?: string;
  /** Log `[HEL-1300 e2e] throwaway user: <email>` (default true). Pass false where the caller logs. */
  logEmail?: boolean;
}

export interface RegisterAndLoginOptions extends RegisterUserOptions {
  /** After login, wait for the authenticated shell's "Add dashboard" button (default false). */
  waitForShell?: boolean;
  /** After login (and after the shell wait), idle the page on about:blank (default false). */
  isolate?: boolean;
}

/**
 * `prefix-<label>-<ts>-<rand>@domain`; with no label exactly `prefix-<ts>-<rand>@domain`
 * (no doubled dash), the shape the label-less specs always used.
 */
export function uniqueEmail(prefix: string, label?: string, domain = "example.test"): string {
  const labelPart = label === undefined ? "" : `${label}-`;
  return `${prefix}-${labelPart}${Date.now()}-${Math.floor(Math.random() * 100000)}@${domain}`;
}

/** Registers a fresh user over the API (asserts 201); the session cookie lands on `request`. */
export async function registerUser(
  request: APIRequestContext,
  options: RegisterUserOptions,
): Promise<Credentials> {
  const { prefix, label, displayName, domain, logEmail = true } = options;
  const email = uniqueEmail(prefix, label, domain);
  if (logEmail) console.log(`[HEL-1300 e2e] throwaway user: ${email}`);
  const password = TEST_PASSWORD;
  const res = await request.post("/api/auth/register", {
    data: {
      email,
      password,
      displayName: label === undefined ? displayName : `${displayName} ${label}`,
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return { email, password };
}

/**
 * Register -> UI login -> (`waitForShell`) wait for "Add dashboard" -> (`isolate`) idle on
 * about:blank. The order is fixed: isolate-then-wait is impossible (blank page). Pass `isolate`
 * before any API seeding that must not race the live `/` (HEL-1289 / HEL-1300).
 */
export async function registerAndLogin(
  page: Page,
  request: APIRequestContext,
  options: RegisterAndLoginOptions,
): Promise<Credentials> {
  const { waitForShell = false, isolate = false, ...registerOptions } = options;
  const credentials = await registerUser(request, registerOptions);
  await uiLogin(page, credentials);
  if (waitForShell) {
    await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
  }
  if (isolate) await isolateLivePage(page);
  return credentials;
}
