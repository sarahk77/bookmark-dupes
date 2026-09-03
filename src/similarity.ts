// Title-based near-duplicate detection. normalizeUrl only merges bookmarks
// whose URLs are variations of each other; it can't catch the same page
// saved under a genuinely different URL (a redirect, a shortener, a query
// string that isn't a known tracking param). Comparing titles instead
// catches those, at the cost of missing pairs whose titles don't share
// words - "Hacker News" vs "HN" won't match here.

const STOPWORDS = new Set([
  "a", "an", "and", "or", "of", "the", "to", "in", "on", "for", "with", "at",
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));
}

// Jaccard similarity of the two titles' token sets: shared words over total
// distinct words, 0 for nothing in common, 1 for the same words regardless
// of order. Titles with no comparable tokens (empty, or only stopwords)
// always score 0 rather than dividing by zero.
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(titleTokens(a));
  const tokensB = new Set(titleTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}
