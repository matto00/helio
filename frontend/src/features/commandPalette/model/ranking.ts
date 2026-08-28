import type { CommandAction } from "./types";

const enum Tier {
  TitlePrefix = 0,
  TitleSubstring = 1,
  TitleSubsequence = 2,
  Keyword = 3,
  NoMatch = 4,
}

/** Case-insensitive contiguous substring test. */
function isSubstring(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

/** Case-insensitive subsequence test: every character of `needle` appears in `haystack` in
 * order, not necessarily contiguously. */
function isSubsequence(haystack: string, needle: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function titleTier(title: string, query: string): Tier {
  if (title.startsWith(query)) return Tier.TitlePrefix;
  if (isSubstring(title, query)) return Tier.TitleSubstring;
  if (isSubsequence(title, query)) return Tier.TitleSubsequence;
  return Tier.NoMatch;
}

function keywordsMatch(keywords: string[] | undefined, query: string): boolean {
  if (!keywords) return false;
  return keywords.some((keyword) => isSubstring(keyword.toLowerCase(), query));
}

/** Scores `action` against `query` (already assumed lowercase), or `undefined` if it does not
 * match at all. `command-palette-filtering` spec: title-prefix > title-substring >
 * title-subsequence > keyword match. */
function scoreAction(action: CommandAction, query: string): Tier | undefined {
  const tier = titleTier(action.title.toLowerCase(), query);
  if (tier !== Tier.NoMatch) return tier;
  if (keywordsMatch(action.keywords, query)) return Tier.Keyword;
  return undefined;
}

export interface RankedAction {
  action: CommandAction;
  /** `undefined` for an opted-out (`matchesQuery`) action — it carries no local match strength. */
  tier: Tier | undefined;
  /** Original registration order — the stable tiebreak within equal-tier results. */
  index: number;
}

/**
 * Filters and orders `actions` against `query` (`command-palette-filtering` spec).
 *
 * - Empty query: every action is returned, unscored, in registration order (the "default list").
 * - Non-empty query: an action either matches (title prefix/substring/subsequence or keyword) and
 *   is scored, or declares `matchesQuery` and is kept unscored, or is dropped.
 * - Sort: scored actions first (stronger tier first, then registration index), followed by
 *   opted-out actions in the relative order their registrant supplied — never reordered by score,
 *   per the opt-out Requirement in `command-action-registry`.
 */
export function rankActions(actions: CommandAction[], query: string): CommandAction[] {
  const trimmed = query.trim().toLowerCase();

  if (trimmed === "") {
    return [...actions];
  }

  const matched: RankedAction[] = [];
  actions.forEach((action, index) => {
    if (action.matchesQuery) {
      matched.push({ action, tier: undefined, index });
      return;
    }
    const tier = scoreAction(action, trimmed);
    if (tier !== undefined) {
      matched.push({ action, tier, index });
    }
  });

  matched.sort((a, b) => {
    // Opted-out (tier undefined) actions always sort after scored ones.
    if (a.tier === undefined && b.tier === undefined) return a.index - b.index;
    if (a.tier === undefined) return 1;
    if (b.tier === undefined) return -1;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.index - b.index;
  });

  return matched.map((entry) => entry.action);
}
