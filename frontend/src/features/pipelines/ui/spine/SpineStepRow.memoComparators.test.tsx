// HEL-1809: SpineStepRow is memoised on a value comparator. Every value the comparator looks at needs a test that fails when its
// comparison is dropped (the comparator then wrongly says "equal" and the row keeps showing the old value). Each case renders a
// base row, re-renders it with ONE changed prop and asserts what the user sees.

import { fireEvent, render, screen } from "@testing-library/react";

import { OP_TYPES } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";
import { SpineStepRow, type SpineStepRowProps } from "./SpineStepRow";

const FILTER = OP_TYPES.find((o) => o.id === "filter")!;
const LIMIT = OP_TYPES.find((o) => o.id === "limit")!;
const STEP: Step = {
  id: "s1",
  opType: LIMIT,
  label: "Limit rows",
  config: { count: 5 } as Step["config"],
  enabled: true,
  rootId: "r1",
};
const SELECT = jest.fn();
const noop = () => undefined;

const base = (): SpineStepRowProps => ({
  step: STEP,
  number: 1,
  selected: false,
  rowCount: 10,
  partial: false,
  hasValidationError: false,
  warningCount: 0,
  hasSaveError: false,
  isCreating: false,
  menuItems: [{ label: "Do it", onClick: noop, disabled: false }],
  nodePath: "path-a",
  phone: false,
  onSelect: SELECT,
});

const draft = (over = {}) => ({
  status: "ok" as const,
  count: 4,
  baseCount: 10,
  sample: false,
  ...over,
});

const rowEl = (c: HTMLElement) => c.querySelector(".spine-row") as HTMLElement;
const select = () => screen.getByRole("button", { name: /^Step \d+:/ });
const text = (c: HTMLElement, sel: string) => c.querySelector(sel)?.textContent ?? "";

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Step actions for Limit rows" }));
}

interface Case {
  name: string;
  from?: Partial<SpineStepRowProps>;
  to: Partial<SpineStepRowProps>;
  before: (c: HTMLElement) => unknown;
}

const CASES: Case[] = [
  { name: "number", to: { number: 7 }, before: (c) => text(c, ".spine-row__number") },
  { name: "selected", to: { selected: true }, before: () => select().getAttribute("aria-current") },
  { name: "rowCount", to: { rowCount: 99 }, before: (c) => text(c, ".spine-row__count") },
  {
    name: "draft status",
    from: { draft: draft() },
    to: { draft: draft({ status: "pending" }) },
    before: (c) => c.querySelector("[aria-label='Updating on the server']") !== null,
  },
  {
    name: "draft count",
    from: { draft: draft() },
    to: { draft: draft({ count: 2 }) },
    before: (c) => text(c, ".spine-row__count"),
  },
  {
    name: "draft baseCount",
    from: { draft: draft() },
    to: { draft: draft({ baseCount: 8 }) },
    before: (c) => text(c, ".spine-row__count"),
  },
  {
    name: "draft sample",
    from: { draft: draft() },
    to: { draft: draft({ sample: true }) },
    before: () => select().getAttribute("aria-label"),
  },
  {
    name: "draft present",
    to: { draft: draft() },
    before: (c) => text(c, ".spine-row__count"),
  },
  { name: "partial", to: { partial: true }, before: () => select().getAttribute("aria-label") },
  {
    name: "hasValidationError",
    to: { hasValidationError: true },
    before: () => select().getAttribute("aria-label"),
  },
  {
    name: "warningCount",
    to: { warningCount: 2 },
    before: () => select().getAttribute("aria-label"),
  },
  {
    name: "hasSaveError",
    to: { hasSaveError: true },
    before: () => select().getAttribute("aria-label"),
  },
  { name: "isCreating", to: { isCreating: true }, before: (c) => text(c, ".spine-row__note") },
  { name: "nodePath", to: { nodePath: "path-b" }, before: (c) => rowEl(c).getAttribute("title") },
  { name: "phone", to: { phone: true }, before: (c) => rowEl(c).className },
  {
    name: "reorder presence",
    to: {
      reorder: { index: 0, onDragStart: noop, onDragEnd: noop, onDragOver: noop, onDrop: noop },
    },
    before: (c) => c.querySelector(".spine-row__grip") !== null,
  },
  {
    name: "step label",
    to: { step: { ...STEP, label: "Renamed" } },
    before: (c) => text(c, ".spine-row__title"),
  },
  {
    name: "step enabled",
    to: { step: { ...STEP, enabled: false } },
    before: (c) => rowEl(c).className,
  },
  {
    name: "step config",
    to: { step: { ...STEP, config: { count: 9 } as Step["config"] } },
    before: (c) => text(c, ".spine-row__summary"),
  },
  {
    name: "step opType",
    to: { step: { ...STEP, opType: FILTER } },
    before: (c) => text(c, ".spine-row__summary"),
  },
];

describe("SpineStepRow comparator: a changed value always reaches the DOM (HEL-1809)", () => {
  it.each(CASES)("$name", ({ from, to, before }) => {
    const { container, rerender } = render(<SpineStepRow {...base()} {...from} />);
    const first = before(container);
    rerender(<SpineStepRow {...base()} {...from} {...to} />);
    expect(before(container)).not.toEqual(first);
  });

  it("menu: a changed disabled flag, reason and label reach the opened menu", () => {
    const item = (over = {}) => [{ label: "Do it", onClick: noop, ...over }];
    const { rerender } = render(<SpineStepRow {...base()} menuItems={item()} />);
    rerender(<SpineStepRow {...base()} menuItems={item({ disabled: true })} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Do it" })).toBeDisabled();

    rerender(<SpineStepRow {...base()} menuItems={item({ disabled: true, reason: "Because" })} />);
    expect(screen.getByRole("menuitem", { name: "Do it" })).toHaveAttribute("title", "Because");

    rerender(<SpineStepRow {...base()} menuItems={item({ label: "Do that" })} />);
    expect(screen.getByRole("menuitem", { name: "Do that" })).toBeInTheDocument();

    rerender(
      <SpineStepRow {...base()} menuItems={item({ label: "Do that", ariaLabel: "Aria name" })} />,
    );
    expect(screen.getByRole("menuitem", { name: "Aria name" })).toBeInTheDocument();
  });

  it("onSelect: a new handler is the one a click reaches", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<SpineStepRow {...base()} onSelect={first} />);
    rerender(<SpineStepRow {...base()} onSelect={second} />);
    fireEvent.click(select());
    expect(second).toHaveBeenCalledWith("s1");
    expect(first).not.toHaveBeenCalled();
  });

  it("reorder: a changed index reaches the drag handlers", () => {
    const onDragStart = jest.fn();
    const reorder = (index: number) => ({
      index,
      onDragStart,
      onDragEnd: noop,
      onDragOver: noop,
      onDrop: noop,
    });
    const { container, rerender } = render(<SpineStepRow {...base()} reorder={reorder(0)} />);
    rerender(<SpineStepRow {...base()} reorder={reorder(3)} />);
    fireEvent.dragStart(container.querySelector(".spine-row__grip") as HTMLElement);
    expect(onDragStart).toHaveBeenCalledWith(3, "s1");
  });
});
