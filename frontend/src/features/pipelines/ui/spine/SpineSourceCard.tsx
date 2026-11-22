// SpineSourceCard -- HEL-1579 (design.md D5): one root's Source card on the spine -- the source's name
// (mono) and kind, with a quiet menu: Edit source (when the source resolves in the caller's own list,
// as before) and "Remove from pipeline". Removing removes the ROOT from this pipeline, not the data
// source, so it is not the Delete the owner ruling reserves for the overview rows (design.md D3).

import { memo } from "react";

import { ActionsMenu, type ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { labelForKind } from "../../../sources/utils/labelForKind";
import type { DataSource } from "../../../sources/types/dataSource";
import { useSourceSampleLabel } from "../../../sources/hooks/useSourceSampleLabel";
import { SourceSampleLabelView } from "../../../sources/ui/SourceSampleLabel";
import { isDraftClientId } from "../../state/draftOps";
import type { PipelineRoot } from "../../types/pipelineStep";

interface SpineSourceCardProps {
  /** `phone` (HEL-1582): the mono name is the "Edit source" button (when the source resolves), a sibling of the
   *  sample refresh and the "Source actions" menu, never nesting them. */
  variant?: "desktop" | "phone";
  root: PipelineRoot;
  /** The pipeline page this card is on: scopes the source's sample (HEL-1648). */
  pipelineId: string;
  /** `undefined` when the source is not resolvable in the caller's own list: no Edit item, no kind. */
  source: DataSource | undefined;
  /** 1-based ordinal, shown only when the pipeline has more than one source. */
  ordinal: number | null;
  /** False for the pipeline's last source (counted over the draft's roots while a draft exists). */
  canRemove: boolean;
  onEditSource: (sourceId: string) => void;
  onRemoveRoot: (rootId: string) => void;
}

// HEL-1809: memoised; its props keep their identity across a step edit, so the card skips the edit's render.
export const SpineSourceCard = memo(function SpineSourceCard({
  variant = "desktop",
  root,
  pipelineId,
  source,
  ordinal,
  canRemove,
  onEditSource,
  onRemoveRoot,
}: SpineSourceCardProps) {
  // HEL-1668: the sample label already says "Static · 30 rows" for a static source, so the kind meta is dropped
  // only when the rendered label text starts with the kind (loading / unavailable / truncated keep it).
  const sampleLabel = useSourceSampleLabel(root.dataSourceId, pipelineId);
  const sampleText = sampleLabel.text;
  const kind = source ? labelForKind(source.type) : null;
  const labelNamesKind = kind !== null && sampleText !== null && sampleText.startsWith(kind);
  const nameContent = (
    <>
      {ordinal !== null && <span className="spine-card__ordinal">{ordinal}</span>}
      {root.dataSourceName}
    </>
  );
  const items: ActionsMenuItem[] = [
    ...(source
      ? [
          {
            label: "Edit source",
            ariaLabel: `Edit source ${root.dataSourceName}`,
            onClick: () => onEditSource(source.id),
          },
        ]
      : []),
    {
      label: "Remove from pipeline",
      ariaLabel: `Remove source ${root.dataSourceName} from this pipeline`,
      disabled: !canRemove,
      onClick: () => onRemoveRoot(root.id),
    },
  ];
  return (
    <div
      className="spine-card spine-source-card"
      data-draft-root={isDraftClientId(root.id) ? "true" : undefined}
    >
      <div className="spine-card__text">
        {variant === "phone" && source ? (
          // The button itself must not clip (overflow would cut off its hit expander); the name inside ellipsizes.
          <button
            type="button"
            className="spine-card__name-btn"
            aria-label={`Edit source ${root.dataSourceName}`}
            onClick={() => onEditSource(source.id)}
          >
            <span className="spine-card__name">{nameContent}</span>
          </button>
        ) : (
          <span className="spine-card__name">{nameContent}</span>
        )}
        {kind !== null && !labelNamesKind && <span className="spine-card__meta">{kind}</span>}
        {isDraftClientId(root.id) && <span className="spine-card__meta">New · not saved</span>}
        <SourceSampleLabelView
          label={sampleLabel}
          sourceId={root.dataSourceId}
          sourceName={root.dataSourceName}
          pipelineId={pipelineId}
        />
      </div>
      <div className="spine-card__menu">
        <ActionsMenu label={`Source actions for ${root.dataSourceName}`} items={items} />
      </div>
    </div>
  );
});
