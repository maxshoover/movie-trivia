import Fuse from "fuse.js";

interface MatchCandidate {
  value: string;
  category: "TITLE" | "DIRECTOR" | "ACTOR" | "WRITER";
}

export interface MatchResult {
  matched: boolean;
  category: string | null;
  matchedValue: string | null;
  score: number;
}

const FUZZY_THRESHOLD = 0.35; // lower = stricter (0 = exact, 1 = match anything)

export function findBestMatch(
  guessText: string,
  candidates: MatchCandidate[]
): MatchResult {
  const fuse = new Fuse(candidates, {
    keys: ["value"],
    threshold: FUZZY_THRESHOLD,
    includeScore: true,
    isCaseSensitive: false,
    minMatchCharLength: 2,
  });

  const results = fuse.search(guessText.trim());

  if (results.length === 0) {
    return { matched: false, category: null, matchedValue: null, score: 1 };
  }

  const best = results[0];
  return {
    matched: true,
    category: best.item.category,
    matchedValue: best.item.value,
    score: best.score ?? 0,
  };
}
