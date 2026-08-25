// Query params that vary per link-share but never change what page loads.
// Stripping these (and folding http/https, and a trailing slash) means two
// bookmarks of "the same page" saved from different links actually match.
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "gclid",
  "dclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref_src",
  "ref_url",
  "yclid",
  "_ga",
  "_gl",
  "vero_id",
  "spm",
]);

// Best-effort key for "is this the same bookmark". Anything that fails to
// parse as a URL (bookmarklets, browser-internal places) falls back to the
// trimmed original string rather than throwing.
export function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  const protocol = parsed.protocol === "https:" ? "http:" : parsed.protocol;
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port ? `:${parsed.port}` : "";

  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  const params = new URLSearchParams(parsed.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  params.sort();
  const search = params.toString();

  return `${protocol}//${host}${port}${pathname}${search ? `?${search}` : ""}`;
}
