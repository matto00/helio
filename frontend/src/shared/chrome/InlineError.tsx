import "./InlineError.css";

interface InlineErrorProps {
  error: string | null | undefined;
  /** "banner" renders a boxed, higher-emphasis treatment (tinted background +
   *  padding + `role="alert"`) for a standalone error surface, e.g. a failed
   *  preview fetch. Defaults to "text" — the bare inline treatment used
   *  inside forms, unchanged from every existing call site (HEL UI-sweep
   *  F-051 promoted this from two independent hand-rolled boxed-error
   *  treatments; the bare "text" default intentionally keeps its existing,
   *  widely-reused markup untouched to avoid touching the ~30 other call
   *  sites' behavior). */
  variant?: "text" | "banner";
}

export function InlineError({ error, variant = "text" }: InlineErrorProps) {
  if (!error) return null;
  if (variant === "banner") {
    return (
      <p className="inline-error inline-error--banner" role="alert">
        {error}
      </p>
    );
  }
  return <p className="inline-error">{error}</p>;
}
