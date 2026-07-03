import { Component, type ErrorInfo, type ReactNode } from "react";

import "./ErrorBoundary.css";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** When this value changes, the boundary resets and re-renders its children.
   *  Pass a value that changes on navigation/context switches so recovering
   *  from a crash does not require a full page reload. */
  resetKey?: string | number | null;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/** Catches render/lifecycle errors in the routed content so a single failing
 *  view shows a recoverable panel instead of blanking the entire app. The
 *  error message and component stack are surfaced in the fallback (not just the
 *  console) so the cause is visible in production too. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Recover automatically when the caller signals a context change.
    if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // Keep the raw error in the console for stack traces and source mapping.
    console.error("Uncaught error in view:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    const { error, componentStack } = this.state;
    if (error === null) {
      return this.props.children;
    }

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__card">
          <h2 className="error-boundary__heading">Something went wrong</h2>
          <p className="error-boundary__message">{error.message || String(error)}</p>
          {componentStack && (
            <details className="error-boundary__details">
              <summary>Technical details</summary>
              <pre className="error-boundary__stack">
                {error.stack ?? ""}
                {componentStack}
              </pre>
            </details>
          )}
          <div className="error-boundary__actions">
            <button
              type="button"
              className="error-boundary__button error-boundary__button--primary"
              onClick={this.handleReset}
            >
              Try again
            </button>
            <button
              type="button"
              className="error-boundary__button"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
