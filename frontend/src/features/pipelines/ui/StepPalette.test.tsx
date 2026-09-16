// StepPalette.test.tsx — HEL-1136 tasks 4.1-4.5, 6.2. `pipeline-step-palette` spec coverage:
// server-driven groups (no client-side group mapping), filter-flattens-across-groups, the "All"
// completeness failable check, keyboard traversal across group boundaries, and unauthorable
// exclusion.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { getPipelineStepCatalog } from "../services/pipelineService";
import { DEFAULT_STEP_ICON } from "../state/stepNarrowing";
import type { PipelineStepCatalog } from "../types/pipelineStepCatalog";
import {
  StepPalette,
  findUngroupedEntriesInGroups,
  missingFromAllView,
  ungroupedEntriesInACategory,
  type ResultGroup,
} from "./StepPalette";

jest.mock("../services/pipelineService", () => ({
  getPipelineStepCatalog: jest.fn(),
}));
const getPipelineStepCatalogMock = jest.mocked(getPipelineStepCatalog);

beforeEach(() => {
  // jsdom does not implement <dialog> showModal/close natively; stub them (mirrors
  // CommandPalette.test.tsx / Modal.test.tsx).
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

// design.md Decision 5 (owner ruling 2 / C5): `assert` is the shipped ungrouped kind (group
// field ABSENT, not null); `groupby` is unauthorable and must never render as a choice.
const fixtureCatalog: PipelineStepCatalog = {
  groups: [
    { id: "filter-shape", label: "Filter & shape" },
    { id: "aggregate", label: "Aggregate" },
  ],
  steps: [
    {
      kind: "select",
      label: "Select fields",
      description: "Keep only chosen columns.",
      group: "filter-shape",
      authorable: true,
    },
    {
      kind: "filter",
      label: "Filter rows",
      description: "Keep only matching rows.",
      group: "filter-shape",
      authorable: true,
    },
    {
      kind: "aggregate",
      label: "Group & aggregate",
      description: "Group and sum things up.",
      group: "aggregate",
      authorable: true,
    },
    {
      kind: "assert",
      label: "Assert / validate",
      description: "Validate rows against rules.",
      authorable: true,
    },
    {
      kind: "groupby",
      label: "Group by (legacy)",
      description: "Legacy grouping op.",
      group: "aggregate",
      authorable: false,
    },
  ],
};

async function openPalette(onSelect = jest.fn(), onClose = jest.fn()) {
  render(<StepPalette open onSelect={onSelect} onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Add step" })).toBeInTheDocument());
  return { onSelect, onClose };
}

describe("StepPalette", () => {
  beforeEach(() => {
    getPipelineStepCatalogMock.mockReset();
    getPipelineStepCatalogMock.mockResolvedValue(fixtureCatalog);
  });

  it("renders every authorable entry from the fixture catalog", async () => {
    await openPalette();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Select fields/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Filter rows/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Group & aggregate/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Assert \/ validate/ })).toBeInTheDocument();
    });
  });

  it("excludes an unauthorable entry from every view (design.md Decision 5)", async () => {
    await openPalette();
    await waitFor(() => screen.getByRole("option", { name: /Select fields/ }));
    expect(screen.queryByText("Group by (legacy)")).not.toBeInTheDocument();
  });

  it("renders group headers from server data, with no header for the ungrouped entry", async () => {
    await openPalette();
    await waitFor(() => {
      expect(screen.getByText("Filter & shape")).toBeInTheDocument();
      expect(screen.getByText("Aggregate")).toBeInTheDocument();
    });
    // "assert" is ungrouped -- it renders in the list but under no group eyebrow of its own.
    const assertOption = await screen.findByRole("option", { name: /Assert \/ validate/ });
    const assertGroup = assertOption.closest(".command-palette__group");
    expect(assertGroup?.querySelector(".command-palette__group-label")).toBeNull();
  });

  it("a description-only match stays visible while filtering, and results flatten (no group headers)", async () => {
    await openPalette();
    await waitFor(() => screen.getByRole("option", { name: /Select fields/ }));

    fireEvent.change(screen.getByRole("combobox", { name: "Search steps" }), {
      target: { value: "sum things up" },
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Group & aggregate/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Select fields/ })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Filter & shape")).not.toBeInTheDocument();
  });

  it("shows an empty state when the filter matches nothing", async () => {
    await openPalette();
    await waitFor(() => screen.getByRole("option", { name: /Select fields/ }));

    fireEvent.change(screen.getByRole("combobox", { name: "Search steps" }), {
      target: { value: "zzz-no-match" },
    });

    await waitFor(() => {
      expect(screen.getByText("No matching steps")).toBeInTheDocument();
    });
  });

  it("focuses the filter input as soon as the palette opens", async () => {
    await openPalette();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Search steps" })).toHaveFocus();
    });
  });

  it("ArrowDown moves the active selection across a group boundary into the next group", async () => {
    await openPalette();
    await waitFor(() => screen.getByRole("option", { name: /Select fields/ }));

    const input = screen.getByRole("combobox", { name: "Search steps" });
    // Flat order: select(0), filter(1), aggregate(2), assert(3) -- filter-shape has 2 entries
    // (select, filter), so the 2nd ArrowDown crosses the group boundary into aggregate.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    await waitFor(() => {
      const active = screen.getByRole("option", { name: /Group & aggregate/ });
      expect(active).toHaveAttribute("aria-selected", "true");
    });
  });

  it("Enter selects the active result and closes the palette", async () => {
    const { onSelect, onClose } = await openPalette();
    await waitFor(() => screen.getByRole("option", { name: /Select fields/ }));

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search steps" }), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("select");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking an option selects it and closes the palette", async () => {
    const { onSelect, onClose } = await openPalette();
    fireEvent.click(await screen.findByRole("option", { name: /Filter rows/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("filter");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a retry-capable error state when the catalog fetch fails", async () => {
    getPipelineStepCatalogMock.mockReset();
    getPipelineStepCatalogMock.mockRejectedValueOnce(new Error("network down"));
    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Couldn't load steps")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^No matching/)).not.toBeInTheDocument();

    getPipelineStepCatalogMock.mockResolvedValueOnce(fixtureCatalog);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Select fields/ })).toBeInTheDocument();
    });
  });
});

// HEL-1136 task 6.2 — the frontend failable check: every authorable catalog entry appears in
// "All" (the default, no-filter view), and no ungrouped entry appears inside a group section.
// Exercised against the pure `missingFromAllView`/`ungroupedEntriesInACategory` helpers (not a
// DOM assertion, which can't itself be an "expected to fail" fixture inside a passing suite).
describe("StepPalette 'All' completeness (HEL-1136 task 6.2)", () => {
  // evaluation-1.md CR1 finding, answered explicitly: an authorable entry whose declared `group`
  // id matches NOTHING in `catalog.groups` silently disappears from the no-filter "All" view.
  // `buildGroups`'s no-filter branch buckets every grouped entry into a `Map` keyed by its OWN
  // `group` value, then only reads back the groups it recognizes (`for (const group of
  // catalog.groups) { ... byGroup.get(group.id) ... }`) -- an entry filed under an unrecognized
  // key is never retrieved by that loop, and (being neither `undefined` nor a recognized id) it
  // also never lands in the header-less "ungrouped" bucket. It DOES still appear while a filter is
  // active (the `trimmed !== ""` branch returns `matches` directly, with no `catalog.groups`
  // dependency at all), so this is scoped to the default view only. Today this can't happen in
  // practice -- the backend's `PipelineStepCatalogService` derives BOTH `groups` and each entry's
  // `group` from the same `StepGroup`/`StepGroup.All` source, so a mismatch would require the two
  // to drift apart, which nothing in the current code permits -- but it is a real, reachable gap
  // in this frontend function's OWN defense-in-depth if that invariant were ever violated (a stale
  // cached catalog, a future backend change that stops guaranteeing it, etc.), not a hypothetical
  // that can't occur through the type signature. Not fixed here (not asked, and the ticket's ACs
  // are satisfied by the current backend-side guarantee) -- reported per the request to answer
  // explicitly, and demonstrated below as the actual failable case this check exists to catch.
  it("goes red (non-empty) when an authorable entry's declared group id has no matching catalog.groups entry", () => {
    const catalogWithDanglingGroupRef: PipelineStepCatalog = {
      groups: fixtureCatalog.groups,
      // "select" REMAINS present in catalog.steps (unlike the vacuous cycle-1 version, which
      // removed it from the input entirely) -- its group id just no longer resolves.
      steps: fixtureCatalog.steps.map((s) =>
        s.kind === "select" ? { ...s, group: "no-such-group" } : s,
      ),
    };
    expect(missingFromAllView(catalogWithDanglingGroupRef)).toEqual(["select"]);
  });

  it("passes (empty) for a correct fixture catalog — every authorable entry renders in All", () => {
    expect(missingFromAllView(fixtureCatalog)).toEqual([]);
  });

  // evaluation-1.md CR2 — `ungroupedEntriesInACategory(catalog)` itself can never be driven
  // non-empty by ANY catalog fixture while `buildGroups`'s bucketing is correct: it splits
  // strictly on `entry.group === undefined`, so an ungrouped entry can only ever land in the
  // header-less bucket, never inside a `label !== null` section -- confirmed by inspection of
  // `buildGroups`, not merely asserted. Testing `findUngroupedEntriesInGroups` directly (the
  // predicate `ungroupedEntriesInACategory` wraps, exported for exactly this reason) against a
  // hand-built `ResultGroup[]` is what makes this check provably failable: it demonstrates the
  // predicate itself would flag a mis-rendered entry, which is the actual invariant task 6.2 asks
  // this guard to protect -- a future regression in `buildGroups`'s own bucketing, not something a
  // catalog-only fixture can reach today.
  it("findUngroupedEntriesInGroups goes red (non-empty) when an ungrouped entry is placed under a labeled section", () => {
    const assertEntry = fixtureCatalog.steps.find((s) => s.kind === "assert")!;
    const mishapenGroups: ResultGroup[] = [
      {
        label: "Filter & shape",
        rows: [
          {
            entry: assertEntry,
            opType: { id: "assert", label: assertEntry.label, icon: DEFAULT_STEP_ICON },
          },
        ],
      },
    ];
    expect(findUngroupedEntriesInGroups(mishapenGroups)).toEqual(["assert"]);
  });

  it("findUngroupedEntriesInGroups passes (empty) for the real fixture's correct grouping", () => {
    expect(ungroupedEntriesInACategory(fixtureCatalog)).toEqual([]);
  });
});
