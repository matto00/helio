import { BETA_MESSAGES, requestBeta } from "./betaRequest";
import { initBeta } from "./betaWiring";

const respond = (status: number) => jest.fn().mockResolvedValue({ status } as Response);

describe("requestBeta", () => {
  it.each([
    [204, "success"],
    [401, "signedOut"],
    [409, "alreadyBeta"],
    [429, "cooldown"],
    [503, "unavailable"],
    [500, "error"],
    [502, "error"],
  ] as const)("maps %i to %s", async (status, outcome) => {
    expect(await requestBeta(respond(status))).toBe(outcome);
  });

  it("maps a network failure to a retryable error", async () => {
    expect(await requestBeta(jest.fn().mockRejectedValue(new TypeError("offline")))).toBe("error");
  });

  it("posts with credentials and the CSRF header, and no body", async () => {
    const fetchImpl = respond(204);
    await requestBeta(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/beta-access/request", {
      method: "POST",
      credentials: "include",
      headers: { "X-Helio-Requested-With": "1" },
    });
  });
});

describe("beta button wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="cta-block">
        <button type="button" data-beta>Request beta access</button>
        <p data-beta-status role="status" aria-live="polite"></p>
      </div>`;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  async function click(status: number | Error) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = jest.fn(async () => {
      await gate;
      if (status instanceof Error) throw status;
      return { status } as Response;
    }) as typeof fetch;
    initBeta();
    const button = document.querySelector<HTMLButtonElement>("[data-beta]")!;
    button.click();
    const duringFlight = button.disabled;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      button,
      duringFlight,
      text: document.querySelector("[data-beta-status]")!.textContent,
    };
  }

  it("disables the button while the request is in flight and re-enables it after", async () => {
    const { button, duringFlight } = await click(204);
    expect(duringFlight).toBe(true);
    expect(button.disabled).toBe(false);
  });

  it("shows the create-a-free-account message with a /register link on 401", async () => {
    await click(401);
    const status = document.querySelector("[data-beta-status]")!;
    expect(status.textContent).toContain("Create a free account first");
    expect(status.querySelector("a")?.getAttribute("href")).toBe("/register");
  });

  it.each([
    [204, BETA_MESSAGES.success],
    [409, BETA_MESSAGES.alreadyBeta],
    [429, BETA_MESSAGES.cooldown],
    [503, BETA_MESSAGES.unavailable],
  ])("announces the %i outcome in the live region", async (status, message) => {
    const { text } = await click(status);
    expect(text).toBe(message);
  });

  it("announces a generic error on a network failure", async () => {
    const { text } = await click(new TypeError("offline"));
    expect(text).toBe(BETA_MESSAGES.error);
  });
});
