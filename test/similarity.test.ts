import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, titleTokens, titleSimilarity } from "../src/similarity.js";

test("normalizeTitle lowercases and collapses punctuation to spaces", () => {
  assert.equal(normalizeTitle("Bob's \"Site\" & More!"), "bob s site more");
});

test("titleTokens drops stopwords and empty tokens", () => {
  assert.deepEqual(titleTokens("The Example of a Docs Site"), ["example", "docs", "site"]);
});

test("titleSimilarity is 1 for identical titles regardless of order", () => {
  assert.equal(titleSimilarity("Hacker News", "Hacker News"), 1);
  assert.equal(titleSimilarity("News Hacker", "Hacker News"), 1);
});

test("titleSimilarity is 0 for titles with no shared words", () => {
  assert.equal(titleSimilarity("Hacker News", "Example Docs"), 0);
});

test("titleSimilarity is 0 when a title has no comparable tokens", () => {
  assert.equal(titleSimilarity("", "Hacker News"), 0);
  assert.equal(titleSimilarity("the a of", "Hacker News"), 0);
  assert.equal(titleSimilarity("", ""), 0);
});

test("titleSimilarity is the jaccard overlap of the token sets", () => {
  // "Docs" -> {docs}, "Example Docs" -> {example, docs}: 1 shared / 2 total
  assert.equal(titleSimilarity("Docs", "Example Docs"), 0.5);
});

test("titleSimilarity ignores stopwords when comparing", () => {
  assert.equal(titleSimilarity("The Example Docs", "Example Docs for the Team"), titleSimilarity("Example Docs", "Example Docs Team"));
});
