// HEL-1172 — the per-pipeline rows of a multi-denial toast: links, per-row run actions, computed
// ARIA, Tab order and keyboard focus after a row action is consumed (design.md D5/D8).

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import {
  consumeToastItemAction,
  dismissToast,
  pushToast,
  toastsReducer,
  type ToastInput,
} from "../../features/toasts/state/toastsSlice";
import { ToastViewport } from "./Toast";

function setup(withMain = true) {
  const store = configureStore({
    reducer: { toasts: toastsReducer },
    // Row action closures are intentionally non-serializable (store.ts ignores them; store.test.ts covers that).
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <MemoryRouter>{children}</MemoryRouter>
      </Provider>
    );
  }
  render(
    <>
      {withMain && (
        <main id="app-main-content">
          <button type="button">Submit</button>
        </main>
      )}
      {!withMain && <button type="button">Submit</button>}
      <ToastViewport />
    </>,
    { wrapper: Wrapper },
  );
  return { store };
}

/** Pushes a two-row toast whose row actions consume themselves, as the real caller wires them. */
function pushTwoRows(
  store: ReturnType<typeof setup>["store"],
  opts: { runnable: [boolean, boolean]; onRun?: (id: string) => void } = { runnable: [true, true] },
) {
  const base: ToastInput = {
    variant: "warning",
    message: "Alpha: reason a\nBeta: reason b",
    duration: 0,
    items: [],
  };
  const probe = pushToast(base);
  const toastId = probe.payload.id;
  const mk = (key: string, name: string, text: string, runnable: boolean) => ({
    key,
    linkLabel: name,
    linkTo: `/pipelines/${key}`,
    text,
    action: runnable
      ? {
          label: "Run to update",
          onClick: () => {
            opts.onRun?.(key);
            store.dispatch(consumeToastItemAction({ toastId, key }));
          },
        }
      : undefined,
  });
  act(() => {
    store.dispatch({
      ...probe,
      payload: {
        ...probe.payload,
        items: [
          mk("p1", "Alpha", "reason a", opts.runnable[0]),
          mk("p2", "Beta", "reason b", opts.runnable[1]),
        ],
      },
    });
  });
  return toastId;
}

describe("ToastViewport per-row items (HEL-1172)", () => {
  it("renders each row's pipeline name as a link to its page with the reason beside it", () => {
    const { store } = setup();
    pushTwoRows(store);

    const list = screen.getByRole("list", { name: "Pipelines not updated" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const alpha = within(rows[0]).getByRole("link", { name: "Alpha" });
    expect(alpha).toHaveAttribute("href", "/pipelines/p1");
    expect(within(rows[1]).getByRole("link", { name: "Beta" })).toHaveAttribute(
      "href",
      "/pipelines/p2",
    );
    expect(within(rows[0]).getByText("reason a")).toBeVisible();
  });

  it("names each run button 'Run to update: <pipeline>' and describes it with the row reason", () => {
    const { store } = setup();
    pushTwoRows(store);

    const a = screen.getByRole("button", { name: "Run to update: Alpha" });
    const b = screen.getByRole("button", { name: "Run to update: Beta" });
    expect(a).toHaveAccessibleDescription("reason a");
    expect(b).toHaveAccessibleDescription("reason b");
  });

  it("a row whose pipeline cannot be run has the link but no button", () => {
    const { store } = setup();
    pushTwoRows(store, { runnable: [true, false] });

    expect(screen.getByRole("button", { name: "Run to update: Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run to update: Beta" })).toBeNull();
    expect(screen.getByRole("link", { name: "Beta" })).toBeInTheDocument();
  });

  it("does not render the aggregate message visibly when rows are shown", () => {
    const { store } = setup();
    pushTwoRows(store);
    const region = screen.getByRole("region", { name: "Notifications" });
    // The aggregate lives only in the live region; the card's own paragraph is hidden.
    expect(within(region).getByText(/Alpha: reason a/, { selector: "p" })).not.toBeVisible();
  });

  it("keeps DOM tab order: link, button, next row's link, button, then dismiss", () => {
    const { store } = setup();
    pushTwoRows(store);
    const region = screen.getByRole("region", { name: "Notifications" });
    const order = Array.from(region.querySelectorAll<HTMLElement>("a, button")).map(
      (el) => el.getAttribute("aria-label") ?? el.textContent,
    );
    expect(order).toEqual([
      "Alpha",
      "Run to update: Alpha",
      "Beta",
      "Run to update: Beta",
      "Dismiss notification",
    ]);
  });

  it("clicking a row button calls only that row's handler and does not dismiss other rows", () => {
    const { store } = setup();
    const onRun = jest.fn();
    pushTwoRows(store, { runnable: [true, true], onRun });

    fireEvent.click(screen.getByRole("button", { name: "Run to update: Beta" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("p2");
    expect(screen.getByRole("button", { name: "Run to update: Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run to update: Beta" })).toBeNull();
    expect(store.getState().toasts.items).toHaveLength(1);
  });

  it("a toast without items renders exactly as before (no list)", () => {
    const { store } = setup();
    act(() => {
      store.dispatch(pushToast({ variant: "info", message: "Plain." }));
    });
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent("Plain.");
  });
});

describe("focus after a row action is consumed (HEL-1172 D8)", () => {
  /** Focus moves from `Submit` into the toast, as a keyboard user entering the region would. */
  function enter(el: HTMLElement) {
    act(() => screen.getByRole("button", { name: "Submit" }).focus());
    act(() => el.focus());
  }

  it("lands on the activated row's own link while other rows remain", () => {
    const { store } = setup();
    pushTwoRows(store);
    const btn = screen.getByRole("button", { name: "Run to update: Alpha" });
    enter(btn);

    fireEvent.click(btn);

    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Alpha" }));
    expect(document.body).not.toBe(document.activeElement);
  });

  it("returns to the control focused before entering the toast when the last action is used", () => {
    const { store } = setup();
    pushTwoRows(store, { runnable: [true, false] });
    const btn = screen.getByRole("button", { name: "Run to update: Alpha" });
    enter(btn);

    fireEvent.click(btn);

    expect(store.getState().toasts.items).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Submit" }));
  });

  it("falls to another toast's control when the pre-entry element is gone", () => {
    const { store } = setup();
    act(() => {
      store.dispatch(
        pushToast({
          variant: "info",
          message: "Other",
          duration: 0,
          action: { label: "Keep", onClick: () => {} },
        }),
      );
    });
    pushTwoRows(store, { runnable: [true, false] });
    const btn = screen.getByRole("button", { name: "Run to update: Alpha" });
    enter(btn);
    // The element that had focus before entry is removed from the page.
    screen.getByRole("button", { name: "Submit" }).remove();

    fireEvent.click(btn);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
  });

  it("falls to the main landmark when nothing else can take focus, never body", () => {
    const { store } = setup();
    pushTwoRows(store, { runnable: [true, false] });
    const btn = screen.getByRole("button", { name: "Run to update: Alpha" });
    enter(btn);
    screen.getByRole("button", { name: "Submit" }).remove();

    fireEvent.click(btn);

    const main = document.getElementById("app-main-content");
    expect(document.activeElement).toBe(main);
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("does not steal focus when the focused element is outside the toast that is removed", () => {
    const { store } = setup();
    const id = pushTwoRows(store);
    act(() => screen.getByRole("button", { name: "Submit" }).focus());

    act(() => {
      store.dispatch(dismissToast(id));
    });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Submit" }));
  });
});
