import "./StatusMessage.css";

interface StatusMessageProps {
  status: "idle" | "loading" | "succeeded" | "failed";
  message?: string;
}

export function StatusMessage({ status, message }: StatusMessageProps) {
  if (status === "loading") {
    return <p className="status-message">{message ?? "Loading..."}</p>;
  }
  if (status === "failed") {
    return <p className="status-message status-message--error">{message}</p>;
  }
  return null;
}
