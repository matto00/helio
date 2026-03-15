import "./InlineError.css";

interface InlineErrorProps {
  error: string | null | undefined;
}

export function InlineError({ error }: InlineErrorProps) {
  if (!error) return null;
  return <p className="inline-error">{error}</p>;
}
