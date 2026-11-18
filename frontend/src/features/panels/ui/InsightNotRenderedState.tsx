/** HEL-1740: what an `insight` Output shows until a render store exists (HEL-921 L2). It never reads the Output's rows and
 *  calls no endpoint or model. Shared by the dashboard panel (`OutputPanelContent`) and the live Output column. */
export function InsightNotRenderedState() {
  return (
    <div className="panel-content panel-content--state" data-testid="insight-not-rendered">
      <span className="panel-content__state-label">Not yet rendered</span>
      <p className="panel-content__state-detail">
        This insight will appear after its first render.
      </p>
    </div>
  );
}
