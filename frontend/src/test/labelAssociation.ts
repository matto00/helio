// HEL-1464 — shared assertions for "this visible <label> really targets its control".
//
// `getByLabelText` also matches `aria-label`, so for a label whose text equals its control's
// `ariaLabel` it passes even when the label's own `htmlFor` points at nothing. These helpers go
// through the `<label>` element itself: its `htmlFor` must be non-empty and resolve (by id) to the
// intended control.

import { screen, within } from "@testing-library/react";

/** Every `<label>` whose text is exactly `labelText`, in document order. */
export function labelsWithText(labelText: string): HTMLLabelElement[] {
  return screen.getAllByText(labelText, { selector: "label" }) as HTMLLabelElement[];
}

/** The label's `htmlFor` resolves to the element found by `role` + `accessibleName`. */
export function expectLabelTargetsControl(
  labelText: string,
  role: "combobox" | "spinbutton",
  accessibleName: string,
  scope: HTMLElement = document.body,
): HTMLElement {
  const label = within(scope).getByText(labelText, { selector: "label" }) as HTMLLabelElement;
  expect(label.htmlFor).not.toBe("");
  const control = within(scope).getByRole(role, { name: accessibleName });
  expect(document.getElementById(label.htmlFor)).toBe(control);
  // The ticket's literal check: the visible label text also finds the control.
  expect(within(scope).getByLabelText(labelText)).toBe(control);
  return control;
}

/** Two mounted instances of a component never share a label target id (and none is empty). */
export function expectDistinctNonEmptyLabelIds(labelText: string, count = 2): void {
  const ids = labelsWithText(labelText).map((l) => l.htmlFor);
  expect(ids).toHaveLength(count);
  for (const id of ids) expect(id).not.toBe("");
  expect(new Set(ids).size).toBe(count);
}
