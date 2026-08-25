import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { parseBookmarksHtml, type BookmarkEntry } from "./parser.js";
import { normalizeUrl } from "./normalize.js";

interface DuplicateGroup {
  url: string;
  count: number;
  entries: { title: string; folder: string; url: string }[];
}

function findDuplicateUrls(entries: BookmarkEntry[]): DuplicateGroup[] {
  const byNormalizedUrl = new Map<string, BookmarkEntry[]>();
  for (const entry of entries) {
    const key = normalizeUrl(entry.url);
    const list = byNormalizedUrl.get(key);
    if (list) list.push(entry);
    else byNormalizedUrl.set(key, [entry]);
  }

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
  console.error("usage: bookmark-dupes <export.html> [--json]");
  console.error("");
  console.error("  export.html   a bookmarks file in the Netscape Bookmark format");
  console.error("                (File > Export Bookmarks, in Chrome, Firefox, or Safari)");
  console.error("  --json        print a machine-readable report instead of text");
}

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
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
  const duplicates = findDuplicateUrls(entries);

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
