// Shared helpers for the phone pipeline page tests (HEL-1582): the phone's DOM vocabulary (step rows, the step
// sheet, the header's actions menu) in one place, so page-logic tests that used to reach the river's cards read the
// same in the phone layout. Pair with `installPhoneShell()`; each test file keeps its own render helper and mocks.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex matching a step row's accessible name ("Step <n>: <label>, ...") for a label given as text or a regex. */
export function stepRowName(label: RegExp | string): RegExp {
  const source = typeof label === "string" ? escapeRegExp(label) : label.source;
  return new RegExp(`^Step \\d+: ${source}`, typeof label === "string" ? "" : label.flags);
}

/** Every step row button of the Steps tab, in document order. */
export const stepRows = () => screen.queryAllByRole("button", { name: /^Step \d+:/ });

/** The one step row with this label. */
export const stepRow = (label: RegExp | string) =>
  screen.getByRole("button", { name: stepRowName(label) });

export const findStepRow = (label: RegExp | string) =>
  screen.findByRole("button", { name: stepRowName(label) });

export const queryStepRow = (label: RegExp | string) =>
  screen.queryByRole("button", { name: stepRowName(label) });

/** The open step sheet. Throws when it is closed. */
export const stepSheet = () => screen.getByRole("dialog", { name: "Step editor" });
export const queryStepSheet = () => screen.queryByRole("dialog", { name: "Step editor" });

/** Taps a step row and returns the sheet it opens. */
export function openStepSheet(label: RegExp | string): HTMLElement {
  fireEvent.click(stepRow(label));
  return stepSheet();
}

/** Closes the sheet with its visible close control. */
export async function closeStepSheet() {
  fireEvent.click(within(stepSheet()).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(queryStepSheet()).toBeNull());
}

/** Opens the open sheet's "Step actions" menu and activates `item`. */
export function chooseStepAction(item: string | RegExp) {
  fireEvent.click(within(stepSheet()).getByRole("button", { name: /^Step actions for/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/** Opens the header's "Pipeline actions" menu and activates `item`. */
export function chooseHeaderAction(item: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/** The label of the step the lane holding `label`'s row branches from, or null for a trunk row. A branch lane is a
 *  labelled sub-list ("Lane <n> · from <number> <parent label>"). */
export function laneParentLabel(label: RegExp | string): string | null {
  const lane = stepRow(label).closest(".spine-lane--sub");
  const text = lane?.querySelector(".spine-lane__label")?.textContent ?? null;
  const match = text === null ? null : /from \d+ (.+)$/.exec(text);
  return match === null ? null : match[1];
}

/** jsdom does not implement the dialog methods the palette, the sheet and the other modals use. */
export function stubDialogMethods() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}
