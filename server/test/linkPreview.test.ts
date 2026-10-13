import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import {
  fetchLinkPreview,
  findFirstUrl,
  isPublicAddress,
  parseLinkPreview,
  publicLookup,
} from "../src/linkPreview.js";

const PAGE = `<!doctype html>
<html><head>
  <title>Plain title</title>
  <meta property="og:title" content="Cats &amp; dogs &#39;together&#39;">
  <meta name="description" content="  A page
     about pets.  ">
  <meta property='og:image' content='/img/cat.png'>
  <meta property=og:site_name content=Petpedia>
</head><body>hello</body></html>`;

test("finds the first link in a message", () => {
  assert.equal(findFirstUrl("no links here"), null);
  assert.equal(
    findFirstUrl("look at https://example.com/a?b=1, then http://two.example"),
    "https://example.com/a?b=1",
    "punctuation after the link isn't part of it",
  );
  assert.equal(
    findFirstUrl("(see https://example.com/page)."),
    "https://example.com/page",
  );
  assert.equal(findFirstUrl("ftp://example.com www.example.com"), null);
});

test("reads title, description, picture and site name from a page", () => {
  assert.deepEqual(parseLinkPreview(PAGE, "https://pets.example/cats"), {
    url: "https://pets.example/cats",
    title: "Cats & dogs 'together'",
    description: "A page about pets.",
    imageUrl: "https://pets.example/img/cat.png",
    siteName: "Petpedia",
  });

  // Falls back to <title>; no title at all means no preview.
  assert.equal(
    parseLinkPreview("<title> Just a title </title>", "https://a.example/")
      ?.title,
    "Just a title",
  );
  assert.equal(
    parseLinkPreview("<p>nothing useful</p>", "https://a.example/"),
    null,
  );

  // Long text is cut, and a picture that isn't a web address is dropped.
  const long = parseLinkPreview(
    `<meta property="og:title" content="${"x".repeat(500)}">
     <meta property="og:image" content="javascript:alert(1)">`,
    "https://a.example/",
  );
  assert.equal(long?.title.length, 200);
  assert.equal(long?.imageUrl, null);
});

test("only public internet addresses count as public", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata services
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fd00::1",
    "not an address",
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(address), true, address);
});

test("host names that point at this machine fail the lookup", async () => {
  const error = await new Promise<Error | null>((resolve) =>
    publicLookup("localhost", {}, (err) => resolve(err)),
  );
  assert.match(error?.message ?? "", /not a public address/);
});

// A small website on this machine, to download previews from.
let site: http.Server;
let origin: string;

before(async () => {
  site = http.createServer((req, res) => {
    const html = { "Content-Type": "text/html; charset=utf-8" };
    if (req.url === "/page") {
      res.writeHead(200, html).end(PAGE);
    } else if (req.url === "/zipped") {
      res
        .writeHead(200, { ...html, "Content-Encoding": "gzip" })
        .end(zlib.gzipSync(PAGE));
    } else if (req.url === "/moved") {
      res.writeHead(302, { Location: "/page" }).end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { Location: "/loop" }).end();
    } else if (req.url === "/file") {
      res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF");
    } else if (req.url === "/late") {
      // Like YouTube: a lot of script before the tags.
      res.writeHead(200, html);
      res.write(`<html><head><script>${"x".repeat(900 * 1024)}</script>`);
      res.end(PAGE.slice(PAGE.indexOf("<title>")));
    } else if (req.url === "/huge") {
      // The tags come first, followed by far more than will be downloaded.
      res.writeHead(200, html);
      res.write(PAGE);
      res.end("x".repeat(3 * 1024 * 1024));
    } else {
      res.writeHead(404, html).end("<title>Not found</title>");
    }
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

after(() => site.close());

test("downloads a page and returns its preview", async () => {
  const local = { unsafeAllowLocal: true };

  const preview = await fetchLinkPreview(`${origin}/page`, local);
  assert.equal(preview?.title, "Cats & dogs 'together'");
  assert.equal(preview?.imageUrl, `${origin}/img/cat.png`);
  assert.equal(preview?.url, `${origin}/page`);

  assert.equal(
    (await fetchLinkPreview(`${origin}/zipped`, local))?.siteName,
    "Petpedia",
  );
  assert.equal(
    (await fetchLinkPreview(`${origin}/huge`, local))?.siteName,
    "Petpedia",
  );
  assert.equal(
    (await fetchLinkPreview(`${origin}/late`, local))?.siteName,
    "Petpedia",
  );

  // Redirects are followed (the preview keeps the link as it was sent), but not forever.
  const moved = await fetchLinkPreview(`${origin}/moved`, local);
  assert.equal(moved?.title, "Cats & dogs 'together'");
  assert.equal(moved?.url, `${origin}/moved`);
  assert.equal(await fetchLinkPreview(`${origin}/loop`, local), null);

  // Not a web page, an error page, or not a link at all: no preview.
  assert.equal(await fetchLinkPreview(`${origin}/file`, local), null);
  assert.equal(await fetchLinkPreview(`${origin}/missing`, local), null);
  assert.equal(await fetchLinkPreview("file:///etc/passwd", local), null);
  assert.equal(await fetchLinkPreview("not a url", local), null);
});

test("refuses to download from this machine or a private network", async () => {
  // The same page that works above, without the test-only switch.
  assert.equal(await fetchLinkPreview(`${origin}/page`), null);
  for (const url of [
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://2130706433/", // 127.0.0.1 written as one number
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.0.1/",
    "http://localhost/",
    "https://example.com:8443/", // not a standard port
    "http://user:pass@example.com/",
  ])
    assert.equal(await fetchLinkPreview(url), null, url);
});
