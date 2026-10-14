interface TextRendererProps {
  /** The panel's literal `config.content`; a text panel has no data binding. */
  content?: string | null;
}

export function TextRenderer({ content }: TextRendererProps) {
  const live = content ?? null;
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
