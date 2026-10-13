import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";
import type { LinkPreview } from "../../shared/types.js";

/**
 * Link previews: when a message contains a link, the server downloads that
 * page and reads its title, description and picture from the <meta> tags
 * (Open Graph, which most sites provide for exactly this purpose).
 *
 * Downloading a URL that a user typed is risky: without checks, someone could
 * make the server fetch things only it can reach (http://localhost, the
 * database's admin page, a cloud provider's metadata address…). So this only
 * ever connects to public internet addresses, on the standard ports, with
 * limits on time, size and redirects. See `allowedUrl` and `publicLookup`.
 */

/** Looks up the preview for a URL; null if there's none to show. */
export type LinkPreviewFetcher = (url: string) => Promise<LinkPreview | null>;

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
/**
 * The tags we want are in the <head>, so the download stops at </head>. Some
 * big sites put a lot before them (YouTube: about 750 KB of scripts), hence
 * the generous limit for pages where </head> never comes.
 */
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; ChatAppBot/1.0; link previews)";

// Addresses that aren't on the public internet: this machine, private
// networks, link-local (which includes cloud metadata services), and so on.
const notPublic = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  notPublic.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  notPublic.addSubnet(prefix, bits, "ipv6");

/** True if `address` is an IP address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  // IPv4 addresses written as IPv6 (::ffff:127.0.0.1) are checked as IPv4.
  return !notPublic.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * Turns a host name into IP addresses like the default lookup does, but fails
 * if any of them isn't public. Passing this to http.request means the check is
 * on the very address that gets connected to, so a host name can't pass the
 * check and then point somewhere else a moment later.
 */
export const publicLookup: net.LookupFunction = (
  hostname,
  options,
  callback,
) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (!err && !addresses.every((a) => isPublicAddress(a.address))) {
      err = new Error(`${hostname} is not a public address`);
    }
    const first = addresses?.[0];
    if (err || !first) {
      callback(err ?? new Error(`${hostname} not found`), "", 0);
    } else if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, first.address, first.family);
    }
  });
};

/** Parses a URL and returns it only if a preview may be fetched from it. */
function allowedUrl(raw: string, allowLocal: boolean): URL | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (allowLocal) return url;
  if (url.port) return null; // only the standard ports, 80 and 443
  // A host that's already an IP address never goes through the lookup above.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) return null;
  return url;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/** The first http(s) link in a message's text, without punctuation that follows it. */
export function findFirstUrl(text: string): string | null {
  const url = URL_PATTERN.exec(text)?.[0].replace(/[.,!?;:)\]}]+$/, "");
  return url && URL.canParse(url) ? url : null;
}

// ---- Reading the page --------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Turns &amp;, &#39;, &#x27; … back into the characters they stand for. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
      const point =
        code[1]?.toLowerCase() === "x"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    },
  );
}

/** Tidies text from a page: one line, trimmed, at most `max` characters; null if empty. */
function clean(text: string | undefined, max: number): string | null {
  const tidy = decodeEntities(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!tidy) return null;
  return tidy.length > max ? `${tidy.slice(0, max - 1)}…` : tidy;
}

/**
 * Reads the preview out of a page's HTML. `url` is the link as it was sent;
 * `pageUrl` is where the page was actually found (after redirects), used to
 * complete a relative picture address. Null if the page has no title.
 */
export function parseLinkPreview(
  html: string,
  url: string,
  pageUrl: URL = new URL(url),
): LinkPreview | null {
  // Collect <meta property="og:title" content="…"> and <meta name="…" content="…">.
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const [, name, double, single, bare] of tag.matchAll(
      /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
    )) {
      if (name) attrs[name.toLowerCase()] = double ?? single ?? bare ?? "";
    }
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
  }
  const first = (max: number, ...keys: string[]) => {
    for (const key of keys) {
      const value = clean(meta.get(key), max);
      if (value) return value;
    }
    return null;
  };

  const title =
    first(200, "og:title", "twitter:title") ??
    clean(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1], 200);
  if (!title) return null;

  let imageUrl: string | null = null;
  const image = first(2000, "og:image", "og:image:url", "twitter:image");
  if (image && URL.canParse(image, pageUrl.href)) {
    const resolved = new URL(image, pageUrl);
    if (resolved.protocol === "http:" || resolved.protocol === "https:")
      imageUrl = resolved.href;
  }

  return {
    url,
    title,
    description: first(
      300,
      "og:description",
      "twitter:description",
      "description",
    ),
    imageUrl,
    siteName: first(60, "og:site_name"),
  };
}

function get(
  url: URL,
  allowLocal: boolean,
  signal: AbortSignal,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        signal,
        // A new connection every time, so the lookup check always runs.
        agent: false,
        lookup: allowLocal ? undefined : publicLookup,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en",
          "Accept-Encoding": "gzip, br",
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** Reads the start of an HTML response as text; null if it isn't HTML. */
async function readHtml(res: http.IncomingMessage): Promise<string | null> {
  const type = res.headers["content-type"] ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) return null;

  const unzip = {
    gzip: zlib.createGunzip,
    "x-gzip": zlib.createGunzip,
    br: zlib.createBrotliDecompress,
    deflate: zlib.createInflate,
  }[res.headers["content-encoding"] ?? ""];
  // pipeline (unlike .pipe) passes errors along, so a dropped connection ends the loop below.
  const body: Readable = unzip ? pipeline(res, unzip(), () => {}) : res;

  const chunks: Buffer[] = [];
  let size = 0;
  let tail = ""; // the end of the previous chunk, in case "</head>" is split across two
  for await (const chunk of body) {
    chunks.push(chunk as Buffer);
    size += (chunk as Buffer).length;
    const text = tail + (chunk as Buffer).toString("latin1");
    // Enough: stop downloading.
    if (size >= MAX_HTML_BYTES || /<\/head\s*>/i.test(text)) break;
    tail = text.slice(-8);
  }

  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
  const bytes = Buffer.concat(chunks);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes); // unknown charset: assume UTF-8
  }
}

/**
 * Downloads the page at `rawUrl` and returns its preview, or null if there's
 * nothing to show: not a public web page, too slow, not HTML, no title…
 * It never throws. `unsafeAllowLocal` turns the address checks off and is only
 * for tests, which serve their pages from this machine.
 */
export async function fetchLinkPreview(
  rawUrl: string,
  { unsafeAllowLocal = false }: { unsafeAllowLocal?: boolean } = {},
): Promise<LinkPreview | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS); // for the whole thing, redirects included
  let res: http.IncomingMessage | undefined;
  try {
    let url = allowedUrl(rawUrl, unsafeAllowLocal);
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      res = await get(url, unsafeAllowLocal, signal);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.destroy();
        // Every redirect is checked like the original link.
        url = URL.canParse(location, url.href)
          ? allowedUrl(new URL(location, url).href, unsafeAllowLocal)
          : null;
        continue;
      }
      if (status !== 200) return null;
      const html = await readHtml(res);
      return html === null ? null : parseLinkPreview(html, rawUrl, url);
    }
    return null;
  } catch {
    return null;
  } finally {
    res?.destroy();
  }
}
