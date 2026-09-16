// StepPalette — HEL-1136: replaces the flat `OpDropdown` op menu with a grouped, filterable,
// keyboard-navigable add-step chooser. Built on the shared `Modal` (design.md Decision 6), reusing
// `CommandPalette`'s search/filter/keyboard/eyebrow-group markup (`CommandPalette.css`) rather than
// inventing a new visual dialect — the whole point of D6/C1.
//
// Categories/labels/descriptions/authorability all come from `GET /api/pipeline-step-catalog`
// (design.md Decisions 1-5); the ONLY client-side lookup is `STEP_ICONS` (a presentation-asset map,
// not a group mapping — design.md Decision 7).

import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import "../../commandPalette/ui/CommandPalette.css";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { getPipelineStepCatalog } from "../services/pipelineService";
import { DEFAULT_STEP_ICON, STEP_ICONS } from "../state/stepNarrowing";
import type { PipelineStepCatalog, PipelineStepCatalogEntry } from "../types/pipelineStepCatalog";
import type { OpType } from "../types/step";

interface StepPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (opType: OpType) => void;
}

export interface ResultRow {
  entry: PipelineStepCatalogEntry;
  opType: OpType;
}

function toOpType(entry: PipelineStepCatalogEntry): OpType {
  return {
    id: entry.kind,
    label: entry.label,
    icon: STEP_ICONS[entry.kind] ?? DEFAULT_STEP_ICON,
  };
}

/** Exported (rather than kept file-private) purely for testability — evaluation-1.md CR2: the
 *  predicate `findUngroupedEntriesInGroups` embodies is otherwise unreachable through a
 *  catalog-only fixture (see that function's own doc comment), so a test needs to construct this
 *  shape directly to exercise it. No behavior change to `buildGroups`/`ungroupedEntriesInACategory`. */
export interface ResultGroup {
  label: string | null;
  rows: ResultRow[];
}

/** HEL-1136 task 6.2 — the failable "All" completeness check: every authorable catalog entry
 *  must be reachable from `buildGroups`'s no-filter output. Exported (pure, no rendering) so the
 *  guard can be exercised directly against a fixture catalog without a DOM assertion that would
 *  itself need to be "expected to fail" in the suite. */
export function missingFromAllView(catalog: PipelineStepCatalog): string[] {
  const authorableEntries = catalog.steps.filter((e) => e.authorable);
  const rendered = new Set(
    buildGroups(catalog, authorableEntries, "").flatMap((g) => g.rows.map((r) => r.entry.kind)),
  );
  return authorableEntries.filter((e) => !rendered.has(e.kind)).map((e) => e.kind);
}

/** HEL-1136 task 6.2 / evaluation-1.md CR2 — the predicate `ungroupedEntriesInACategory` checks,
 *  factored out and exported so a test can exercise it directly against a hand-built `ResultGroup[]`
 *  shape rather than only through `buildGroups`'s real output. This split matters because
 *  `buildGroups`'s CURRENT bucketing is a strict binary split (an entry with `group === undefined`
 *  is pushed to the header-less bucket, every other entry is pushed to `byGroup`) — by that
 *  construction, no catalog-only fixture can EVER produce a `buildGroups` output where an
 *  undefined-group entry lands inside a `label !== null` section, so a test that only ever calls
 *  `ungroupedEntriesInACategory(catalog)` can never observe a non-empty result no matter what the
 *  fixture contains (confirmed by inspection, not merely asserted). Testing this exported function
 *  directly against a manually constructed `ResultGroup[]` (bypassing `buildGroups` entirely) is
 *  what makes the check provably failable — it would catch a REGRESSION in `buildGroups`'s own
 *  bucketing (e.g. a future edit that stops checking `entry.group === undefined` before grouping),
 *  which is exactly the class of defect this guard exists to catch, even though today's correct
 *  implementation can never trigger it via data alone. */
export function findUngroupedEntriesInGroups(groups: ResultGroup[]): string[] {
  return groups
    .filter((g) => g.label !== null)
    .flatMap((g) => g.rows.filter((r) => r.entry.group === undefined).map((r) => r.entry.kind));
}

/** HEL-1136 task 6.2 — the failable "ungrouped entry appears in no category" check: an entry with
 *  no declared group must never be rendered under a labeled section. Thin wrapper over
 *  `findUngroupedEntriesInGroups` — see that function's doc comment for why the check is tested
 *  against it directly rather than only through this wrapper. */
export function ungroupedEntriesInACategory(catalog: PipelineStepCatalog): string[] {
  const authorableEntries = catalog.steps.filter((e) => e.authorable);
  return findUngroupedEntriesInGroups(buildGroups(catalog, authorableEntries, ""));
}

/** design.md Decision 6 / HEL-1022 (DESIGN.md §6) — grouping renders only while no filter is
 *  active; while filtering, every match is presented as one flat list (a filtering user is
 *  looking for a step by name/description, not browsing a structure). Ungrouped entries never get
 *  a header of their own (`pipeline-step-palette` spec: "a step that declares no group ... appears
 *  in no category") -- they're appended, header-less, after every declared group's section. */
function buildGroups(
  catalog: PipelineStepCatalog,
  authorableEntries: PipelineStepCatalogEntry[],
  query: string,
): ResultGroup[] {
  const trimmed = query.trim().toLowerCase();
  const matches =
    trimmed === ""
      ? authorableEntries
      : authorableEntries.filter(
          (e) =>
            e.label.toLowerCase().includes(trimmed) ||
            e.description.toLowerCase().includes(trimmed),
        );

  if (trimmed !== "") {
    return [{ label: null, rows: matches.map((entry) => ({ entry, opType: toOpType(entry) })) }];
  }

  const byGroup = new Map<string, ResultRow[]>();
  const ungrouped: ResultRow[] = [];
  for (const entry of matches) {
    const row = { entry, opType: toOpType(entry) };
    if (entry.group === undefined) {
      ungrouped.push(row);
    } else {
      const existing = byGroup.get(entry.group) ?? [];
      existing.push(row);
      byGroup.set(entry.group, existing);
    }
  }
  const groups: ResultGroup[] = [];
  for (const group of catalog.groups) {
    const rows = byGroup.get(group.id);
    if (rows && rows.length > 0) groups.push({ label: group.label, rows });
  }
  if (ungrouped.length > 0) groups.push({ label: null, rows: ungrouped });
  return groups;
}

export function StepPalette({ open, onClose, onSelect }: StepPaletteProps) {
  const [catalog, setCatalog] = useState<PipelineStepCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [fetchNonce, setFetchNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPipelineStepCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the step catalog.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchNonce]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const authorableEntries = useMemo(
    () => (catalog ? catalog.steps.filter((e) => e.authorable) : []),
    [catalog],
  );

  const groups = useMemo(
    () => (catalog ? buildGroups(catalog, authorableEntries, query) : []),
    [catalog, authorableEntries, query],
  );
  const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [flatRows.length, query]);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl || typeof activeEl.scrollIntoView !== "function") return;
    activeEl.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function selectRow(row: ResultRow | undefined) {
    if (!row) return;
    onSelect(row.opType);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (flatRows.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flatRows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + flatRows.length) % flatRows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectRow(flatRows[activeIndex]);
    }
  }

  let flatIndex = 0;
  const activeKind = flatRows[activeIndex]?.entry.kind;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add step"
      size="lg"
      ariaLabel="Add step"
      className="command-palette"
    >
      <div className="command-palette__search">
        <Search className="command-palette__search-icon" aria-hidden="true" />
        <TextField
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search steps..."
          aria-label="Search steps"
          role="combobox"
          aria-expanded="true"
          aria-controls="step-palette-results"
          aria-activedescendant={activeKind ? `step-palette-option-${activeKind}` : undefined}
          autoComplete="off"
        />
      </div>

      {error ? (
        <EmptyState
          icon={<SearchX />}
          title="Couldn't load steps"
          description={error}
          cta={{ label: "Retry", onClick: () => setFetchNonce((n) => n + 1) }}
        />
      ) : loading && catalog === null ? (
        <EmptyState
          icon={<Search />}
          title="Loading steps…"
          description="Fetching the available step types."
        />
      ) : flatRows.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No matching steps"
          description="Try a different search term."
        />
      ) : (
        <div className="command-palette__results" id="step-palette-results" ref={listRef}>
          {groups.map((group, groupIndex) => (
            <div
              className="command-palette__group"
              key={group.label ?? `__ungrouped-${groupIndex}`}
            >
              {group.label && (
                <div className="eyebrow command-palette__group-label">{group.label}</div>
              )}
              <ul className="command-palette__list" role="listbox">
                {group.rows.map((row) => {
                  const index = flatIndex++;
                  const isActive = index === activeIndex;
                  const Icon = row.opType.icon;
                  return (
                    <li key={row.entry.kind}>
                      <button
                        type="button"
                        id={`step-palette-option-${row.entry.kind}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive ? "true" : undefined}
                        className="command-palette__item"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectRow(row)}
                      >
                        <span className="command-palette__item-icon">
                          <Icon aria-hidden="true" size={ICON_SIZE.md} />
                        </span>
                        <span className="command-palette__item-text">
                          <span className="command-palette__item-title">{row.entry.label}</span>
                          <span className="command-palette__item-subtitle">
                            {row.entry.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
