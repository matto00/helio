// SpineSourceCard -- HEL-1579 (design.md D5): one root's Source card on the spine -- the source's name
// (mono) and kind, with a quiet menu: Edit source (when the source resolves in the caller's own list,
// as before) and "Remove from pipeline". Removing removes the ROOT from this pipeline, not the data
// source, so it is not the Delete the owner ruling reserves for the overview rows (design.md D3).

import { ActionsMenu, type ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { labelForKind } from "../../../sources/utils/labelForKind";
import type { DataSource } from "../../../sources/types/dataSource";
import { SourceSampleLabel } from "../../../sources/ui/SourceSampleLabel";
import type { PipelineRoot } from "../../types/pipelineStep";

interface SpineSourceCardProps {
  root: PipelineRoot;
  /** The pipeline page this card is on: scopes the source's sample (HEL-1648). */
  pipelineId: string;
  /** `undefined` when the source is not resolvable in the caller's own list: no Edit item, no kind. */
  source: DataSource | undefined;
  /** 1-based ordinal, shown only when the pipeline has more than one source. */
  ordinal: number | null;
  canRemove: boolean;
  onEditSource: (sourceId: string) => void;
  onRemoveRoot: (rootId: string) => void;
}

export function SpineSourceCard({
  root,
  pipelineId,
  source,
  ordinal,
  canRemove,
  onEditSource,
  onRemoveRoot,
}: SpineSourceCardProps) {
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
    <div className="spine-card spine-source-card">
      <div className="spine-card__text">
        <span className="spine-card__name">
          {ordinal !== null && <span className="spine-card__ordinal">{ordinal}</span>}
          {root.dataSourceName}
        </span>
        {source && <span className="spine-card__meta">{labelForKind(source.type)}</span>}
        <SourceSampleLabel
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
}
