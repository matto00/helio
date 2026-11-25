// HEL-1840 D3 -- the row list shows a bottom-edge cue (data-overflow-below on its frame) only while it
// overflows and more rows remain below. jsdom does no layout, so the scroll metrics are stubbed.

import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ToastListItem } from "../../features/toasts/state/toastsSlice";
import { ToastRowList } from "./ToastRowList";

const items: ToastListItem[] = ["a", "b", "c"].map((k) => ({
  key: k,
  linkLabel: `Pipeline ${k}`,
  linkTo: `/pipelines/${k}`,
  text: "reason",
}));

let metrics = { scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
function stub(m: typeof metrics) {
  metrics = m;
}

beforeEach(() => {
  metrics = { scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
  for (const prop of ["scrollHeight", "clientHeight", "scrollTop"] as const) {
    Object.defineProperty(HTMLUListElement.prototype, prop, {
      configurable: true,
      get: () => metrics[prop],
      set: (v: number) => {
        metrics[prop] = v;
      },
    });
  }
});

afterEach(() => {
  for (const prop of ["scrollHeight", "clientHeight", "scrollTop"] as const) {
    delete (HTMLUListElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

function frameOf(container: HTMLElement) {
  return container.querySelector(".toast__list-frame");
}

function renderList() {
  return render(
    <MemoryRouter>
      <ToastRowList toastId="t1" items={items} />
    </MemoryRouter>,
  );
}

describe("ToastRowList overflow cue (HEL-1840 D3)", () => {
  it("marks the frame while the list overflows and is at the top", () => {
    stub({ scrollHeight: 600, clientHeight: 256, scrollTop: 0 });
    const { container } = renderList();
    expect(frameOf(container)).toHaveAttribute("data-overflow-below", "true");
  });

  it("carries no mark when the rows fit", () => {
    stub({ scrollHeight: 200, clientHeight: 256, scrollTop: 0 });
    const { container } = renderList();
    expect(frameOf(container)).not.toBeNull();
    expect(frameOf(container)).not.toHaveAttribute("data-overflow-below");
  });

  it("drops the mark once scrolled to the end, and returns it when scrolled back up", () => {
    stub({ scrollHeight: 600, clientHeight: 256, scrollTop: 0 });
    const { container } = renderList();
    const list = container.querySelector("ul") as HTMLUListElement;
    stub({ scrollHeight: 600, clientHeight: 256, scrollTop: 344 });
    fireEvent.scroll(list);
    expect(frameOf(container)).not.toHaveAttribute("data-overflow-below");
    stub({ scrollHeight: 600, clientHeight: 256, scrollTop: 100 });
    fireEvent.scroll(list);
    expect(frameOf(container)).toHaveAttribute("data-overflow-below", "true");
  });
});
