import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import "./CommandPalette.css";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { useOverlay } from "../../../shared/chrome/OverlayProvider";
import { useCommandPalette, useCommandRegistryActions, useSetCommandQuery } from "../hooks";
import { rankActions } from "../model/ranking";
import type { CommandAction } from "../model/types";

const UNSECTIONED = "";

interface ResultGroup {
  section: string;
  actions: CommandAction[];
}

/** Groups an already-ranked, already-flattened action list by section, preserving relative
 * order within and across groups — `command-palette-filtering` spec. Actions without a
 * `section` are grouped together under `UNSECTIONED` rather than dropped. */
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
  return order.map((section) => ({ section, actions: bySection.get(section)! }));
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

  const results = useMemo(() => rankActions(registeredActions, query), [registeredActions, query]);
  const groups = useMemo(() => groupBySection(results), [results]);

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

      {results.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No matching commands"
          description="Try a different search term."
        />
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
                          <span className="command-palette__item-title">{action.title}</span>
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
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
