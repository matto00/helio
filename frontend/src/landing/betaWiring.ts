import { BETA_MESSAGES, requestBeta } from "./betaRequest";

function show(status: HTMLElement, outcome: Awaited<ReturnType<typeof requestBeta>>): void {
  status.replaceChildren();
  if (outcome === "signedOut") {
    status.append("Create a free account first. ");
    const link = document.createElement("a");
    link.href = "/register";
    link.textContent = "Start free";
    status.append(link, ".");
    return;
  }
  status.textContent = BETA_MESSAGES[outcome];
}

/** Wires every "Request beta access" button to its adjacent live status region. */
export function initBeta(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-beta]").forEach((button) => {
    const status = button.closest(".cta-block")?.querySelector<HTMLElement>("[data-beta-status]");
    if (!status) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Sending your request…";
      try {
        show(status, await requestBeta());
      } finally {
        button.disabled = false;
      }
    });
  });
}
