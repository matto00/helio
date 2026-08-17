// Preferences editor (HEL-525 / 420-D task 3.2): `defaultSeriesColors`
// add/remove/edit swatches, `defaultPanelStyle` background/text-color/
// transparency (three concrete fields per design.md Decision 2, mirroring
// `AppearanceEditor.tsx`'s color/range-input recipe), and a `namingConventions`
// string-values-only generic key/value rows editor. An explicit "Save"
// button (design.md Decision 3, not auto-save).
//
// design.md Decision 4 -- the load-bearing rule this component exists to
// enforce: on save, `defaultPanelStyle`/`namingConventions` are a *shallow
// merge* of the edited/recognized keys over the full fetched object, never a
// wholesale replacement, and `extras` passes through unchanged. Any
// `namingConventions` key whose fetched value is not a JSON string is never
// rendered as an editable row and is carried through untouched (design.md
// Decision 2 -- the round-1/round-2 skeptic finding this guards against).

import { type FormEvent, useState } from "react";
import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { InlineError } from "../../../shared/chrome/InlineError";
import { TextField } from "../../../shared/ui/index";
import { getColorInputValue } from "../../../theme/appearance";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { savePreferences } from "../state/settingsSlice";
import type { AgentPreferences, PutAgentPreferencesRequest } from "../types/preferences";
import "./PreferencesEditor.css";

const DEFAULT_BACKGROUND = "#1c1c1c";
const DEFAULT_TEXT_COLOR = "#ffffff";
const DEFAULT_NEW_SWATCH = "#888888";

interface NamingConventionRow {
  /** Stable identity for React keys / edits — independent of the (editable)
   *  key text, so renaming a key doesn't reorder or lose focus. */
  id: string;
  key: string;
  value: string;
}

function toColorInputValue(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? getColorInputValue(raw, fallback) : fallback;
}

function toTransparencyValue(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `row-${rowIdCounter}`;
}

function stringEntries(obj: Record<string, unknown>): NamingConventionRow[] {
  return Object.entries(obj)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => ({ id: nextRowId(), key, value }));
}

/** F-152 (UI sweep): rows sharing the same trimmed key silently collapse to
 *  whichever comes last when `Object.fromEntries` runs on save, discarding
 *  every earlier value with no warning. Surfaced live (as the user types, not
 *  only at submit time) so the loss can never happen silently, and Save is
 *  blocked while any collision remains -- see `handleSubmit`. */
function duplicateNamingKeys(rows: NamingConventionRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [key, count] of counts) {
    if (count > 1) duplicates.add(key);
  }
  return duplicates;
}

interface PreferencesEditorProps {
  preferences: AgentPreferences;
}

export function PreferencesEditor({ preferences }: PreferencesEditorProps) {
  const dispatch = useAppDispatch();
  const { saveStatus, saveError } = useAppSelector((state) => state.settings.preferences);

  const panelStyleBase = preferences.defaultPanelStyle ?? {};
  const namingConventionsBase = preferences.namingConventions ?? {};

  const [seriesColors, setSeriesColors] = useState<string[]>(preferences.defaultSeriesColors ?? []);
  const [background, setBackground] = useState(
    toColorInputValue(panelStyleBase.background, DEFAULT_BACKGROUND),
  );
  const [color, setColor] = useState(toColorInputValue(panelStyleBase.color, DEFAULT_TEXT_COLOR));
  const [transparency, setTransparency] = useState(
    toTransparencyValue(panelStyleBase.transparency, 0),
  );
  const [namingRows, setNamingRows] = useState<NamingConventionRow[]>(
    stringEntries(namingConventionsBase),
  );
  // F-150: local confirmation flag, independent of `saveStatus` -- cleared on
  // every edit and at the start of every submit so it can never keep
  // claiming "saved" once the form has since changed, then set once a save
  // actually round-trips successfully (mirrors `TypeDetailPanel.tsx`'s
  // `saved` state shape).
  const [showSavedConfirmation, setShowSavedConfirmation] = useState(false);

  function markEdited() {
    setShowSavedConfirmation(false);
  }

  function addSeriesColor() {
    markEdited();
    setSeriesColors((prev) => [...prev, DEFAULT_NEW_SWATCH]);
  }

  function updateSeriesColor(index: number, hex: string) {
    markEdited();
    setSeriesColors((prev) => prev.map((c, i) => (i === index ? hex : c)));
  }

  function removeSeriesColor(index: number) {
    markEdited();
    setSeriesColors((prev) => prev.filter((_, i) => i !== index));
  }

  function addNamingRow() {
    markEdited();
    setNamingRows((prev) => [...prev, { id: nextRowId(), key: "", value: "" }]);
  }

  function updateNamingRowKey(id: string, key: string) {
    markEdited();
    setNamingRows((prev) => prev.map((row) => (row.id === id ? { ...row, key } : row)));
  }

  function updateNamingRowValue(id: string, value: string) {
    markEdited();
    setNamingRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)));
  }

  function removeNamingRow(id: string) {
    markEdited();
    setNamingRows((prev) => prev.filter((row) => row.id !== id));
  }

  const duplicateKeys = duplicateNamingKeys(namingRows);
  const hasDuplicateNamingKeys = duplicateKeys.size > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    markEdited();
    // F-152: never let a collapsing duplicate-key merge silently discard a
    // row's value -- block the round-trip entirely until keys are unique.
    if (hasDuplicateNamingKeys) return;

    // Shallow merge: overwrite only the three recognized fields, preserve
    // any other key this editor doesn't expose (design.md Decision 4).
    const mergedPanelStyle: Record<string, unknown> = {
      ...panelStyleBase,
      background,
      color,
      transparency,
    };

    // Non-string-valued keys (never rendered as rows -- design.md Decision 2)
    // are carried through untouched; the edited/added string rows overlay
    // on top, keyed by their (possibly-renamed) key text.
    const nonStringNamingEntries = Object.entries(namingConventionsBase).filter(
      ([, value]) => typeof value !== "string",
    );
    const editedNamingEntries = namingRows
      .map((row): [string, string] | null => (row.key.trim() ? [row.key.trim(), row.value] : null))
      .filter((entry): entry is [string, string] => entry !== null);
    const mergedNamingConventions: Record<string, unknown> = Object.fromEntries([
      ...nonStringNamingEntries,
      ...editedNamingEntries,
    ]);

    const request: PutAgentPreferencesRequest = {
      defaultSeriesColors: seriesColors,
      defaultPanelStyle: mergedPanelStyle,
      namingConventions: mergedNamingConventions,
      // Never edited by this UI -- passed through unchanged.
      extras: preferences.extras,
    };

    const result = await dispatch(savePreferences(request));
    if (savePreferences.fulfilled.match(result)) setShowSavedConfirmation(true);
  }

  const isSaving = saveStatus === "loading";

  return (
    <form className="preferences-editor" onSubmit={(e) => void handleSubmit(e)}>
      <section className="preferences-editor__section">
        {/* F-149: subsection heading nested under this page's "Preferences"
            H2 (`SettingsPage.tsx`) -- H3, not a sibling H2. */}
        <h3 className="preferences-editor__section-heading">Default series colors</h3>
        <ul className="preferences-editor__swatch-list">
          {seriesColors.map((hex, index) => (
            <li key={index} className="preferences-editor__swatch-row">
              <input
                type="color"
                value={getColorInputValue(hex, DEFAULT_NEW_SWATCH)}
                onChange={(e) => updateSeriesColor(index, e.target.value)}
                aria-label={`Series color ${index + 1}`}
              />
              <TextField
                mono
                value={hex}
                onChange={(e) => updateSeriesColor(index, e.target.value)}
                aria-label={`Series color ${index + 1} hex value`}
              />
              <button
                type="button"
                className="preferences-editor__icon-btn"
                aria-label={`Remove series color ${index + 1}`}
                onClick={() => removeSeriesColor(index)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="preferences-editor__add-btn" onClick={addSeriesColor}>
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
          Add color
        </button>
      </section>

      <section className="preferences-editor__section">
        <h3 className="preferences-editor__section-heading">Default panel style</h3>
        <div className="preferences-editor__row">
          <label className="preferences-editor__field">
            <span>Background</span>
            <input
              type="color"
              value={background}
              onChange={(e) => {
                markEdited();
                setBackground(e.target.value);
              }}
              aria-label="Default panel background color"
            />
          </label>
          <label className="preferences-editor__field">
            <span>Text</span>
            <input
              type="color"
              value={color}
              onChange={(e) => {
                markEdited();
                setColor(e.target.value);
              }}
              aria-label="Default panel text color"
            />
          </label>
        </div>
        <label className="preferences-editor__slider">
          <span>Transparency</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={transparency}
            onChange={(e) => {
              markEdited();
              setTransparency(Number(e.target.value));
            }}
            aria-label="Default panel transparency"
          />
          <strong>{transparency}%</strong>
        </label>
      </section>

      <section className="preferences-editor__section">
        <h3 className="preferences-editor__section-heading">Naming conventions</h3>
        <ul className="preferences-editor__row-list">
          {namingRows.map((row) => {
            const trimmedKey = row.key.trim();
            const isDuplicateKey = trimmedKey !== "" && duplicateKeys.has(trimmedKey);
            return (
              <li key={row.id} className="preferences-editor__kv-row">
                <TextField
                  value={row.key}
                  onChange={(e) => updateNamingRowKey(row.id, e.target.value)}
                  placeholder="Key"
                  aria-label="Naming convention key"
                  aria-invalid={isDuplicateKey}
                />
                <TextField
                  value={row.value}
                  onChange={(e) => updateNamingRowValue(row.id, e.target.value)}
                  placeholder="Value"
                  aria-label="Naming convention value"
                />
                <button
                  type="button"
                  className="preferences-editor__icon-btn"
                  aria-label={`Remove naming convention ${row.key || "row"}`}
                  onClick={() => removeNamingRow(row.id)}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </li>
            );
          })}
        </ul>
        {namingRows.length === 0 && (
          <p className="preferences-editor__empty-hint">No naming conventions set.</p>
        )}
        {hasDuplicateNamingKeys && (
          // F-152: live, as-you-type warning (not just a submit-time toast) --
          // the row-level `aria-invalid` above marks which fields collide,
          // this names them and explains the consequence, and Save is
          // disabled below until every key is unique.
          <p className="preferences-editor__naming-warning" role="alert">
            Duplicate key{duplicateKeys.size === 1 ? "" : "s"}: {[...duplicateKeys].join(", ")} —
            only the last row for each will be saved. Rename one before saving.
          </p>
        )}
        <button type="button" className="preferences-editor__add-btn" onClick={addNamingRow}>
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
          Add naming convention
        </button>
      </section>

      <div className="preferences-editor__actions">
        {showSavedConfirmation && (
          <p className="preferences-editor__saved" role="status">
            Preferences saved.
          </p>
        )}
        <InlineError error={saveError} />
        <button
          type="submit"
          className="preferences-editor__save-btn"
          disabled={isSaving || hasDuplicateNamingKeys}
          title={
            hasDuplicateNamingKeys
              ? "Resolve duplicate naming-convention keys before saving."
              : undefined
          }
        >
          {isSaving ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
