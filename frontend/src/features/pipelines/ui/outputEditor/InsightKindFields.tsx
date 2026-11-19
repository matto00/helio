// HEL-1744 D2 -- the insight settings card: preset, the Outputs it reads, when it refreshes, and an optional custom
// prompt. Every control has a label; nothing here needs typing (defaults are filled in).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Select, Textarea } from "../../../../shared/ui/index";
import { SegmentedRadioGroup } from "../../../../shared/ui/SegmentedRadioGroup";
import { fetchAssistantModels } from "../../../assistant/services/assistantConversationsService";
import type { AssistantModelOption } from "../../../assistant/types";
import type { Output } from "../../types/output";
import { sameIdSet, sameInsightNode, type InsightNodeRef } from "./insightNode";
import {
  INSIGHT_MAX_PROMPT_CHARS,
  INSIGHT_MAX_READ_OUTPUTS,
  type InsightRefreshValue,
} from "./outputConfigTypes";
import type { OutputKindState } from "./useOutputKindState";

const PRESET_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "delta", label: "Change since last run" },
  { value: "trend", label: "Trend over time" },
  { value: "leaders", label: "Top and bottom" },
  { value: "summary", label: "Summary" },
];

const REFRESH_OPTIONS: { value: InsightRefreshValue; label: string }[] = [
  { value: "on_run", label: "On every run" },
  { value: "daily", label: "Daily" },
  { value: "manual", label: "Manual only" },
];

/** DESIGN.md "Long lists": a list longer than this shows the first rows and a control to show the rest. */
const CHECKLIST_CAP = 8;

interface InsightKindFieldsProps {
  kindState: OutputKindState;
  /** The pipeline's saved Outputs an insight may read (the insight itself, other insights and unsaved Outputs already removed). */
  candidates: Output[];
  node: InsightNodeRef;
  /** The signed-in user owns the pipeline AND is on the free tier: renders are charged to the pipeline owner. */
  showUpsell: boolean;
  tooMany: boolean;
}

export function InsightKindFields({
  kindState,
  candidates,
  node,
  showUpsell,
  tooMany,
}: InsightKindFieldsProps) {
  const {
    insightPreset,
    setInsightPreset,
    insightRefresh,
    setInsightRefresh,
    insightPrompt,
    setInsightPrompt,
    insightModel,
    setInsightModel,
    insightReads,
    setInsightReads,
    insightDefaultReads,
  } = kindState;
  // HEL-1743 D13: the selectable models. A failed or refused read (a free-tier caller gets a 403) hides the selector and
  // never blocks saving: no `model` is then written and the server default applies.
  const [models, setModels] = useState<AssistantModelOption[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchAssistantModels().then(
      (r) => live && setModels(r.models),
      () => live && setModels(null),
    );
    return () => {
      live = false;
    };
  }, []);
  const modelOptions = models
    ? [
        { value: "", label: "Server default" },
        ...models.map((m) => ({ value: m.id, label: m.label })),
        // A stored id the picker no longer offers stays visible, so it is never silently swapped.
        ...(insightModel !== "" && !models.some((m) => m.id === insightModel)
          ? [{ value: insightModel, label: insightModel }]
          : []),
      ]
    : null;
  const [promptOpen, setPromptOpen] = useState(insightPrompt.length > 0);
  const [showAll, setShowAll] = useState(false);
  const ticked = insightReads ?? insightDefaultReads;

  function toggle(id: string, checked: boolean) {
    const next = checked ? [...ticked, id] : ticked.filter((t) => t !== id);
    setInsightReads(sameIdSet(next, insightDefaultReads) ? null : next);
  }

  const sameNode = candidates.filter((o) => sameInsightNode(node, o));
  const otherNodes = candidates.filter((o) => !sameInsightNode(node, o));
  const ordered = [...sameNode, ...otherNodes];
  const capped = !showAll && ordered.length > CHECKLIST_CAP;
  const visible = capped ? ordered.slice(0, CHECKLIST_CAP) : ordered;
  const visibleSame = visible.filter((o) => sameNode.includes(o));
  const visibleOther = visible.filter((o) => !sameNode.includes(o));

  const row = (o: Output) => (
    <li key={o.id} className="insight-fields__item">
      <label className="insight-fields__label tap-expand-44">
        <input
          type="checkbox"
          className="insight-fields__checkbox"
          checked={ticked.includes(o.id)}
          onChange={(e) => toggle(o.id, e.target.checked)}
        />
        <span className="insight-fields__name">{o.name}</span>
        <span className="insight-fields__kind">{o.kind}</span>
      </label>
    </li>
  );

  return (
    <div className="insight-fields">
      {showUpsell && (
        <p className="output-editor-sheet__field-hint">
          <span>Insights render on the beta plan.</span>{" "}
          <Link
            className="output-editor-sheet__upsell-link"
            to="/settings#beta-access"
            target="_blank"
            rel="noopener noreferrer"
          >
            Request Beta access<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </p>
      )}

      <div className="output-editor-sheet__data-section">
        <label className="output-editor-sheet__data-label" htmlFor="insight-preset">
          Preset
        </label>
        <Select
          id="insight-preset"
          ariaLabel="Preset"
          value={insightPreset}
          onChange={setInsightPreset}
          options={PRESET_OPTIONS}
        />
      </div>
      {modelOptions && (
        <div className="output-editor-sheet__data-section">
          <label className="output-editor-sheet__data-label" htmlFor="insight-model">
            Model
          </label>
          <Select
            id="insight-model"
            ariaLabel="Model"
            value={insightModel}
            onChange={setInsightModel}
            options={modelOptions}
          />
        </div>
      )}

      <fieldset className="insight-fields__reads">
        <legend className="output-editor-sheet__data-label">Outputs it reads</legend>
        {candidates.length === 0 ? (
          <p className="output-editor-sheet__field-hint">
            This pipeline has no other Outputs to read yet.
          </p>
        ) : (
          <>
            {visibleSame.length > 0 && (
              <>
                <p className="insight-fields__group">Same node</p>
                <ul className="insight-fields__list" role="list">
                  {visibleSame.map(row)}
                </ul>
              </>
            )}
            {visibleOther.length > 0 && (
              <>
                <p className="insight-fields__group">Other steps</p>
                <ul className="insight-fields__list" role="list">
                  {visibleOther.map(row)}
                </ul>
              </>
            )}
            {ordered.length > CHECKLIST_CAP && (
              <button
                type="button"
                className="insight-fields__show-all tap-expand-44"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show fewer" : `Show all ${ordered.length}`}
              </button>
            )}
          </>
        )}
        {tooMany && (
          <p className="insight-fields__error" role="alert">
            An insight can read at most {INSIGHT_MAX_READ_OUTPUTS} Outputs. Untick some to save.
          </p>
        )}
      </fieldset>

      <div className="output-editor-sheet__data-section">
        <span className="output-editor-sheet__data-label" id="insight-refresh-label">
          Refresh
        </span>
        <SegmentedRadioGroup
          label="Refresh"
          options={REFRESH_OPTIONS}
          value={(insightRefresh as InsightRefreshValue) || "on_run"}
          onChange={setInsightRefresh}
        />
      </div>

      <details
        className="insight-fields__prompt"
        open={promptOpen}
        onToggle={(e) => setPromptOpen(e.currentTarget.open)}
      >
        <summary className="disclosure-summary tap-expand-44">Custom prompt</summary>
        <div className="output-editor-sheet__data-section">
          <Textarea
            aria-label="Custom prompt"
            value={insightPrompt}
            maxLength={INSIGHT_MAX_PROMPT_CHARS}
            rows={4}
            onChange={(e) => setInsightPrompt(e.target.value)}
          />
          <p className="output-editor-sheet__field-hint">
            {insightPrompt.length} / {INSIGHT_MAX_PROMPT_CHARS}
          </p>
        </div>
      </details>
    </div>
  );
}
