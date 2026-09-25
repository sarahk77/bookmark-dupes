import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

// The CLI is exercised as a subprocess rather than imported, since src/cli.ts
// calls main() at module load time and would run against this test file's
// own argv otherwise.
function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI_PATH, ...args], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function bookmarksHtml(entries: { href: string; title: string }[]): string {
  const links = entries.map((e) => `    <DT><A HREF="${e.href}">${e.title}</A>`).join("\n");
  return `<DL><p>\n${links}\n</DL><p>\n`;
}

const dir = mkdtempSync(join(tmpdir(), "bookmark-dupes-test-"));

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("merges duplicates across multiple files and tags entries with their source", () => {
  const chromePath = join(dir, "chrome.html");
  const firefoxPath = join(dir, "firefox.html");
  writeFileSync(chromePath, bookmarksHtml([{ href: "https://example.com/docs", title: "Docs" }]));
  writeFileSync(firefoxPath, bookmarksHtml([{ href: "https://example.com/docs/", title: "Docs again" }]));

  const { status, stdout } = runCli([chromePath, firefoxPath, "--json"]);
  assert.equal(status, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.totalBookmarks, 2);
  assert.deepEqual(report.sourceFiles, [chromePath, firefoxPath]);
  assert.equal(report.duplicateUrlCount, 1);
  assert.equal(report.duplicates[0].entries[0].source, chromePath);
  assert.equal(report.duplicates[0].entries[1].source, firefoxPath);
});

test("a single file's report has no source tags", () => {
  const filePath = join(dir, "single.html");
  writeFileSync(
    filePath,
    bookmarksHtml([
      { href: "https://example.com/docs", title: "Docs" },
      { href: "https://example.com/docs/", title: "Docs again" },
    ]),
  );

  const { stdout } = runCli([filePath, "--json"]);
  const report = JSON.parse(stdout);
  assert.equal(report.sourceFiles, undefined);
  assert.equal(report.duplicates[0].entries[0].source, undefined);
});

test("--fix refuses more than one input file", () => {
  const chromePath = join(dir, "chrome2.html");
  const firefoxPath = join(dir, "firefox2.html");
  writeFileSync(chromePath, bookmarksHtml([{ href: "https://example.com/", title: "Example" }]));
  writeFileSync(firefoxPath, bookmarksHtml([{ href: "https://example.com/", title: "Example" }]));

  const { status, stderr } = runCli([chromePath, firefoxPath, "--fix", join(dir, "out.html")]);
  assert.equal(status, 1);
  assert.match(stderr, /--fix supports only a single input file/);
});

test("--fix refuses to write to the same path it read from", () => {
  const filePath = join(dir, "self.html");
  writeFileSync(filePath, bookmarksHtml([{ href: "https://example.com/", title: "Example" }]));

  const { status, stderr } = runCli([filePath, "--fix", filePath]);
  assert.equal(status, 1);
  assert.match(stderr, /refusing to overwrite/);
});

test("--prefer-folder keeps the matching entry instead of the first occurrence", () => {
  const filePath = join(dir, "folders.html");
  const outPath = join(dir, "folders.fixed.html");
  writeFileSync(
    filePath,
    `<DL><p>
    <DT><A HREF="https://example.com/docs">Docs root</A>
    <DT><H3>Work</H3>
    <DL><p>
        <DT><H3>Reference</H3>
        <DL><p>
            <DT><A HREF="https://example.com/docs/">Docs reference</A>
        </DL><p>
    </DL><p>
</DL><p>
`,
  );

  const { status, stdout } = runCli([filePath, "--fix", outPath, "--prefer-folder", "Reference"]);
  assert.equal(status, 0);
  assert.match(stdout, /removed 1 duplicate entry/);

  const cleaned = readFileSync(outPath, "utf8");
  assert.match(cleaned, /Docs reference<\/A>/);
  assert.doesNotMatch(cleaned, /Docs root/);
});

test("--prefer-folder falls back to file order when nothing matches", () => {
  const filePath = join(dir, "folders-nomatch.html");
  const outPath = join(dir, "folders-nomatch.fixed.html");
  writeFileSync(
    filePath,
    bookmarksHtml([
      { href: "https://example.com/docs", title: "Docs" },
      { href: "https://example.com/docs/", title: "Docs again" },
    ]),
  );

  const { status } = runCli([filePath, "--fix", outPath, "--prefer-folder", "Nonexistent"]);
  assert.equal(status, 0);

  const cleaned = readFileSync(outPath, "utf8");
  assert.match(cleaned, /Docs<\/A>/);
  assert.doesNotMatch(cleaned, /Docs again/);
});

test("--prefer-folder matches a whole segment, not a substring of one", () => {
  const filePath = join(dir, "folders-substring.html");
  const outPath = join(dir, "folders-substring.fixed.html");
  writeFileSync(
    filePath,
    `<DL><p>
    <DT><H3>OldReference</H3>
    <DL><p>
        <DT><A HREF="https://example.com/docs">Docs in OldReference</A>
    </DL><p>
    <DT><H3>Old</H3>
    <DL><p>
        <DT><A HREF="https://example.com/docs/">Docs in Old</A>
    </DL><p>
</DL><p>
`,
  );

  const { status, stdout } = runCli([filePath, "--fix", outPath, "--prefer-folder", "Old"]);
  assert.equal(status, 0);
  assert.match(stdout, /removed 1 duplicate entry/);

  const cleaned = readFileSync(outPath, "utf8");
  assert.match(cleaned, /Docs in Old<\/A>/);
  assert.doesNotMatch(cleaned, /Docs in OldReference/);
});

test("--prefer-folder accepts a multi-segment path to require an exact subpath", () => {
  const filePath = join(dir, "folders-subpath.html");
  const outPath = join(dir, "folders-subpath.fixed.html");
  writeFileSync(
    filePath,
    `<DL><p>
    <DT><H3>Personal</H3>
    <DL><p>
        <DT><H3>Reference</H3>
        <DL><p>
            <DT><A HREF="https://example.com/docs">Docs in Personal/Reference</A>
        </DL><p>
    </DL><p>
    <DT><H3>Work</H3>
    <DL><p>
        <DT><H3>Reference</H3>
        <DL><p>
            <DT><A HREF="https://example.com/docs/">Docs in Work/Reference</A>
        </DL><p>
    </DL><p>
</DL><p>
`,
  );

  const { status, stdout } = runCli([filePath, "--fix", outPath, "--prefer-folder", "Work/Reference"]);
  assert.equal(status, 0);
  assert.match(stdout, /removed 1 duplicate entry/);

  const cleaned = readFileSync(outPath, "utf8");
  assert.match(cleaned, /Docs in Work\/Reference<\/A>/);
  assert.doesNotMatch(cleaned, /Docs in Personal\/Reference/);
});

test("--prefer-folder without --fix is rejected", () => {
  const filePath = join(dir, "prefer-no-fix.html");
  writeFileSync(filePath, bookmarksHtml([{ href: "https://example.com/", title: "Example" }]));

  const { status, stderr } = runCli([filePath, "--prefer-folder", "Reference"]);
  assert.equal(status, 1);
  assert.match(stderr, /--prefer-folder only has an effect together with --fix/);
});

test("--fix removes later duplicates and keeps the first occurrence", () => {
  const filePath = join(dir, "dupes.html");
  const outPath = join(dir, "dupes.fixed.html");
  writeFileSync(
    filePath,
    bookmarksHtml([
      { href: "https://example.com/docs", title: "Docs" },
      { href: "https://example.com/other", title: "Other" },
      { href: "https://example.com/docs/", title: "Docs again" },
    ]),
  );

  const { status, stdout } = runCli([filePath, "--fix", outPath]);
  assert.equal(status, 0);
  assert.match(stdout, /removed 1 duplicate entry/);

  const cleaned = readFileSync(outPath, "utf8");
  assert.match(cleaned, /Docs<\/A>/);
  assert.match(cleaned, /Other<\/A>/);
  assert.doesNotMatch(cleaned, /Docs again/);
});
