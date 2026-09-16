import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parseBookmarksHtml, type BookmarkEntry } from "./parser.js";
import { normalizeUrl } from "./normalize.js";
import { titleSimilarity } from "./similarity.js";

// An entry tagged with which input file it came from and its position in
// the overall merge order. `seq` (not matchIndex, which is only meaningful
// within its own file's HTML text) is what group ordering and --fix's
// "keep the first occurrence" rule are based on once more than one file is
// involved.
interface SourcedEntry extends BookmarkEntry {
  source: string;
  seq: number;
}

// Jaccard similarity of title word sets, chosen by hand-checking it against
// a handful of real duplicate/non-duplicate title pairs: high enough that
// "Docs" alone vs "Example Docs" (0.5) doesn't match, low enough that
// reordered or lightly-edited titles still do.
const NEAR_DUPLICATE_THRESHOLD = 0.7;

interface ReportedEntry {
  title: string;
  folder: string;
  url: string;
  source?: string;
}

interface DuplicateGroup {
  url: string;
  count: number;
  entries: ReportedEntry[];
}

interface NearDuplicateGroup {
  count: number;
  entries: ReportedEntry[];
}

function groupByNormalizedUrl(entries: SourcedEntry[]): Map<string, SourcedEntry[]> {
  const byNormalizedUrl = new Map<string, SourcedEntry[]>();
  for (const entry of entries) {
    const key = normalizeUrl(entry.url);
    const list = byNormalizedUrl.get(key);
    if (list) list.push(entry);
    else byNormalizedUrl.set(key, [entry]);
  }
  return byNormalizedUrl;
}

function findDuplicateUrls(byNormalizedUrl: Map<string, SourcedEntry[]>, includeSource: boolean): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [url, list] of byNormalizedUrl) {
    if (list.length < 2) continue;
    groups.push({
      url,
      count: list.length,
      entries: list.map((e) => ({
        title: e.title,
        folder: e.folder || "(root)",
        url: e.url,
        ...(includeSource ? { source: e.source } : {}),
      })),
    });
  }

  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// Bookmarks whose URLs already matched are exact duplicates, not near-dupes,
// so this compares one representative per normalized URL - the entry that
// appears first in the file - rather than every entry. That also keeps the
// pairwise comparison down to one per distinct URL instead of one per
// bookmark, which matters once a URL has been saved a dozen times.
function findNearDuplicateTitles(
  byNormalizedUrl: Map<string, SourcedEntry[]>,
  includeSource: boolean,
): NearDuplicateGroup[] {
  const representatives: SourcedEntry[] = [];
  for (const list of byNormalizedUrl.values()) {
    const first = [...list].sort((a, b) => a.seq - b.seq)[0];
    if (first.title.trim().length > 0) representatives.push(first);
  }

  // Union-find over representative indices: any pair of titles similar
  // enough gets merged into the same cluster, so a chain of near-matching
  // titles is reported as one group instead of overlapping pairs.
  const parent = representatives.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  for (let i = 0; i < representatives.length; i++) {
    for (let j = i + 1; j < representatives.length; j++) {
      if (titleSimilarity(representatives[i].title, representatives[j].title) >= NEAR_DUPLICATE_THRESHOLD) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, SourcedEntry[]>();
  for (let i = 0; i < representatives.length; i++) {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(representatives[i]);
    else clusters.set(root, [representatives[i]]);
  }

  const groups: NearDuplicateGroup[] = [];
  for (const list of clusters.values()) {
    if (list.length < 2) continue;
    groups.push({
      count: list.length,
      entries: list
        .sort((a, b) => a.seq - b.seq)
        .map((e) => ({
          title: e.title,
          folder: e.folder || "(root)",
          url: e.url,
          ...(includeSource ? { source: e.source } : {}),
        })),
    });
  }

  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// Removes the given entries' <DT><A ...>...</A> spans from the source HTML,
// along with their line's leading indentation and trailing newline, so the
// result reads like a file that never had those entries rather than one with
// blank lines punched out of it.
function removeEntries(html: string, toRemove: SourcedEntry[]): string {
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

// Duplicates within a group are kept in file order by default; everything
// after the first occurrence is considered removable by --fix. When
// preferFolder is given, the kept entry is instead the first (in file order)
// whose folder path contains that string, falling back to file order if no
// entry in the group matches.
function pickRemovable(byNormalizedUrl: Map<string, SourcedEntry[]>, preferFolder?: string): SourcedEntry[] {
  const needle = preferFolder?.toLowerCase();
  const removable: SourcedEntry[] = [];
  for (const list of byNormalizedUrl.values()) {
    if (list.length < 2) continue;
    const byPosition = [...list].sort((a, b) => a.seq - b.seq);
    const keeper = needle ? (byPosition.find((e) => e.folder.toLowerCase().includes(needle)) ?? byPosition[0]) : byPosition[0];
    removable.push(...byPosition.filter((e) => e !== keeper));
  }
  return removable;
}

function formatEntry(entry: ReportedEntry): string {
  const sourceTag = entry.source ? ` [${basename(entry.source)}]` : "";
  return `  - "${entry.title}" in ${entry.folder} (${entry.url})${sourceTag}`;
}

function printHuman(
  total: number,
  fileCount: number,
  duplicates: DuplicateGroup[],
  nearDuplicates: NearDuplicateGroup[],
): void {
  const scope = fileCount > 1 ? ` across ${fileCount} files` : "";
  console.log(`scanned ${total} bookmark${total === 1 ? "" : "s"}${scope}`);

  if (duplicates.length === 0) {
    console.log("no duplicate URLs found");
  } else {
    console.log(`${duplicates.length} URL${duplicates.length === 1 ? "" : "s"} bookmarked more than once:\n`);
    for (const group of duplicates) {
      console.log(`${group.url}  (${group.count}x)`);
      for (const entry of group.entries) {
        console.log(formatEntry(entry));
      }
      console.log("");
    }
  }

  if (nearDuplicates.length > 0) {
    console.log(
      `${nearDuplicates.length} group${nearDuplicates.length === 1 ? "" : "s"} of possible near-duplicates (similar titles, different URLs):\n`,
    );
    for (const group of nearDuplicates) {
      console.log(`(${group.count}x)`);
      for (const entry of group.entries) {
        console.log(formatEntry(entry));
      }
      console.log("");
    }
  }
}

function printUsage(): void {
  console.error(
    "usage: bookmark-dupes <export.html> [<export2.html> ...] [--json] [--fix <output.html>] [--prefer-folder <name>]",
  );
  console.error("");
  console.error("  export.html    a bookmarks file in the Netscape Bookmark format");
  console.error("                 (File > Export Bookmarks, in Chrome, Firefox, or Safari)");
  console.error("                 pass more than one to merge them before reporting -");
  console.error("                 e.g. one export per browser you use");
  console.error("  --json         print a machine-readable report instead of text");
  console.error("  --fix <path>   write a copy of export.html to <path> with every");
  console.error("                 duplicate URL's later entries removed, keeping the");
  console.error("                 first occurrence of each; only supported with a");
  console.error("                 single input file");
  console.error("  --prefer-folder <name>");
  console.error("                 with --fix, keep the entry whose folder path contains");
  console.error("                 <name> (case-insensitive) instead of the first");
  console.error("                 occurrence, for URLs where a matching entry exists");
  console.error("");
  console.error("  Also reports groups of bookmarks with different URLs but similar");
  console.error("  titles, as a hint they may be the same page saved twice. These are");
  console.error("  never touched by --fix.");
}

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      fix: { type: "string" },
      "prefer-folder": { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    printUsage();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const filePaths = positionals;
  const htmlByFile = new Map<string, string>();
  const entries: SourcedEntry[] = [];
  let seq = 0;
  for (const filePath of filePaths) {
    let html: string;
    try {
      html = readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(`could not read ${filePath}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    htmlByFile.set(filePath, html);
    for (const entry of parseBookmarksHtml(html)) {
      entries.push({ ...entry, source: filePath, seq: seq++ });
    }
  }

  const includeSource = filePaths.length > 1;
  const byNormalizedUrl = groupByNormalizedUrl(entries);
  const duplicates = findDuplicateUrls(byNormalizedUrl, includeSource);
  const nearDuplicates = findNearDuplicateTitles(byNormalizedUrl, includeSource);

  if (values["prefer-folder"] !== undefined && values.fix === undefined) {
    console.error("--prefer-folder only has an effect together with --fix");
    process.exitCode = 1;
    return;
  }

  if (values.fix !== undefined) {
    if (filePaths.length > 1) {
      console.error("--fix supports only a single input file at a time");
      process.exitCode = 1;
      return;
    }
    const filePath = filePaths[0];
    const html = htmlByFile.get(filePath) as string;

    if (resolve(values.fix) === resolve(filePath)) {
      console.error("--fix path must be different from the input file, refusing to overwrite it");
      process.exitCode = 1;
      return;
    }

    const removable = pickRemovable(byNormalizedUrl, values["prefer-folder"]);
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
            nearDuplicates,
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
    if (nearDuplicates.length > 0) {
      console.log(
        `${nearDuplicates.length} group${nearDuplicates.length === 1 ? "" : "s"} of possible near-duplicates left untouched, run without --fix to see them`,
      );
    }
    return;
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          totalBookmarks: entries.length,
          ...(includeSource ? { sourceFiles: filePaths } : {}),
          duplicateUrlCount: duplicates.length,
          duplicates,
          nearDuplicates,
        },
        null,
        2,
      ),
    );
    return;
  }

  printHuman(entries.length, filePaths.length, duplicates, nearDuplicates);
}

main();
