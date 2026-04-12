import "dotenv/config";

import {
  AuthenticationError,
  PiuClient,
  SSOAutomationError,
  SSORequiredError,
} from "../src";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

async function main(): Promise<void> {
  const debug = /^(1|true|yes|on)$/i.test(process.env.PIU_DEBUG ?? "");
  let step = "startup";
  const mark = (label: string): void => {
    step = label;
    if (debug) {
      console.log(`[debug] step=${label}`);
    }
  };

  mark("read-env");
  const username = getRequiredEnv("PIU_TEST_USERNAME");
  const password = getRequiredEnv("PIU_TEST_PASSWORD");
  const ssoUsername = process.env.PIU_TEST_SSO_USERNAME;
  const ssoPassword = process.env.PIU_TEST_SSO_PASSWORD;
  const ssoHeadlessOverride = parseBooleanEnv(process.env.PIU_SSO_HEADLESS);
  const ssoTimeoutMsRaw = process.env.PIU_SSO_TIMEOUT_MS;
  const ssoTimeoutMsParsed = ssoTimeoutMsRaw ? Number(ssoTimeoutMsRaw) : undefined;
  const ssoTimeoutMs =
    typeof ssoTimeoutMsParsed === "number" &&
    Number.isFinite(ssoTimeoutMsParsed) &&
    ssoTimeoutMsParsed > 0
      ? ssoTimeoutMsParsed
      : undefined;

  mark("create-client");
  const client = new PiuClient({
    ssoHeadless: ssoHeadlessOverride,
    ssoTimeoutMs,
  });
  if (debug) {
    console.log(
      `[debug] ssoHeadless=${String(
        ssoHeadlessOverride ?? true,
      )}, ssoTimeoutMs=${String(ssoTimeoutMs ?? 60000)}`,
    );
  }

  if (ssoUsername && ssoPassword) {
    mark("set-sso-credentials");
    client.setSsoCredentials(username, ssoUsername, ssoPassword);
  }

  try {
    mark("login");
    await client.login(username, password);

    mark("get-player-data");
    const playerData = await client.getPlayerData(username);
    console.log("Player:", playerData.gameIdTag ?? playerData.username);
    console.log("Data:", playerData);

    mark("get-recent-plays");
    const recentPlays = await client.getRecentPlays(username);
    console.log("Recent Plays:", recentPlays);

    mark("get-title");
    const titles = await client.getTitle(username);
    console.log("Titles:", titles);
  } catch (error) {
    if (debug) {
      const typed = error as {
        code?: string;
        message?: string;
        cause?: unknown;
        stack?: string;
      };
      console.error("[debug] failed step:", step);
      console.error("[debug] error code:", typed?.code ?? "(none)");
      console.error("[debug] error message:", typed?.message ?? String(error));
      if (typed?.cause) {
        console.error("[debug] error cause:", typed.cause);
      }
      if (typed?.stack) {
        console.error("[debug] stack:", typed.stack);
      }
    }

    if (error instanceof SSORequiredError) {
      console.error("SSO required. Complete AM-PASS login:", error.redirectUrl);
      return;
    }
    if (error instanceof AuthenticationError) {
      console.error("Authentication failed:", error.message);
      return;
    }
    if (error instanceof SSOAutomationError) {
      console.error(
        "Automatic SSO failed. If needed, install browser binaries: npx playwright install chromium",
      );
      return;
    }
    throw error;
  } finally {
    mark("logout");
    await client.logout(username).catch(() => {
      // Keep example simple; ignore logout failures.
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
