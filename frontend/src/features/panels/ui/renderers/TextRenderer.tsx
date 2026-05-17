import type { MappedPanelData } from "../../../../types/models";

interface TextRendererProps {
  /** Bound text data, if the panel was fetched against a DataType. */
  data?: MappedPanelData | null;
  /** Config-side content for unbound text panels (CS2c-3c). */
  content?: string | null;
}

export function TextRenderer({ data, content }: TextRendererProps) {
  // Bound data path takes priority for backwards-compatibility; otherwise fall
  // back to the typed-config `content` field.
  const live = data?.content ?? content ?? null;
  if (live && live.length > 0) {
    return (
      <div className="panel-content panel-content--text">
        <span className="panel-content__text-live">{live}</span>
      </div>
    );
  }
  return (
    <div className="panel-content panel-content--text" aria-hidden="true">
      <span className="panel-content__text-line panel-content__text-line--long" />
      <span className="panel-content__text-line panel-content__text-line--short" />
    </div>
  );
}
