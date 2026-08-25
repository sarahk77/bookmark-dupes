# bookmark-dupes

I have bookmarked the same page into three different folders more than once.
Browsers don't warn you when you do this, and by the time you notice, your
bookmarks file has hundreds of entries and no easy way to see which URLs are
repeated. This tool answers exactly that question: given a bookmarks export,
which URLs show up more than once, and where?

It reads the standard Netscape Bookmark File Format - the HTML file every
major browser produces when you export bookmarks (Chrome, Firefox, Edge,
Safari all use it, it's a de facto standard from the old Netscape days). No
browser profile access, no extension, just the exported file.

## Usage

Export your bookmarks first:

- Chrome / Edge: `chrome://bookmarks` -> menu -> Export bookmarks
- Firefox: Bookmarks -> Manage Bookmarks -> Import and Backup -> Export Bookmarks to HTML
- Safari: File -> Export Bookmarks

Then run:

```
node src/cli.ts ~/Downloads/bookmarks.html
```

```
scanned 842 bookmarks
3 URLs bookmarked more than once:

http://news.ycombinator.com  (2x)
  - "Hacker News" in Tech (https://news.ycombinator.com)
  - "HN" in (root) (https://news.ycombinator.com/)

http://example.com/docs  (3x)
  - "Docs" in Work/Reference (https://example.com/docs)
  - "Example Docs" in Work/Reference/Old (https://example.com/docs/?utm_source=newsletter)
  - "docs" in (root) (http://example.com/docs)
```

URLs are compared after normalizing: `http` and `https` are treated as the
same scheme, a trailing slash on the path is ignored, and known tracking
query params (`utm_*`, `gclid`, `fbclid`, and similar) are stripped before
comparing. The group heading shows the normalized form; each entry below it
shows the URL exactly as it appears in the export.

### JSON output

```
node src/cli.ts ~/Downloads/bookmarks.html --json
```

```json
{
  "totalBookmarks": 842,
  "duplicateUrlCount": 3,
  "duplicates": [
    {
      "url": "http://example.com/docs",
      "count": 3,
      "entries": [
        { "title": "Docs", "folder": "Work/Reference", "url": "https://example.com/docs" },
        { "title": "Example Docs", "folder": "Work/Reference/Old", "url": "https://example.com/docs/?utm_source=newsletter" },
        { "title": "docs", "folder": "(root)", "url": "http://example.com/docs" }
      ]
    }
  ]
}
```

The JSON mode is meant to be piped into something else - `jq`, a script that
deletes the older duplicates, whatever. It's a straight mirror of the human
output, no extra or missing fields.

## Requirements

Node 22.6 or later, run with type stripping enabled (Node 23.6+ has this on
by default; on earlier 22.x/23.x builds pass `--experimental-strip-types`):

```
node --experimental-strip-types src/cli.ts bookmarks.html
```

No dependencies, nothing to install.

## Notes on the format

The bookmark file isn't valid HTML or XML - tags like `<DT>` are never
closed, and `<p>` is used as a bare separator. `src/parser.ts` treats it as a
token stream instead of trying to run it through a real HTML/XML parser,
which is more honest about how loose the format actually is.

## What this does not do (yet)

- No output format for removing the duplicates automatically.
- No near-duplicate detection by title similarity (same page, different URL
  entirely - a redirect, a URL shortener, a different query string that
  isn't a known tracking param).

See the license for warranty (there isn't one).
