import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBookmarksHtml } from "../src/parser.js";

// A trimmed but structurally real Chrome export: Chrome wraps the bookmarks
// bar and "Other bookmarks" folders in a top-level <DL><p>, and every folder
// heading is an unclosed <DT><H3> immediately followed by its own <DL><p>.
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1690000000" LAST_MODIFIED="1690000500" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1690000010">Hacker News</A>
        <DT><H3 ADD_DATE="1690000020" LAST_MODIFIED="1690000600">Tech</H3>
        <DL><p>
            <DT><A HREF="https://example.com/docs?ref=abc&amp;lang=en" ADD_DATE="1690000030">Example &amp; Docs</A>
        </DL><p>
    </DL><p>
    <DT><H3 ADD_DATE="1690000040" LAST_MODIFIED="1690000700">Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://example.org/">No date bookmark</A>
    </DL><p>
</DL><p>
`;

// A trimmed but structurally real Firefox export: Firefox adds ICON and TAGS
// attributes to <A> tags that the parser has to ignore rather than choke on.
const FIREFOX_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 ADD_DATE="1690000000" LAST_MODIFIED="1690000500">Reading</H3>
    <DL><p>
        <DT><A HREF="http://example.com/newsletter/archive" ADD_DATE="1690000100" ICON="data:image/png;base64,AAAABBBBCCCC">Weekly Newsletter Archive</A>
        <DT><A HREF="http://example.com/newsletter-archive" ADD_DATE="1690000200" TAGS="reading,later">Weekly Newsletter Archive</A>
    </DL><p>
</DL><p>
`;

test("parses a Chrome export: nested folders, entities, add dates", () => {
  const entries = parseBookmarksHtml(CHROME_EXPORT);
  assert.equal(entries.length, 3);

  const hn = entries.find((e) => e.url === "https://news.ycombinator.com/");
  assert.ok(hn);
  assert.equal(hn.title, "Hacker News");
  assert.equal(hn.folder, "Bookmarks bar");
  assert.equal(hn.addDate, 1690000010);

  const docs = entries.find((e) => e.title === "Example & Docs");
  assert.ok(docs);
  assert.equal(docs.folder, "Bookmarks bar/Tech");
  assert.equal(docs.url, "https://example.com/docs?ref=abc&lang=en");

  const noDate = entries.find((e) => e.title === "No date bookmark");
  assert.ok(noDate);
  assert.equal(noDate.folder, "Other bookmarks");
  assert.equal(noDate.addDate, undefined);
});

test("parses a Firefox export: extra <A> attributes don't confuse href/title extraction", () => {
  const entries = parseBookmarksHtml(FIREFOX_EXPORT);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.folder, "Reading");
  assert.equal(entries[1]?.folder, "Reading");
  assert.equal(entries[0]?.url, "http://example.com/newsletter/archive");
  assert.equal(entries[1]?.url, "http://example.com/newsletter-archive");
});

test("matchIndex/matchLength span the entry's <DT><A ...>...</A> in the source", () => {
  const entries = parseBookmarksHtml(CHROME_EXPORT);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const span = CHROME_EXPORT.slice(entry.matchIndex, entry.matchIndex + entry.matchLength);
    assert.match(span, /<A\s/);
    assert.ok(span.endsWith("</A>"));
  }
});

test("root-level entries with no enclosing H3 get an empty folder", () => {
  const html = `<DL><p>\n  <DT><A HREF="https://example.com/">Example</A>\n</DL><p>\n`;
  const entries = parseBookmarksHtml(html);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.folder, "");
});

test("sibling folders at the same depth don't leak into each other", () => {
  const html = `
<DL><p>
  <DT><H3>Folder A</H3>
  <DL><p>
    <DT><A HREF="https://a.example.com/">A entry</A>
  </DL><p>
  <DT><H3>Folder B</H3>
  <DL><p>
    <DT><A HREF="https://b.example.com/">B entry</A>
  </DL><p>
</DL><p>
`;
  const entries = parseBookmarksHtml(html);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.folder, "Folder A");
  assert.equal(entries[1]?.folder, "Folder B");
});

test("an entry with no title text is parsed with an empty title", () => {
  const html = `<DL><p><DT><A HREF="https://example.com/"></A></DL><p>`;
  const entries = parseBookmarksHtml(html);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.title, "");
});

test("decodes numeric and named HTML entities in titles and URLs", () => {
  const html = `<DL><p><DT><A HREF="https://example.com/?q=a%26b">Bob&#39;s &quot;Site&quot; &amp; More</A></DL><p>`;
  const entries = parseBookmarksHtml(html);
  assert.equal(entries[0]?.title, `Bob's "Site" & More`);
});

test("an <A> tag with no href is skipped", () => {
  const html = `<DL><p><DT><A>No href here</A><DT><A HREF="https://example.com/">Has href</A></DL><p>`;
  const entries = parseBookmarksHtml(html);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.url, "https://example.com/");
});
