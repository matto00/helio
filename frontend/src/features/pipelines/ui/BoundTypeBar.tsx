// BoundTypeBar — read-only display of the pipeline's bound output DataType,
// shown directly below BoundSourceBar on PipelineDetailPage. Mirrors
// BoundSourceBar's visual structure (label + value + right-aligned Edit
// button) but stays a separate component: a pipeline's source and output
// type are independently owned resources (see `pipeline-editor-page` spec),
// and keeping the bars separate keeps each one honest about a single
// concern rather than merging two into one.

interface BoundTypeBarProps {
  /** The pipeline's bound output DataType name (`Pipeline.outputDataTypeName`). */
  outputTypeName: string;
  /** Whether the current user owns the output DataType (i.e. it is
   *  resolvable in their own owner-scoped `dataTypes.items`). Gates the
   *  "Edit Type" button — see `pipeline-editor-page` spec. */
  canEditType: boolean;
  /** Navigates to the type's detail view. Only invoked when `canEditType` is
   *  true (the button is not rendered otherwise). */
  onEditType: () => void;
}

export function BoundTypeBar({ outputTypeName, canEditType, onEditType }: BoundTypeBarProps) {
  return (
    <div className="pipeline-detail-page__type-bar">
      <span className="pipeline-detail-page__type-bar-label">OUTPUT TYPE</span>
      <div className="pipeline-detail-page__bound-type">
        <span className="pipeline-detail-page__bound-type-name">{outputTypeName}</span>
      </div>
      {canEditType && (
        <button className="pipeline-detail-page__edit-btn" onClick={onEditType} type="button">
          Edit Type
        </button>
      )}
    </div>
  );
}
