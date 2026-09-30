// HEL-1190 design.md D2 (task 4.2) — the URL-state hook a viewer's control selection lives in.
// spec.md's own scenarios: reload/a pasted link reproduces a set selection; clearing reverts to
// the author's default.

import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";

import { useViewerControls } from "./useViewerControls";
import type { OutputControlSpec } from "../types/panel";

function wrapper(initialPath: string) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
  };
}

const controls: OutputControlSpec[] = [
  { id: "c1", kind: "dropdown", column: "region", label: "Region" },
  { id: "c2", kind: "text", column: "name", label: "Name", defaultValue: "fallback" },
];

describe("useViewerControls (design.md D2)", () => {
  it("a pasted URL carrying p.<panelId>.<controlId> reproduces the exact selection", () => {
    const { result } = renderHook(() => useViewerControls("panel-1", controls), {
      wrapper: wrapper("/?p.panel-1.c1=east"),
    });
    expect(result.current.values.c1).toBe("east");
    expect(result.current.urlValues.c1).toBe("east");
  });

  it("reload (a fresh render from the same URL) reproduces the identical selection", () => {
    const first = renderHook(() => useViewerControls("panel-1", controls), {
      wrapper: wrapper("/?p.panel-1.c1=west"),
    });
    const second = renderHook(() => useViewerControls("panel-1", controls), {
      wrapper: wrapper("/?p.panel-1.c1=west"),
    });
    expect(first.result.current.values.c1).toBe(second.result.current.values.c1);
    expect(first.result.current.values.c1).toBe("west");
  });

  it("a control with no URL entry falls back to the author's encoded defaultValue", () => {
    const { result } = renderHook(() => useViewerControls("panel-1", controls), {
      wrapper: wrapper("/"),
    });
    expect(result.current.values.c2).toBe("fallback");
    expect(result.current.urlValues.c2).toBeUndefined();
  });

  it("setValue updates the URL entry, then values reflects it on the next render", () => {
    const { result } = renderHook(() => useViewerControls("panel-1", controls), {
      wrapper: wrapper("/"),
    });
    act(() => {
      result.current.setValue("c1", "north");
    });
    expect(result.current.values.c1).toBe("north");
    expect(result.current.urlValues.c1).toBe("north");
  });

  it("clearValue removes the URL entry, reverting to the author's default (or no filter if none)", () => {
    const { result } = renderHook(() => useViewerControls("panel-1", controls), {
      wrapper: wrapper("/?p.panel-1.c1=east&p.panel-1.c2=explicit"),
    });
    expect(result.current.values.c1).toBe("east");
    expect(result.current.values.c2).toBe("explicit");

    act(() => {
      result.current.clearValue("c1");
    });
    // c1 has no `defaultValue` configured -- clearing it means "no filter" (undefined).
    expect(result.current.urlValues.c1).toBeUndefined();
    expect(result.current.values.c1).toBeUndefined();

    act(() => {
      result.current.clearValue("c2");
    });
    // c2 has a configured defaultValue -- clearing reverts to it, not to "no filter".
    expect(result.current.urlValues.c2).toBeUndefined();
    expect(result.current.values.c2).toBe("fallback");
  });

  it("a malformed URL value for numeric-range/date-range falls back to the default, never a render error", () => {
    const rangeControls: OutputControlSpec[] = [
      { id: "c1", kind: "numeric-range", column: "amount", label: "Amount" },
    ];
    const { result } = renderHook(() => useViewerControls("panel-1", rangeControls), {
      wrapper: wrapper("/?p.panel-1.c1=not-a-valid-range"),
    });
    expect(result.current.values.c1).toBeUndefined();
  });

  it("distinct panels never collide on the same control id", () => {
    const { result } = renderHook(
      () => ({
        a: useViewerControls("panel-a", controls),
        b: useViewerControls("panel-b", controls),
      }),
      { wrapper: wrapper("/?p.panel-a.c1=east") },
    );
    expect(result.current.a.values.c1).toBe("east");
    expect(result.current.b.values.c1).toBeUndefined();
  });
});
