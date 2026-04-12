const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = process.cwd();
const EXAMPLE_DIR = path.join(ROOT_DIR, "example");
const OUTPUT_DIR = path.join(ROOT_DIR, "data");
const BASE_ORIGIN = "https://www.piugame.com";
const MAX_CONCURRENCY = 8;

const SEED_URLS = [
  "https://www.piugame.com/data/song_img/9d407b174aada4561c5da22425bd6a57.png",
  "https://www.piugame.com/l_img/bg1.png",
  "https://www.piugame.com/l_img/grade/aaa.png",
];

function normalizeForUrlExtraction(raw) {
  return raw.replace(/\\\//g, "/");
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

function extractPngUrls(content) {
  const normalized = normalizeForUrlExtraction(content);
  const urls = new Set();

  const absoluteRegex = /(https?:\/\/[^\s"'`<>()]+?\.png(?:\?[^\s"'`<>()]*)?)/gi;
  const relativeRegex = /(\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+?\.png(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*)?)/g;

  let match;

  while ((match = absoluteRegex.exec(normalized)) !== null) {
    try {
      const parsed = new URL(match[1]);
      if (parsed.hostname.endsWith("piugame.com")) {
        urls.add(parsed.href);
      }
    } catch {
      // Skip malformed URL candidate.
    }
  }

  while ((match = relativeRegex.exec(normalized)) !== null) {
    try {
      const parsed = new URL(match[1], BASE_ORIGIN);
      urls.add(parsed.href);
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

async function discoverAssetUrls() {
  const urls = new Set(SEED_URLS);

  const files = await listFilesRecursive(EXAMPLE_DIR);
  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    const extracted = extractPngUrls(content);
    for (const url of extracted) {
      urls.add(url);
    }
  }

  return [...urls].sort();
}

async function downloadAsset(assetUrl) {
  const response = await fetch(assetUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const outputPath = resolveOutputPath(assetUrl);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  return outputPath;
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const urls = await discoverAssetUrls();
  if (urls.length === 0) {
    console.log("No PNG URLs discovered.");
    return;
  }

  console.log(`Discovered ${urls.length} PNG assets.`);

  if (dryRun) {
    for (const url of urls) {
      const outputPath = resolveOutputPath(url);
      console.log(`[DRY RUN] ${url} -> ${path.relative(ROOT_DIR, outputPath)}`);
    }
    return;
  }

  let success = 0;
  let failure = 0;

  await runWithConcurrency(
    urls,
    async (url) => {
      try {
        const outputPath = await downloadAsset(url);
        success += 1;
        console.log(`[OK] ${url} -> ${path.relative(ROOT_DIR, outputPath)}`);
      } catch (error) {
        failure += 1;
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[FAIL] ${url} (${reason})`);
      }
    },
    MAX_CONCURRENCY,
  );

  console.log(`Completed. success=${success}, failure=${failure}, total=${urls.length}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
