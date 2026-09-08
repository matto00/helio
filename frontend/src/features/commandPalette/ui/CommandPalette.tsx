import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import "./CommandPalette.css";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { KeyCap } from "../../../shared/ui/KeyCap";
import { useOverlay } from "../../../shared/chrome/OverlayProvider";
import { formatCombo, isMacPlatform } from "../../../shared/chrome/shortcuts";
import { useCommandPalette, useCommandRegistryActions, useSetCommandQuery } from "../hooks";
import { SEARCH_SECTION, SECTION_DISPLAY_ORDER } from "../model/builtInActions";
import { rankActions } from "../model/ranking";
import type { CommandAction } from "../model/types";
import { useRecentPaletteActions } from "../useRecentPaletteActions";
import { useResourceIndexing } from "../useResourceIndexing";
import { useResourceSearchActions } from "../useResourceSearchActions";

const UNSECTIONED = "";

interface ResultGroup {
  section: string;
  actions: CommandAction[];
}

/** Groups an already-ranked, already-flattened action list by section, preserving relative
 * order WITHIN each group — `command-palette-filtering` spec. Actions without a `section` are
 * grouped together under `UNSECTIONED` rather than dropped.
 *
 * skeptic-final-1.md CR1 — the top-level GROUP order is no longer "whichever section was first
 * encountered while walking `actions`" (which silently tracked registration/mount order, and
 * therefore any registrant's own render-churn — see `HelpOverlay.tsx`'s fixed context-value
 * bug). Groups are sorted by `SECTION_DISPLAY_ORDER`'s declared position; a section not listed
 * there (including `UNSECTIONED`) sorts after every listed one, in its own first-encountered
 * order — so a future section needs no code change here, only an entry in that array to get a
 * deliberate position. */
function groupBySection(actions: CommandAction[]): ResultGroup[] {
  const order: string[] = [];
  const bySection = new Map<string, CommandAction[]>();
  for (const action of actions) {
    const section = action.section ?? UNSECTIONED;
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push(action);
  }
  const sortedOrder = [...order].sort((a, b) => {
    const aIndex = SECTION_DISPLAY_ORDER.indexOf(a);
    const bIndex = SECTION_DISPLAY_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return order.indexOf(a) - order.indexOf(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  return sortedOrder.map((section) => ({ section, actions: bySection.get(section)! }));
}

/**
 * The command palette overlay (`command-palette-shell` spec). Renders on the shared `Modal`
 * primitive (design.md D1) — Tab/Shift+Tab trap, Escape, backdrop close, and focus restore are
 * all inherited, not reimplemented here. Registers with `useOverlay()` (design.md D2) so opening
 * the palette closes any other active overlay, and vice versa.
 */
export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const overlay = useOverlay();
  const registeredActions = useCommandRegistryActions();
  const setQuery = useSetCommandQuery();
  const [query, setLocalQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      overlay.open();
    } else {
      overlay.close();
    }
    // overlay.open/close are stable (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Another overlay taking over (single-active-overlay mutual exclusion) closes this one too.
  useEffect(() => {
    if (isOpen && !overlay.isActive) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.isActive]);

  useEffect(() => {
    if (isOpen) {
      setLocalQuery("");
      setQuery("");
      setActiveIndex(0);
      // Autofocus the search input — the Modal is the dialog itself, so focus needs an explicit
      // nudge once it's actually in the DOM/open.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [isOpen, setQuery]);

  // HEL-519 design.md D5, task 5.1 — recents are synthesized here, at the call site, and
  // PREPENDED to the ranked default list; never threaded into `rankActions`, which has no access
  // to visit history and must stay a pure function of (actions, query). On an empty query with a
  // non-empty history, this section is added ON TOP of the existing default presentation (which
  // already includes Navigation/General/Create) — never a replacement of it. On any non-empty
  // query, or an empty history, `results` is exactly what `rankActions` returned, unchanged.
  const recentActions = useRecentPaletteActions();

  // HEL-503 design.md D2 — indexes all four resource kinds explicitly on palette open, so search
  // works on `/` with no prior navigation (the ticket's primary acceptance criterion).
  useResourceIndexing();
  const {
    actions: searchActions,
    coverageMessage,
    isIndexing,
    overflowNotices,
  } = useResourceSearchActions();

  const results = useMemo(() => {
    // design.md D5 — search results are merged into the SAME array `rankActions` scores, so
    // their `matchesQuery: true` opt-out (kept unscored, in registrant order) is honored by the
    // existing sort rather than a second, parallel merge step. `searchActions` is itself always
    // `[]` for an empty query (`useResourceSearchActions`/`searchResourceItems`), so this can
    // never leak resource rows into the always-shown empty-query default list.
    const ranked = rankActions([...registeredActions, ...searchActions], query);
    if (query.trim() === "" && recentActions.length > 0) {
      return [...recentActions, ...ranked];
    }
    return ranked;
  }, [registeredActions, searchActions, query, recentActions]);
  const groups = useMemo(() => groupBySection(results), [results]);
  // design.md D4/task 4.4 — a query that currently matches nothing only because indexing
  // hasn't finished must not read as "no results" (a permanent, wrong answer) — it reads as
  // still in progress instead.
  const showIndexingInProgress = results.length === 0 && query.trim() !== "" && isIndexing;

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length, query]);

  function handleQueryChange(value: string) {
    setLocalQuery(value);
    setQuery(value);
  }

  function runActive() {
    const action = results[activeIndex];
    if (!action) return;
    action.run();
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runActive();
    }
  }

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl || typeof activeEl.scrollIntoView !== "function") return;
    activeEl.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Flattened index → DOM id, so ArrowDown/Up crosses group boundaries and aria-activedescendant
  // always names the right element (`command-palette-shell` spec).
  let flatIndex = 0;
  const activeActionId = results[activeIndex]?.id;
  const mac = isMacPlatform();

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title="Command palette"
      size="lg"
      ariaLabel="Command palette"
      className="command-palette"
    >
      <div className="command-palette__search">
        <Search className="command-palette__search-icon" aria-hidden="true" />
        <TextField
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search actions..."
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={
            activeActionId ? `command-palette-option-${activeActionId}` : undefined
          }
          autoComplete="off"
        />
      </div>

      {/* HEL-503 design.md D4 — coverage caveat, derived from live per-kind status; absent
        entirely once every kind has `succeeded` (task 4.3), never a hardcoded string. */}
      {coverageMessage && (
        <div className="command-palette__coverage" role="status">
          {coverageMessage}
        </div>
      )}

      {results.length === 0 ? (
        showIndexingInProgress ? (
          <EmptyState
            icon={<Search />}
            title="Still searching…"
            description="Results will appear as indexing finishes."
          />
        ) : (
          <EmptyState
            icon={<SearchX />}
            title="No matching commands"
            description="Try a different search term."
          />
        )
      ) : (
        <div className="command-palette__results" id="command-palette-results" ref={listRef}>
          {groups.map((group) => (
            <div className="command-palette__group" key={group.section || "__unsectioned__"}>
              {group.section && (
                <div className="eyebrow command-palette__group-label">{group.section}</div>
              )}
              <ul className="command-palette__list" role="listbox">
                {group.actions.map((action) => {
                  const index = flatIndex++;
                  const isActive = index === activeIndex;
                  return (
                    <li key={action.id}>
                      <button
                        type="button"
                        id={`command-palette-option-${action.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive ? "true" : undefined}
                        className="command-palette__item"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          action.run();
                          close();
                        }}
                      >
                        {action.icon && (
                          <span className="command-palette__item-icon">{action.icon}</span>
                        )}
                        <span className="command-palette__item-text">
                          <span className="command-palette__item-title">
                            {action.title}
                            {/* HEL-516 design.md Decision 5 — INLINE after the title, never
                              right-aligned: the palette has no right-hand column and only one
                              action carries a cap today, so a right-aligned cap would strand in
                              dead space. Same `KeyCap` atom/typography/border/radius the help
                              overlay uses, just a different coordinate.
                              skeptic-final-1.md CR2 — the extra title-to-combo gap belongs on
                              this wrapping span, not on every individual `.ui-keycap`: applying
                              it per-cap also widened the gap BETWEEN caps within the same combo
                              (doubling the help overlay's 4px intra-combo spacing, which lives
                              solely in `KeyCap.css`'s `.ui-keycap + .ui-keycap` rule and is left
                              untouched here). */}
                            {action.shortcut && (
                              <span className="command-palette__item-combo">
                                {formatCombo(action.shortcut, { mac }).map((token, tokenIndex) => (
                                  <KeyCap key={tokenIndex}>{token}</KeyCap>
                                ))}
                              </span>
                            )}
                          </span>
                          {action.subtitle && (
                            <span className="command-palette__item-subtitle">
                              {action.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* Skeptic-final-1 CR2 (final gate, round 1) — deliberately OUTSIDE the
                `role="listbox"` `<ul>` above and NOT a `<button>`/`role="option"`: an
                informational count of how many more matches exist is not a selectable action.
                It must never enter keyboard `ArrowDown`/`ArrowUp` traversal (which only walks
                `group.actions`, never this array), never be clickable, and never be assignable
                `data-active`/`aria-selected`. CR1 (same round) — `.command-palette__notice-icon`
                is an EMPTY spacer sized to match `.command-palette__item-icon`'s width
                (`var(--text-lg)`), so this is the only iconless row that still lines its text up
                with every other row's text column instead of hanging into the icon gutter. */}
              {group.section === SEARCH_SECTION && overflowNotices.length > 0 && (
                <div className="command-palette__notices">
                  {overflowNotices.map((notice) => (
                    <div className="command-palette__notice" key={notice}>
                      <span className="command-palette__notice-icon" aria-hidden="true" />
                      <span className="command-palette__item-subtitle">{notice}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
