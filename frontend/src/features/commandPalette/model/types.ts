import type { ReactNode } from "react";

/**
 * `command-action-registry` spec — the single typed contract every command-palette entry
 * conforms to. Only `id`, `title`, and `run` are required; a minimal action needs nothing else.
 */
export interface CommandAction {
  /** Stable, globally unique id. Colliding ids are a contributor bug — see `commandRegistry.ts`. */
  id: string;
  /** Displayed label. */
  title: string;
  /** Optional secondary line of context (e.g. a resource's type or parent) for entries whose
   * title alone is ambiguous — search/recents results in particular. */
  subtitle?: string;
  /** Extra terms that broaden matching without being displayed. */
  keywords?: string[];
  /** Section/group label results are clustered under. */
  section?: string;
  /** Icon rendered beside the title — a `lucide-react` icon element. */
  icon?: ReactNode;
  /**
   * Opts this action out of local title/keyword filtering — for a contributor whose entries were
   * already matched against the query by whoever produced them (a server-side search result, a
   * usage-ranked recent). When set, the palette shows the action for the current query without
   * re-testing it, and it is not scored by `rankActions`: it keeps the relative order its
   * registrant supplied, sorted after locally-matched actions within its section.
   */
  matchesQuery?: boolean;
  /** Invoked when the user selects this entry. */
  run: () => void;
}
