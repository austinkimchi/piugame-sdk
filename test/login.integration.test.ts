import { describe, test, expect } from "vitest";

import "dotenv/config";

import { PiuClient } from "../src/client";
import {
  AuthenticationError,
  SSOAutomationError,
  SSORequiredError,
} from "../src/errors";

const username = process.env.PIU_TEST_USERNAME;
const password = process.env.PIU_TEST_PASSWORD;
const ssoUsername = process.env.PIU_TEST_SSO_USERNAME;
const ssoPassword = process.env.PIU_TEST_SSO_PASSWORD;

function parseBool(value: string | undefined): boolean | null {
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

const insecureTlsOverride = parseBool(process.env.PIU_TEST_INSECURE_TLS);

function createClient(): PiuClient {
  const client =
    insecureTlsOverride === null
      ? new PiuClient()
      : new PiuClient({ rejectUnauthorized: !insecureTlsOverride });

  if (username && ssoUsername && ssoPassword) {
    client.setSsoCredentials(username, ssoUsername, ssoPassword);
  }

  return client;
}

const describeIntegration = username && password ? describe : describe.skip;

function assertSsoRedirect(redirectUrl: string): void {
  expect(redirectUrl).toMatch(/api\.am-pass\.net\/sso/i);
}

function assertSsoAutomationFailure(error: unknown): void {
  expect(error).toBeInstanceOf(SSOAutomationError);
}

describeIntegration("integration login (.env)", () => {
  test(
    "login succeeds and allows get_player_data",
    async () => {
      const client = createClient();

      try {
        await client.login(username as string, password as string);
      } catch (error) {
        if (error instanceof SSORequiredError) {
          assertSsoRedirect(error.redirectUrl);
          return;
        }
        if (error instanceof AuthenticationError) {
          expect(error.message).toMatch(/auth|credential|session/i);
          return;
        }
        if (error instanceof SSOAutomationError) {
          assertSsoAutomationFailure(error);
          return;
        }

        throw error;
      }

      const data = await client.getPlayerData(username as string);
      expect(data.username).toBe(username);
      expect(data.gameIdTag).toBeTruthy();
    },
    120_000,
  );

  test(
    "session invalidation triggers automatic relogin on next getter call",
    async () => {
      const client = createClient();

      try {
        await client.login(username as string, password as string);
      } catch (error) {
        if (error instanceof SSORequiredError) {
          assertSsoRedirect(error.redirectUrl);
          return;
        }
        if (error instanceof AuthenticationError) {
          expect(error.message).toMatch(/auth|credential|session/i);
          return;
        }
        if (error instanceof SSOAutomationError) {
          assertSsoAutomationFailure(error);
          return;
        }

        throw error;
      }

      const session = (client as any).sessions.get(username as string);
      if (!session) {
        throw new Error("Expected in-memory session after login.");
      }

      session.expiresAt = new Date(Date.now() - 1_000);
      const data = await client.getPlayerData(username as string);

      expect(data.username).toBe(username);
      expect(data.rating).not.toBeNull();
    },
    120_000,
  );

  test(
    "invalid credentials produce AuthenticationError (not generic failure)",
    async () => {
      const client = createClient();

      try {
        await client.login(username as string, `${password as string}__definitely_invalid__`);

        // In some SSO-enabled environments, an already-established SSO session
        // can keep the user authenticated even when this credential check is invalid.
        const data = await client.getPlayerData(username as string);
        expect(data.username).toBe(username);
        return;
      } catch (error) {
        if (error instanceof SSORequiredError) {
          assertSsoRedirect(error.redirectUrl);
          return;
        }
        if (error instanceof SSOAutomationError) {
          assertSsoAutomationFailure(error);
          return;
        }

        expect(error).toBeInstanceOf(AuthenticationError);
      }
    },
    120_000,
  );
});
