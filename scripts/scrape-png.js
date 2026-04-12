require("dotenv/config");

const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const { PiuClient } = require("../dist/index.js");

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "data");
const SCRAPED_DIR = path.join(ROOT_DIR, "scraped");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "png-manifest.json");
const BASE_ORIGIN = "https://www.piugame.com";

const FETCH_CONCURRENCY = 4;
const DOWNLOAD_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 20_000;
const REDIRECT_LIMIT = 5;
const TLS_CERT_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const HTTPS_AGENT_STRICT = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: true,
});

const HTTPS_AGENT_INSECURE = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const HTTP_AGENT = new http.Agent({
  keepAlive: true,
});

function normalizeForUrlExtraction(raw) {
  return raw.replace(/\\\//g, "/");
}

function removeQueryAndHash(urlText) {
  const parsed = new URL(urlText);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function parseBool(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function isSongImageUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    return parsed.pathname.startsWith("/data/song_img/");
  } catch {
    return false;
  }
}

function extractPngUrls(content) {
  const normalized = normalizeForUrlExtraction(content);
  const urls = new Set();

  const absoluteRegex = /(https?:\/\/[^\s"'`<>()]+?\.png(?:\?[^\s"'`<>()]*)?)/gi;
  const relativeRegex =
    /(\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+?\.png(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*)?)/g;

  let match;

  while ((match = absoluteRegex.exec(normalized)) !== null) {
    try {
      const parsed = new URL(match[1]);
      if (parsed.hostname.endsWith("piugame.com")) {
        urls.add(removeQueryAndHash(parsed.toString()));
      }
    } catch {
      // Skip malformed URL candidate.
    }
  }

  while ((match = relativeRegex.exec(normalized)) !== null) {
    try {
      const parsed = new URL(match[1], BASE_ORIGIN);
      if (parsed.hostname.endsWith("piugame.com")) {
        urls.add(removeQueryAndHash(parsed.toString()));
      }
    } catch {
      // Skip malformed URL candidate.
    }
  }

  return urls;
}

function resolveOutputPath(assetUrl) {
  const parsed = new URL(assetUrl);
  const decodedPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const relativePath = decodedPath.startsWith("data/")
    ? decodedPath.slice("data/".length)
    : decodedPath;

  if (!relativePath || relativePath.includes("..")) {
    throw new Error(`Unsafe output path resolved from URL: ${assetUrl}`);
  }

  return path.join(OUTPUT_DIR, relativePath);
}

async function runWithConcurrency(items, worker, concurrency) {
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      await worker(items[index], index);
    }
  }

  const workers = [];
  const count = Math.max(1, Math.min(concurrency, items.length));

  for (let i = 0; i < count; i += 1) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
}

function parseLastPageNumber(html) {
  let max = 1;
  const regex = /page=(\d+)/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const page = Number(match[1]);
    if (Number.isFinite(page) && page > max) {
      max = page;
    }
  }

  return max;
}

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function createClient() {
  const client = new PiuClient();
  const username = process.env.PIU_TEST_USERNAME;
  const ssoUsername = process.env.PIU_TEST_SSO_USERNAME;
  const ssoPassword = process.env.PIU_TEST_SSO_PASSWORD;

  if (username && ssoUsername && ssoPassword) {
    client.setSsoCredentials(username, ssoUsername, ssoPassword);
  }

  return client;
}

async function fetchAuthenticatedHtml(client, username, endpointPath) {
  const response = await client.authenticatedRequest(username, {
    method: "GET",
    path: endpointPath,
    redirect: "manual",
  });
  return response.body;
}

async function discoverFromAuthenticatedPages() {
  const username = requireEnv("PIU_TEST_USERNAME");
  const password = requireEnv("PIU_TEST_PASSWORD");

  const client = createClient();
  await client.login(username, password);

  const htmlByName = new Map();

  const firstBestScoreHtml = await fetchAuthenticatedHtml(client, username, "/my_page/my_best_score.php?&&page=1");
  htmlByName.set("my_best_score_page_1", firstBestScoreHtml);

  const lastPage = parseLastPageNumber(firstBestScoreHtml);
  const restPages = [];
  for (let page = 2; page <= lastPage; page += 1) {
    restPages.push(page);
  }

  await runWithConcurrency(
    restPages,
    async (page) => {
      const html = await fetchAuthenticatedHtml(client, username, `/my_page/my_best_score.php?&&page=${page}`);
      htmlByName.set(`my_best_score_page_${page}`, html);
    },
    FETCH_CONCURRENCY,
  );

  const basePages = [
    ["/my_page/play_data.php", "play_data"],
    ["/my_page/recently_played.php", "recently_played"],
    ["/my_page/title.php", "title"],
  ];

  for (const [endpointPath, name] of basePages) {
    const html = await fetchAuthenticatedHtml(client, username, endpointPath);
    htmlByName.set(name, html);
  }

  return {
    htmlByName,
    pageCount: lastPage,
  };
}

async function discoverFromLocalScrapedFolder() {
  const htmlByName = new Map();
  const files = await listFilesRecursive(SCRAPED_DIR);

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".php" && ext !== ".html" && ext !== ".txt") {
      continue;
    }

    const content = await fs.readFile(filePath, "utf8");
    htmlByName.set(path.relative(SCRAPED_DIR, filePath), content);
  }

  return {
    htmlByName,
    pageCount: null,
  };
}

function buildManifest(urls, metadata = {}) {
  return {
    createdAt: new Date().toISOString(),
    total: urls.length,
    ...metadata,
    urls,
  };
}

async function discoverAssetUrlsFromHtmlMap(htmlByName) {
  const urls = new Set();

  for (const html of htmlByName.values()) {
    const extracted = extractPngUrls(html);
    for (const url of extracted) {
      urls.add(url);
    }
  }

  return [...urls].sort();
}

function isTlsCertificateValidationError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = typeof error.code === "string" ? error.code : null;
  if (code && TLS_CERT_ERROR_CODES.has(code)) {
    return true;
  }

  if (error.cause && typeof error.cause === "object") {
    const nestedCode = typeof error.cause.code === "string" ? error.cause.code : null;
    if (nestedCode && TLS_CERT_ERROR_CODES.has(nestedCode)) {
      return true;
    }
  }

  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("unable to verify the first certificate");
}

function formatErrorWithCause(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = [error.message];
  if (error.code) {
    details.push(`code=${error.code}`);
  }

  const cause = error.cause;
  if (cause && typeof cause === "object") {
    if (cause.message) {
      details.push(`cause=${cause.message}`);
    }
    if (cause.code) {
      details.push(`causeCode=${cause.code}`);
    }
  }

  return details.join(" | ");
}

async function requestBinary(urlText, useInsecureTls, redirectCount = 0) {
  if (redirectCount > REDIRECT_LIMIT) {
    throw new Error(`Too many redirects (>${REDIRECT_LIMIT}) for ${urlText}`);
  }

  const target = new URL(urlText);
  const useHttps = target.protocol === "https:";
  const client = useHttps ? https : http;

  const response = await new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: "GET",
        headers: {
          "user-agent": "piugame-sdk/0.1 asset-scraper",
          accept: "image/png,*/*;q=0.8",
          referer: BASE_ORIGIN,
        },
        agent: useHttps
          ? (useInsecureTls ? HTTPS_AGENT_INSECURE : HTTPS_AGENT_STRICT)
          : HTTP_AGENT,
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          });
        });
        incoming.on("error", reject);
      },
    );

    const timeout = setTimeout(() => {
      request.destroy(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    request.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    request.on("close", () => {
      clearTimeout(timeout);
    });

    request.end();
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    const first = Array.isArray(location) ? location[0] : location;
    if (!first) {
      throw new Error(`Redirect response missing Location header for ${urlText}`);
    }

    const nextUrl = new URL(first, urlText).toString();
    return requestBinary(nextUrl, useInsecureTls, redirectCount + 1);
  }

  return response;
}

async function downloadAsset(assetUrl) {
  const fallbackToInsecureTls = parseBool(process.env.PIU_TLS_FALLBACK_INSECURE) ?? true;
  const forceInsecureTls = parseBool(process.env.PIU_INSECURE_TLS) ?? false;

  let response;
  try {
    response = await requestBinary(assetUrl, forceInsecureTls);
  } catch (error) {
    if (!forceInsecureTls && fallbackToInsecureTls && isTlsCertificateValidationError(error)) {
      response = await requestBinary(assetUrl, true);
    } else {
      throw error;
    }
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  const outputPath = resolveOutputPath(assetUrl);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, response.body);

  return outputPath;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fromScrapedOnly = process.argv.includes("--from-scraped");
  const force = process.argv.includes("--force");
  const includeAllPng = process.argv.includes("--all-png");

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  let htmlSource;
  if (fromScrapedOnly) {
    htmlSource = await discoverFromLocalScrapedFolder();
    console.log(`Using local scraped snapshots from ${path.relative(ROOT_DIR, SCRAPED_DIR)}.`);
  } else {
    try {
      htmlSource = await discoverFromAuthenticatedPages();
      console.log(
        `Fetched authenticated PIUGAME pages (my_best_score pages: ${htmlSource.pageCount ?? "unknown"}).`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Authenticated scrape failed (${reason}). Falling back to local scraped snapshots.`);
      htmlSource = await discoverFromLocalScrapedFolder();
    }
  }

  let urls = await discoverAssetUrlsFromHtmlMap(htmlSource.htmlByName);
  if (!includeAllPng) {
    urls = urls.filter((url) => isSongImageUrl(url));
  }

  if (urls.length === 0) {
    console.log("No PNG URLs discovered.");
    return;
  }

  await fs.writeFile(
    MANIFEST_PATH,
    JSON.stringify(
      buildManifest(urls, {
        source: fromScrapedOnly ? "scraped-folder" : "authenticated-or-scraped-fallback",
        filesScanned: htmlSource.htmlByName.size,
        bestScorePages: htmlSource.pageCount,
      }),
      null,
      2,
    ),
  );

  console.log(
    `Discovered ${urls.length} unique PNG assets (${includeAllPng ? "all PNGs" : "song jackets only"}).`,
  );
  console.log(`Manifest written: ${path.relative(ROOT_DIR, MANIFEST_PATH)}`);

  if (dryRun) {
    for (const url of urls) {
      const outputPath = resolveOutputPath(url);
      console.log(`[DRY RUN] ${url} -> ${path.relative(ROOT_DIR, outputPath)}`);
    }
    return;
  }

  let success = 0;
  let failure = 0;
  let skipped = 0;

  await runWithConcurrency(
    urls,
    async (url) => {
      try {
        const outputPath = resolveOutputPath(url);
        if (!force) {
          try {
            await fs.access(outputPath);
            skipped += 1;
            console.log(`[SKIP] ${url} (already exists)`);
            return;
          } catch {
            // File does not exist.
          }
        }

        const writtenPath = await downloadAsset(url);
        success += 1;
        console.log(`[OK] ${url} -> ${path.relative(ROOT_DIR, writtenPath)}`);
      } catch (error) {
        failure += 1;
        const reason = formatErrorWithCause(error);
        console.error(`[FAIL] ${url} (${reason})`);
      }
    },
    DOWNLOAD_CONCURRENCY,
  );

  console.log(
    `Completed. success=${success}, skipped=${skipped}, failure=${failure}, total=${urls.length}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
