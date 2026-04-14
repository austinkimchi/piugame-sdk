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

  const client = new PiuClient();

  try {
    await client.login(username, password);

    const freshProfile = await client.refresh(username);
    console.log("Refreshed profile:", {
      gameIdTag: freshProfile.gameIdTag,
      rating: freshProfile.rating,
      playCount: freshProfile.playCount,
    });

    const all = await client.fetchAllPlays(username);
    console.log("Fetched best-score pages:", all.pagesFetched);
    console.log("Total best-score entries:", all.plays.length);
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
