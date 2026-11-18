/** What an `insight` Output with no render shows (HEL-1740; exposed as a status, HEL-1744). It never reads the Output's rows
 *  and calls no endpoint or model. Shared by the insight panel body and the live Output column. */
export function InsightNotRenderedState() {
  return (
    <div
      className="panel-content panel-content--state"
      data-testid="insight-not-rendered"
      role="status"
    >
      <span className="panel-content__state-label">Not yet rendered</span>
      <p className="panel-content__state-detail">
        This insight will appear after its first render.
      </p>
    </div>
  );
}
