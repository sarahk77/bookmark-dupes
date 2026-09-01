export interface BookmarkEntry {
  title: string;
  url: string;
  folder: string;
  addDate?: number;
  // Position of this entry's <DT><A ...>...</A> in the source HTML, used by
  // --fix to splice out specific entries without re-serializing the file.
  matchIndex: number;
  matchLength: number;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isNaN(codePoint) ? whole : String.fromCodePoint(codePoint);
    }
    const replacement = NAMED_ENTITIES[body.toLowerCase()];
    return replacement ?? whole;
  });
}

// Netscape Bookmark File Format (what every major browser exports) nests
// folders as <H3>name</H3> immediately followed by a <DL> that holds that
// folder's children, closed by a matching </DL>. It is not valid XML/HTML
// (tags are often unclosed, e.g. <DT>, <p>), so a real HTML parser buys
// nothing here - a token scan over the handful of tags we care about does.
// The optional leading <DT> is folded into the same alternative as the <A>
// so that match.index/match[0].length cover the whole entry (DT included) -
// that's the span --fix needs to remove to clean an entry out of the file.
const TOKEN = /<H3\b[^>]*>([\s\S]*?)<\/H3>|(?:<DT>\s*)?<A\s+([^>]*)>([\s\S]*?)<\/A>|<DL>|<\/DL>/gi;

export function parseBookmarksHtml(html: string): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  const folderStack: string[] = [];
  const pendingFolderNames: string[] = [];

  for (const match of html.matchAll(TOKEN)) {
    const [whole, h3Title, aAttrs, aTitle] = match;

    if (h3Title !== undefined) {
      pendingFolderNames.push(decodeEntities(h3Title.trim()));
      continue;
    }

    if (aAttrs !== undefined) {
      const hrefMatch = /href\s*=\s*"([^"]*)"/i.exec(aAttrs);
      if (!hrefMatch) continue;
      const addDateMatch = /add_date\s*=\s*"(\d+)"/i.exec(aAttrs);
      entries.push({
        title: decodeEntities((aTitle ?? "").trim()),
        url: decodeEntities(hrefMatch[1]),
        folder: folderStack.join("/"),
        addDate: addDateMatch ? Number(addDateMatch[1]) : undefined,
        // matchAll always sets index; the type just doesn't say so.
        matchIndex: match.index as number,
        matchLength: whole.length,
      });
      continue;
    }

    if (whole.toUpperCase() === "<DL>") {
      // A folder heading right before this list means we are entering that
      // folder; a bare <DL> (the document root) has no pending name.
      const name = pendingFolderNames.pop();
      if (name !== undefined) folderStack.push(name);
    } else {
      folderStack.pop();
    }
  }

  return entries;
}
