import "dotenv/config";

import { PiuClient } from "../src";
import { SSORequiredError } from "../src/errors";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const username = getRequiredEnv("PIU_TEST_USERNAME");
  const password = getRequiredEnv("PIU_TEST_PASSWORD");
  const mongoUri = getRequiredEnv("PIU_MONGO_URI");
  const ssoUsername = process.env.PIU_TEST_SSO_USERNAME;
  const ssoPassword = process.env.PIU_TEST_SSO_PASSWORD;

  const client = new PiuClient();
  if (ssoUsername && ssoPassword) {
    client.setSsoCredentials(username, ssoUsername, ssoPassword);
  }
  await client.setDatabase(mongoUri);

  try {
    await client.login(username, password);

    const started = Date.now();
    await client.getPlayerData(username);
    const firstMs = Date.now() - started;

    const startedCached = Date.now();
    await client.getPlayerData(username);
    const cachedMs = Date.now() - startedCached;

    console.log("First fetch ms:", firstMs);
    console.log("Second fetch ms (usually cached):", cachedMs);
  } catch (error) {
    if (error instanceof SSORequiredError) {
      console.error("SSO required. Complete AM-PASS login:", error.redirectUrl);
      return;
    }
    throw error;
  } finally {
    await client.logout(username).catch(() => {
      // Keep example simple; ignore logout failures.
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
