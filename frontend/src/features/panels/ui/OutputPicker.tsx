import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlignLeft, FileText, Image as ImageIcon, Minus, Search } from "lucide-react";

import "./OutputPicker.css";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { Spinner } from "../../../shared/ui/Spinner";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { createPanel, swapPanelOutput } from "../state/panelThunks";
import { useOutputPickerData, type OutputPickerEntry } from "../hooks/useOutputPickerData";
import type { Panel, PanelKind } from "../types/panel";

/** Stable id prefix for the flattened options — used both as the DOM `id`
 *  each `role="option"` card carries and as the `aria-activedescendant`
 *  value the search input publishes, per DESIGN.md §8 / the ADDED
 *  `output-picker` "Picker is keyboard-operable" requirement. */
const OPTION_ID_PREFIX = "output-picker-option-";

const CONTENT_PANEL_KINDS: { kind: PanelKind; label: string; icon: ReactElement }[] = [
  { kind: "text", label: "Text", icon: <FileText size={18} /> },
  { kind: "markdown", label: "Markdown", icon: <AlignLeft size={18} /> },
  { kind: "image", label: "Image", icon: <ImageIcon size={18} /> },
  { kind: "divider", label: "Divider", icon: <Minus size={18} /> },
];

// Flattened, keyboard-navigable item — either an Output entry or one of the
// four content-panel row buttons. `OutputPicker`'s arrow-key nav walks this
// flat list rather than the two-level grouped structure so Enter/arrow logic
// doesn't need to know about groups at all.
type FlatItem =
  | { type: "output"; entry: OutputPickerEntry }
  | { type: "content"; kind: PanelKind; label: string };

interface OutputPickerProps {
  dashboardId: string;
  currentDashboardPanels: Panel[];
  onClose: () => void;
  /** "place" (default): create a new panel bound to the selected Output.
   *  "swap": replace `swapPanelId`'s own `outputId` in place instead, per
   *  `specs/panel-detail-modal/spec.md`'s "Swap output re-uses the picker". */
  mode?: "place" | "swap";
  swapPanelId?: string;
}

export function OutputPicker({
  dashboardId,
  currentDashboardPanels,
  onClose,
  mode = "place",
  swapPanelId,
}: OutputPickerProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { groups, isLoading, error, hasPlacementCountError } =
    useOutputPickerData(currentDashboardPanels);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Separate from `focusedIndex` (HEL-909 CR1/CR4 round-2 fix): hover must
  // never write the keyboard-focus state. `scrollIntoView` moving a card
  // under a stationary cursor fires a real `mouseenter`, and reusing
  // `focusedIndex` for both let that hijack arrow-key nav mid-scroll. Only
  // this drives the neutral hover CSS treatment; `focusedIndex` alone still
  // drives `aria-activedescendant` / `aria-selected` / the accent focus ring.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return groups;
    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter(
          (entry) =>
            entry.output.name.toLowerCase().includes(q) ||
            group.pipelineName.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, query]);

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (const group of filteredGroups) {
      for (const entry of group.entries) {
        items.push({ type: "output", entry });
      }
    }
    // The content-panel row is only meaningful in "place" mode — swap mode
    // replaces an existing panel's Output, and a content panel has none.
    if (mode === "place") {
      for (const { kind, label } of CONTENT_PANEL_KINDS) {
        items.push({ type: "content", kind, label });
      }
    }
    return items;
  }, [filteredGroups, mode]);

  async function placeOutput(outputId: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === "swap" && swapPanelId) {
        // Swap mode PATCHes the panel's own outputId in place (preserving
        // position/size), through the normal thunk/service path
        // (`panelService.patchPanelOutputId` + `swapPanelOutput`, HEL-909
        // CR4) rather than the Output resource itself.
        await dispatch(swapPanelOutput({ panelId: swapPanelId, outputId, dashboardId })).unwrap();
      } else {
        await dispatch(createPanel({ dashboardId, type: "output", outputId })).unwrap();
      }
      onClose();
    } catch {
      setIsSubmitting(false);
      setSubmitError(
        mode === "swap"
          ? "Failed to swap output. Please try again."
          : "Failed to add panel. Please try again.",
      );
    }
  }

  async function placeContentPanel(kind: PanelKind) {
    if (isSubmitting) return;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await dispatch(createPanel({ dashboardId, type: kind })).unwrap();
      onClose();
    } catch {
      setIsSubmitting(false);
      setSubmitError("Failed to add panel. Please try again.");
    }
  }

  function activate(item: FlatItem) {
    if (item.type === "output") void placeOutput(item.entry.output.id);
    else void placeContentPanel(item.kind);
  }

  // Reading-order virtual focus: Down/Right advance, Up/Left retreat, through
  // the same flattened `flatItems` sequence the grid renders in DOM order.
  // The picker's cards wrap across a variable, auto-fill column count per
  // pipeline group, so there's no single "row width" to map onto axis-true
  // up/down — reading order is the one geometry-independent semantics that
  // stays correct regardless of viewport/group size (HEL-909 CR1/CR2).
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (flatItems.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[focusedIndex];
      if (item) activate(item);
    }
  }

  // Real listbox-pattern virtual focus (DESIGN.md §8 / output-picker spec
  // "arrow keys move focus"): the search input keeps DOM focus (so typing
  // keeps working), `aria-activedescendant` publishes which option is
  // logically focused, and the focused option's card is scrolled into view
  // on every move so it can never park off-screen (HEL-909 CR1).
  useEffect(() => {
    const el = optionRefs.current.get(focusedIndex);
    // jsdom (unit tests) has no `scrollIntoView` implementation at all —
    // guard rather than assume every DOM environment provides it.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [focusedIndex]);

  const activeDescendantId =
    flatItems.length > 0 ? `${OPTION_ID_PREFIX}${focusedIndex}` : undefined;

  const outputIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flatItems.forEach((item, index) => {
      if (item.type === "output") map.set(item.entry.output.id, index);
    });
    return map;
  }, [flatItems]);

  const contentIndexByKind = useMemo(() => {
    const map = new Map<PanelKind, number>();
    flatItems.forEach((item, index) => {
      if (item.type === "content") map.set(item.kind, index);
    });
    return map;
  }, [flatItems]);

  return (
    <Modal
      open
      size="lg"
      title={mode === "swap" ? "Swap output" : "Add panel"}
      ariaLabel={mode === "swap" ? "Swap output" : "Add panel"}
      onClose={onClose}
      className="output-picker"
    >
      <div className="output-picker__inner" onKeyDown={handleKeyDown}>
        <TextField
          ref={searchRef}
          type="search"
          className="output-picker__search"
          placeholder="Search outputs and pipelines…"
          aria-label="Search outputs"
          aria-controls="output-picker-listbox"
          aria-activedescendant={activeDescendantId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIndex(0);
          }}
        />

        {submitError ? (
          <p className="output-picker__status output-picker__status--error" role="alert">
            {submitError}
          </p>
        ) : null}

        {!isLoading && !error && hasPlacementCountError ? (
          <p className="output-picker__status output-picker__status--error" role="alert">
            Some placement counts could not be loaded and may be shown as 0.
          </p>
        ) : null}

        {isLoading ? (
          <p className="output-picker__status" role="status">
            <Spinner size="md" /> Loading outputs…
          </p>
        ) : error ? (
          <p className="output-picker__status output-picker__status--error">{error}</p>
        ) : filteredGroups.length === 0 ? (
          <EmptyState
            icon={<Search size={28} />}
            title="No output fits?"
            description="Shape more data into an Output, or ask the assistant to help."
            cta={{ label: "New pipeline", onClick: () => navigate("/pipelines") }}
            secondaryCta={{ label: "Ask the assistant", onClick: () => navigate("/chat") }}
          />
        ) : (
          <div
            className="output-picker__groups"
            role="listbox"
            id="output-picker-listbox"
            aria-label="Outputs"
          >
            {filteredGroups.map((group) => (
              <div key={group.pipelineId} className="output-picker__group">
                <h3 className="output-picker__group-heading eyebrow">{group.pipelineName}</h3>
                <div className="output-picker__cards">
                  {group.entries.map((entry) => {
                    const index = outputIndexById.get(entry.output.id) ?? -1;
                    return (
                      <button
                        key={entry.output.id}
                        ref={(el) => {
                          if (el) optionRefs.current.set(index, el);
                          else optionRefs.current.delete(index);
                        }}
                        id={`${OPTION_ID_PREFIX}${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === focusedIndex}
                        className={`output-picker__card${
                          index === focusedIndex ? " output-picker__card--focused" : ""
                        }${index === hoveredIndex ? " output-picker__card--hovered" : ""}${
                          entry.onThisBoard ? " output-picker__card--placed" : ""
                        }`}
                        aria-label={`${entry.output.name} (${group.pipelineName})${
                          entry.onThisBoard ? ", already on this board" : ""
                        }`}
                        onClick={() => void placeOutput(entry.output.id)}
                        onMouseEnter={() => setHoveredIndex(index)}
                        onMouseLeave={() => setHoveredIndex((i) => (i === index ? null : i))}
                        tabIndex={-1}
                        disabled={isSubmitting}
                      >
                        <span className="output-picker__card-kind">{entry.output.kind}</span>
                        <span className="output-picker__card-name">{entry.output.name}</span>
                        <span className="output-picker__card-count">
                          {entry.placementCount} placement{entry.placementCount === 1 ? "" : "s"}
                        </span>
                        {entry.onThisBoard ? (
                          <span className="output-picker__card-badge">On this board</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {mode === "place" ? (
          <div className="output-picker__content-row">
            <h3 className="output-picker__group-heading eyebrow">Content</h3>
            <div className="output-picker__cards" role="listbox" aria-label="Content panels">
              {CONTENT_PANEL_KINDS.map(({ kind, label, icon }) => {
                const index = contentIndexByKind.get(kind) ?? -1;
                return (
                  <button
                    key={kind}
                    ref={(el) => {
                      if (el) optionRefs.current.set(index, el);
                      else optionRefs.current.delete(index);
                    }}
                    id={`${OPTION_ID_PREFIX}${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === focusedIndex}
                    className={`output-picker__card output-picker__card--content${
                      index === focusedIndex ? " output-picker__card--focused" : ""
                    }${index === hoveredIndex ? " output-picker__card--hovered" : ""}`}
                    aria-label={`Add ${label} panel`}
                    onClick={() => void placeContentPanel(kind)}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex((i) => (i === index ? null : i))}
                    tabIndex={-1}
                    disabled={isSubmitting}
                  >
                    {icon}
                    <span className="output-picker__card-name">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
