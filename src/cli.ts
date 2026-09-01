import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBookmarksHtml, type BookmarkEntry } from "./parser.js";
import { normalizeUrl } from "./normalize.js";

interface DuplicateGroup {
  url: string;
  count: number;
  entries: { title: string; folder: string; url: string }[];
}

function groupByNormalizedUrl(entries: BookmarkEntry[]): Map<string, BookmarkEntry[]> {
  const byNormalizedUrl = new Map<string, BookmarkEntry[]>();
  for (const entry of entries) {
    const key = normalizeUrl(entry.url);
    const list = byNormalizedUrl.get(key);
    if (list) list.push(entry);
    else byNormalizedUrl.set(key, [entry]);
  }
  return byNormalizedUrl;
}

function findDuplicateUrls(byNormalizedUrl: Map<string, BookmarkEntry[]>): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [url, list] of byNormalizedUrl) {
    if (list.length < 2) continue;
    groups.push({
      url,
      count: list.length,
      entries: list.map((e) => ({ title: e.title, folder: e.folder || "(root)", url: e.url })),
    });
  }

  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// Removes the given entries' <DT><A ...>...</A> spans from the source HTML,
// along with their line's leading indentation and trailing newline, so the
// result reads like a file that never had those entries rather than one with
// blank lines punched out of it.
function removeEntries(html: string, toRemove: BookmarkEntry[]): string {
  const ranges = toRemove
    .map((entry) => {
      let start = entry.matchIndex;
      while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
      let end = entry.matchIndex + entry.matchLength;
      if (html.slice(end, end + 2) === "\r\n") end += 2;
      else if (html[end] === "\n") end += 1;
      return { start, end };
    })
    .sort((a, b) => b.start - a.start);

  let result = html;
  for (const { start, end } of ranges) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

// Duplicates within a group are kept in file order; everything after the
// first occurrence is considered removable by --fix.
function pickRemovable(byNormalizedUrl: Map<string, BookmarkEntry[]>): BookmarkEntry[] {
  const removable: BookmarkEntry[] = [];
  for (const list of byNormalizedUrl.values()) {
    if (list.length < 2) continue;
    const byPosition = [...list].sort((a, b) => a.matchIndex - b.matchIndex);
    removable.push(...byPosition.slice(1));
  }
  return removable;
}

function printHuman(total: number, duplicates: DuplicateGroup[]): void {
  console.log(`scanned ${total} bookmark${total === 1 ? "" : "s"}`);

  if (duplicates.length === 0) {
    console.log("no duplicate URLs found");
    return;
  }

  console.log(`${duplicates.length} URL${duplicates.length === 1 ? "" : "s"} bookmarked more than once:\n`);
  for (const group of duplicates) {
    console.log(`${group.url}  (${group.count}x)`);
    for (const entry of group.entries) {
      console.log(`  - "${entry.title}" in ${entry.folder} (${entry.url})`);
    }
    console.log("");
  }
}

function printUsage(): void {
  console.error("usage: bookmark-dupes <export.html> [--json] [--fix <output.html>]");
  console.error("");
  console.error("  export.html    a bookmarks file in the Netscape Bookmark format");
  console.error("                 (File > Export Bookmarks, in Chrome, Firefox, or Safari)");
  console.error("  --json         print a machine-readable report instead of text");
  console.error("  --fix <path>   write a copy of export.html to <path> with every");
  console.error("                 duplicate URL's later entries removed, keeping the");
  console.error("                 first occurrence of each");
}

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      fix: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    printUsage();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const filePath = positionals[0];
  let html: string;
  try {
    html = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`could not read ${filePath}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const entries = parseBookmarksHtml(html);
  const byNormalizedUrl = groupByNormalizedUrl(entries);
  const duplicates = findDuplicateUrls(byNormalizedUrl);

  if (values.fix !== undefined) {
    if (resolve(values.fix) === resolve(filePath)) {
      console.error("--fix path must be different from the input file, refusing to overwrite it");
      process.exitCode = 1;
      return;
    }

    const removable = pickRemovable(byNormalizedUrl);
    const cleaned = removeEntries(html, removable);
    try {
      writeFileSync(values.fix, cleaned, "utf8");
    } catch (err) {
      console.error(`could not write ${values.fix}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }

    if (values.json) {
      console.log(
        JSON.stringify(
          {
            totalBookmarks: entries.length,
            duplicateUrlCount: duplicates.length,
            duplicates,
            fixedFile: values.fix,
            removedCount: removable.length,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`scanned ${entries.length} bookmark${entries.length === 1 ? "" : "s"}`);
    console.log(
      `removed ${removable.length} duplicate entr${removable.length === 1 ? "y" : "ies"}, wrote ${entries.length - removable.length} bookmarks to ${values.fix}`,
    );
    return;
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          totalBookmarks: entries.length,
          duplicateUrlCount: duplicates.length,
          duplicates,
        },
        null,
        2,
      ),
    );
    return;
  }

  printHuman(entries.length, duplicates);
}

main();
