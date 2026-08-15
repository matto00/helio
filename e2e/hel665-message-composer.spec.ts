import { expect, test } from "@playwright/test";

// HEL-665 (reopened composer ticket) — live verification (ticket AC5, tasks.md 6.10). Exercises
// the real message composer against running dev servers with a REAL `ANTHROPIC_API_KEY` (mirrors
// e2e/hel399-shape-instantiate.spec.ts's pattern — run on demand via `npm run e2e`, not part of the
// pre-commit gates). A real typed message reaches `POST /api/assistant-conversations/:id/converse`
// -> `AssistantService.converse` -> the real `ClaudeClient` -> the real Anthropic API, and the
// response renders in the transcript via the existing `MessageTurn` component — not a
// mocked/scripted test. Also exercises the create-then-converse flow (design.md D5): a fresh user
// with zero conversations starts one by typing directly on /chat's empty state.
//
// evaluation-1.md Change Request 1 (cycle 2) — the rendered "You" bubble's text is asserted via an
// EXACT match on `.message-turn__text` (`toHaveText`, not `getByText`'s default substring
// matching), specifically because `getByText` would have passed even with the live-verified defect
// (the polluted text contains the typed message as a trailing substring) — this is exactly why the
// cycle-1 e2e assertion didn't catch it.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel665-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-665 message composer live verification", () => {
  test("a fresh user can start a conversation by typing, and a real Claude response renders", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("composer");
    const password = "correcthorsebattery1";

    await request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-665 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    await page.goto("/chat");
    // Both the sidebar's own empty conversation list AND ActiveConversationPanel's empty state
    // share this copy -- scope to the composer itself (unambiguous, and what this test actually
    // cares about) rather than the shared empty-state text.
    const input = page.getByLabel("Message");
    await expect(input).toBeVisible();
    const typedMessage = "In one short sentence, what is 2+2? Do not use any tools.";
    await input.fill(typedMessage);

    const [converseResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/converse") && r.request().method() === "POST",
        { timeout: 20_000 },
      ),
      page.getByRole("button", { name: "Send" }).click(),
    ]);

    // A real, non-mocked round trip: 200 (never a silently-swallowed failure), and the response
    // body actually carries a real Claude reply (never an empty/fabricated turn).
    expect(converseResponse.status()).toBe(200);
    const body = (await converseResponse.json()) as {
      transcript: Array<{ role: string; content: Array<{ blockType: string; text?: string }> }>;
    };
    expect(body.transcript.length).toBeGreaterThanOrEqual(2);
    // evaluation-1.md CR1 (cycle 2): the persisted first ("user") turn is EXACTLY what was typed,
    // never AssistantSystemPrompt.text folded in ahead of it.
    expect(body.transcript[0].content[0].text).toBe(typedMessage);

    // Renders via the existing MessageTurn component -- an EXACT match on the "You" bubble's own
    // text (not a substring match; see this file's header comment for why that distinction is
    // load-bearing here), plus SOME assistant response text (not asserting exact Claude wording).
    await expect(page.locator(".message-turn--user .message-turn__text").first()).toHaveText(
      typedMessage,
    );
    await expect(page.locator(".message-turn--assistant").last()).toBeVisible();

    // The composer clears its input on a successful send (tasks.md 5.5).
    await expect(input).toHaveValue("");
  });
});
