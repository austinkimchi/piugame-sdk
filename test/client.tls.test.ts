import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { PiuClient } from "../src/client";
import type { HttpTransport, PiuClientOptions } from "../src/types";

// Fresh disposable CA/key material; never contacts PIUGAME or loads account credentials.
let directory: string;
let root: string;
let intermediate: string;
let validUrl: string;
let expiredUrl: string;
let selfSignedUrl: string;
const servers: https.Server[] = [];
const received: Array<{ url: string; body: string }> = [];
const binary = Buffer.from([0, 1, 254, 255]);

function openssl(...args: string[]) {
  execFileSync("openssl", args, { cwd: directory, stdio: "pipe", timeout: 10_000 });
}

async function serve(certificate: string, key = "leaf.key") {
  const server = https.createServer({ cert: readFileSync(path.join(directory, certificate)), key: readFileSync(path.join(directory, key)) }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ url: request.url ?? "", body: Buffer.concat(chunks).toString() });
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/asset" });
        response.end();
      } else if (request.url === "/asset") {
        response.end(binary);
      } else {
        response.end("ok");
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local TCP server");
  return `https://localhost:${address.port}`;
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "piu-sdk-tls-"));
  for (const name of ["root", "intermediate", "leaf"]) {
    openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", `${name}.key`);
  }
  openssl("req", "-x509", "-new", "-key", "root.key", "-days", "2", "-subj", "/CN=PIU disposable test root", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", "root.pem");
  openssl("req", "-new", "-key", "intermediate.key", "-subj", "/CN=PIU disposable intermediate", "-out", "intermediate.csr");
  writeFileSync(path.join(directory, "intermediate.ext"), "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n");
  openssl("x509", "-req", "-in", "intermediate.csr", "-CA", "root.pem", "-CAkey", "root.key", "-set_serial", "2", "-days", "2", "-extfile", "intermediate.ext", "-out", "intermediate.pem");
  openssl("req", "-new", "-key", "leaf.key", "-subj", "/CN=localhost", "-out", "leaf.csr");
  const extension = "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n";
  writeFileSync(path.join(directory, "leaf.ext"), extension);
  openssl("x509", "-req", "-in", "leaf.csr", "-CA", "intermediate.pem", "-CAkey", "intermediate.key", "-set_serial", "3", "-days", "1", "-extfile", "leaf.ext", "-out", "leaf.pem");
  writeFileSync(path.join(directory, "index"), "");
  writeFileSync(path.join(directory, "serial"), "04\n");
  writeFileSync(path.join(directory, "expired.cnf"), `[ca]\ndefault_ca=issuer\n[issuer]\ndatabase=index\nserial=serial\nnew_certs_dir=.\ncertificate=intermediate.pem\nprivate_key=intermediate.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n[server_cert]\n${extension}`);
  openssl("ca", "-batch", "-config", "expired.cnf", "-extensions", "server_cert", "-in", "leaf.csr", "-startdate", "20000101000000Z", "-enddate", "20010101000000Z", "-notext", "-out", "expired.pem");
  openssl("req", "-x509", "-new", "-key", "leaf.key", "-days", "1", "-subj", "/CN=localhost", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=serverAuth", "-addext", "subjectAltName=DNS:localhost", "-out", "self-signed.pem");
  root = readFileSync(path.join(directory, "root.pem"), "utf8");
  intermediate = readFileSync(path.join(directory, "intermediate.pem"), "utf8");
  validUrl = await serve("leaf.pem");
  expiredUrl = await serve("expired.pem");
  selfSignedUrl = await serve("self-signed.pem");
}, 30_000);

afterEach(() => { received.length = 0; vi.unstubAllEnvs(); });
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function client(options: PiuClientOptions = {}) {
  // These private methods are exercised to isolate real TLS from authentication/parser fixtures.
  return new PiuClient({ baseUrl: validUrl, timeoutMs: 2_000, rejectUnauthorized: true, allowInsecureTlsFallback: false, ...options }) as unknown as {
    transport: HttpTransport;
    downloadBinaryAsset(url: string): Promise<Buffer>;
  };
}
function textRequest(c: ReturnType<typeof client>, url = validUrl) {
  return c.transport({ method: "POST", url, headers: {}, body: "disposable-test-body" });
}

describe("per-client verified CA chain", () => {
  test("a supplied intermediate completes both text and binary TLS without replacing the trusted root", async () => {
    const c = client({ ca: [root, intermediate] });
    expect((await textRequest(c)).body).toBe("ok");
    expect(await c.downloadBinaryAsset(`${validUrl}/asset`)).toEqual(binary);
    expect(received[0].body).toBe("disposable-test-body");
  });

  test.each([
    ["missing intermediate", () => [root], () => validUrl, "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    ["missing root", () => [intermediate], () => validUrl, "UNABLE_TO_GET_ISSUER_CERT"],
    ["wrong hostname", () => [root, intermediate], () => validUrl.replace("localhost", "127.0.0.1"), "ERR_TLS_CERT_ALTNAME_INVALID"],
    ["expired leaf", () => [root, intermediate], () => expiredUrl, "CERT_HAS_EXPIRED"],
    ["untrusted self-signed certificate", () => [] as string[], () => selfSignedUrl, "DEPTH_ZERO_SELF_SIGNED_CERT"],
  ] as const)("rejects %s before sending text or binary application requests", async (_name, ca, url, code) => {
    const c = client({ ca: ca() });
    await expect(textRequest(c, url())).rejects.toMatchObject({ code });
    await expect(c.downloadBinaryAsset(`${url()}/asset`)).rejects.toMatchObject({ code });
    expect(received).toEqual([]);
  });

  test("explicit strict constructor policy overrides insecure environment defaults for binary too", async () => {
    vi.stubEnv("PIU_INSECURE_TLS", "1");
    vi.stubEnv("PIU_TLS_FALLBACK_INSECURE", "1");
    const c = client({ ca: [root] });
    await expect(textRequest(c)).rejects.toMatchObject({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    await expect(c.downloadBinaryAsset(`${validUrl}/asset`)).rejects.toMatchObject({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    expect(received).toEqual([]);
  });

  test("explicit legacy fallback remains available rather than changing public defaults", async () => {
    const c = client({ ca: [root], allowInsecureTlsFallback: true });
    expect((await textRequest(c)).body).toBe("ok");
    expect(await c.downloadBinaryAsset(`${validUrl}/asset`)).toEqual(binary);
  });

  test("omitted policy preserves PIU text and legacy binary defaults", async () => {
    vi.stubEnv("PIU_INSECURE_TLS", "");
    vi.stubEnv("PIU_TLS_FALLBACK_INSECURE", "");
    const piu = new PiuClient({ baseUrl: "https://piugame.com", ca: [root], timeoutMs: 2_000 }) as unknown as ReturnType<typeof client>;
    const other = new PiuClient({ baseUrl: validUrl, ca: [root], timeoutMs: 2_000 }) as unknown as ReturnType<typeof client>;
    // Requests still target only the disposable local server.
    expect((await textRequest(piu)).body).toBe("ok");
    await expect(textRequest(other)).rejects.toMatchObject({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    expect(await other.downloadBinaryAsset(`${validUrl}/asset`)).toEqual(binary);
  });

  test("redirects retain the strict CA policy for text and binary requests", async () => {
    const c = client({ ca: [root, intermediate] });
    expect((await c.transport({ url: `${validUrl}/redirect`, method: "GET", headers: {} })).status).toBe(200);
    expect(await c.downloadBinaryAsset(`${validUrl}/redirect`)).toEqual(binary);
    expect(received.map((r) => r.url)).toEqual(["/redirect", "/asset", "/redirect", "/asset"]);
  });

  test("custom text transport stays authoritative, while binary retains client TLS policy", async () => {
    const transport = vi.fn<HttpTransport>(async (request) => ({ status: 200, body: "custom", url: request.url, headers: {} }));
    const c = client({ ca: [root, intermediate], transport });
    expect((await textRequest(c)).body).toBe("custom");
    expect(await c.downloadBinaryAsset(`${validUrl}/asset`)).toEqual(binary);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(received.map((r) => r.url)).toEqual(["/asset"]);
  });
});
