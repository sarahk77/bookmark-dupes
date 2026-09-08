import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "../src/normalize.js";

test("https and http fold to the same key", () => {
  assert.equal(normalizeUrl("https://example.com/"), normalizeUrl("http://example.com/"));
});

test("host is lowercased", () => {
  assert.equal(normalizeUrl("https://Example.COM/"), "http://example.com/");
});

test("a trailing slash on a non-root path is dropped, root stays /", () => {
  assert.equal(normalizeUrl("https://example.com/docs/"), normalizeUrl("https://example.com/docs"));
  assert.equal(normalizeUrl("https://example.com/"), "http://example.com/");
});

test("a non-default port is kept", () => {
  assert.equal(normalizeUrl("https://example.com:8443/docs"), "http://example.com:8443/docs");
});

test("known tracking params are stripped, other query params are kept", () => {
  assert.equal(
    normalizeUrl("https://example.com/docs?utm_source=newsletter&id=42"),
    "http://example.com/docs?id=42",
  );
});

test("tracking param keys are matched case-insensitively", () => {
  assert.equal(normalizeUrl("https://example.com/?UTM_Source=x"), "http://example.com/");
});

test("remaining query params are sorted so key order doesn't matter", () => {
  assert.equal(
    normalizeUrl("https://example.com/?b=2&a=1"),
    normalizeUrl("https://example.com/?a=1&b=2"),
  );
});

test("a query string that becomes empty after stripping tracking params is dropped entirely", () => {
  assert.equal(normalizeUrl("https://example.com/docs?utm_source=x"), "http://example.com/docs");
});

test("strings that aren't valid URLs fall back to the trimmed original", () => {
  assert.equal(normalizeUrl("  not a url  "), "not a url");
  assert.equal(normalizeUrl("not a url"), "not a url");
});
