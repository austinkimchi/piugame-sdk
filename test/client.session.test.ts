import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test, expect } from "vitest";

import { PiuClient } from "../src/client";
import {
  AuthenticationError,
  SSOAutomationError,
  SessionExpiredError,
  SSORequiredError,
} from "../src/errors";
import type { HttpTransport, TransportRequest, TransportResponse } from "../src/types";

function readFixture(fileName: string): string {
  return readFileSync(resolve(process.cwd(), "scraped", fileName), "utf8");
}

function response(
  status: number,
  body: string,
  headers: Record<string, string | string[] | undefined> = {},
  url = "https://www.piugame.com/mock",
): TransportResponse {
  return { status, body, headers, url };
}

function hasSessionCookie(request: TransportRequest): boolean {
  const cookie = request.headers.cookie ?? "";
  return cookie.includes("sid=mocksid") && cookie.includes("PHPSESSID=mockphp");
}

class MockSsoClient extends PiuClient {
  public resolverCallCount = 0;
  public resolverShouldThrow = false;
  public resolverDelayMs = 0;

  protected override async resolveSsoAndHydrateSession(
    username: string,
    _redirectUrl: string,
  ): Promise<void> {
    this.resolverCallCount += 1;

    if (this.resolverDelayMs > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.resolverDelayMs));
    }

    if (this.resolverShouldThrow) {
      throw new SSOAutomationError("Mocked resolver failure.");
    }

    (this as any).sessions.set(username, {
      username,
      cookies: [
        {
          name: "sid",
          value: "mocksid",
          domain: ".piugame.com",
          path: "/",
          expiresAt: new Date(Date.now() + 60_000),
          secure: false,
          httpOnly: false,
        },
        {
          name: "PHPSESSID",
          value: "mockphp",
          domain: ".piugame.com",
          path: "/",
          expiresAt: new Date(Date.now() + 60_000),
          secure: false,
          httpOnly: true,
        },
      ],
      expiresAt: new Date(Date.now() + 60_000),
      lastValidatedAt: Date.now(),
    });
  }
}

describe("PiuClient session manager", () => {
  test("valid session path keeps login count stable", async () => {
    const playDataHtml = readFixture("play_data.php");
    const pumbilityHtml = readFixture("pumpbility.php");
    let loginCalls = 0;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml, {});
      }

      if (url.pathname === "/my_page/pumbility.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, pumbilityHtml, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await client.login("fixture_user", "fixture_password");
    const data = await client.getPlayerData("fixture_user");

    expect(data.gameIdTag).toBe("PKIMCHI#7501");
    expect(data.pumbilityScore).toBe(9352);
    expect(loginCalls).toBe(1);
  });

  test("expired session triggers automatic relogin", async () => {
    const playDataHtml = readFixture("play_data.php");
    let loginCalls = 0;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await client.login("fixture_user", "fixture_password");
    const session = (client as any).sessions.get("fixture_user");
    session.expiresAt = new Date(Date.now() - 1_000);

    const data = await client.getPlayerData("fixture_user");

    expect(data.rating).toBe(18318);
    expect(loginCalls).toBe(2);
  });

  test("redirect to AM-PASS SSO is classified as SSO_REQUIRED", async () => {
    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(302, "", {
          location: "https://api.am-pass.net/sso?redirect=piu",
        });
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await expect(client.login("fixture_user", "fixture_password")).rejects.toBeInstanceOf(
      SSORequiredError,
    );
  });

  test("concurrent getter calls dedupe relogin with per-user lock", async () => {
    const playDataHtml = readFixture("play_data.php");
    let loginCalls = 0;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await client.login("fixture_user", "fixture_password");

    const session = (client as any).sessions.get("fixture_user");
    session.expiresAt = new Date(Date.now() - 1_000);

    const [left, right] = await Promise.all([
      client.getPlayerData("fixture_user"),
      client.getPlayerData("fixture_user"),
    ]);

    expect(left.gameId).toBe("PKIMCHI");
    expect(right.gameId).toBe("PKIMCHI");
    expect(loginCalls).toBe(2);
  });

  test("missing stored credentials after expiry raises session-expired error", async () => {
    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/my_page/play_data.php") {
        return response(302, "", {
          location: "https://api.am-pass.net/sso?redirect=piu",
        });
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    (client as any).sessions.set("fixture_user", {
      username: "fixture_user",
      cookies: [],
      expiresAt: new Date(Date.now() - 1_000),
      lastValidatedAt: 0,
    });

    await expect(client.getPlayerData("fixture_user")).rejects.toBeInstanceOf(SessionExpiredError);
  });

  test("invalid login redirect maps to authentication error", async () => {
    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location: "/bbs/login.php?url=%2F",
          "set-cookie": ["sid=deleted; Path=/; Max-Age=0"],
        });
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await expect(client.login("fixture_user", "bad_password")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  test("SSO redirect triggers resolver once and then succeeds", async () => {
    const playDataHtml = readFixture("play_data.php");
    let loginCalls = 0;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;

        if (loginCalls === 1) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml);
      }

      return response(404, "not found");
    };

    const client = new MockSsoClient({ transport });

    await client.login("fixture_user", "fixture_password");
    const data = await client.getPlayerData("fixture_user");

    expect(data.username).toBe("fixture_user");
    expect(client.resolverCallCount).toBe(1);
    expect(loginCalls).toBe(2);
  });

  test("resolver failure returns SSOAutomationError", async () => {
    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location: "https://api.am-pass.net/sso?redirect=piu",
        });
      }

      return response(404, "not found");
    };

    const client = new MockSsoClient({ transport });
    client.resolverShouldThrow = true;

    await expect(client.login("fixture_user", "fixture_password")).rejects.toBeInstanceOf(
      SSOAutomationError,
    );
    expect(client.resolverCallCount).toBe(1);
  });

  test("resolver success but repeated SSO redirect returns SSORequiredError", async () => {
    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location: "https://api.am-pass.net/sso?redirect=piu",
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(302, "", {
          location: "https://api.am-pass.net/sso?redirect=piu",
        });
      }

      return response(404, "not found");
    };

    const client = new MockSsoClient({ transport });

    await expect(client.login("fixture_user", "fixture_password")).rejects.toBeInstanceOf(
      SSORequiredError,
    );
    expect(client.resolverCallCount).toBe(1);
  });

  test("non-SSO path does not invoke resolver", async () => {
    const playDataHtml = readFixture("play_data.php");

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, playDataHtml);
      }

      return response(404, "not found");
    };

    const client = new MockSsoClient({ transport });

    await client.login("fixture_user", "fixture_password");
    await client.getPlayerData("fixture_user");

    expect(client.resolverCallCount).toBe(0);
  });

  test("concurrent reauth triggers resolver once under lock", async () => {
    const playDataHtml = readFixture("play_data.php");
    let loginCalls = 0;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;

        if (loginCalls === 2) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        if (loginCalls >= 3 && !hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml);
      }

      return response(404, "not found");
    };

    const client = new MockSsoClient({ transport });
    client.resolverDelayMs = 30;

    await client.login("fixture_user", "fixture_password");

    const session = (client as any).sessions.get("fixture_user");
    session.expiresAt = new Date(Date.now() - 1_000);

    const [left, right] = await Promise.all([
      client.getPlayerData("fixture_user"),
      client.getPlayerData("fixture_user"),
    ]);

    expect(left.username).toBe("fixture_user");
    expect(right.username).toBe("fixture_user");
    expect(client.resolverCallCount).toBe(1);
    expect(loginCalls).toBe(3);
  });

  test("fetch_all_plays iterates pages until detected last page", async () => {
    const playDataHtml = readFixture("play_data.php");

    const bestScorePageHtml = (
      songName: string,
      score: number,
      page: number,
      lastPage: number,
    ): string => `
      <div class="board_search"><div class="total_wrap"><i class="t2">3</i></div></div>
      <div class="my_best_score_wrap">
        <ul class="my_best_scoreList flex wrap">
          <li>
            <div class="in">
              <div class="level_con mgL">
                <div class="stepBall_in">
                  <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png"/></div>
                  <div class="numw">
                    <img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png"/>
                    <img src="https://www.piugame.com/l_img/stepball/full/s_num_4.png"/>
                  </div>
                </div>
              </div>
              <div class="song_con"><div class="song_name"><p>${songName}</p></div></div>
              <div class="etc_con">
                <ul class="list">
                  <li><div class="txt_v"><span class="num">${score.toLocaleString()}</span></div></li>
                  <li><div class="img"><img src="https://www.piugame.com/l_img/grade/aa.png"/></div></li>
                  <li><div class="img st1"><img src="https://www.piugame.com/l_img/plate/tg.png"/></div></li>
                </ul>
              </div>
            </div>
          </li>
        </ul>
        <div class="page_search">
          <div class="board_paging">
            <button type="button" onclick="location.href='?&&amp;page=${page}'" class="on">${page}</button>
            <button type="button" onclick="location.href='?&&amp;page=${lastPage}'" class="icon"><i class="xi last"></i></button>
          </div>
        </div>
      </div>
    `;

    const pages: Record<string, string> = {
      "1": bestScorePageHtml("Song 1", 900001, 1, 3),
      "2": bestScorePageHtml("Song 2", 900002, 2, 3),
      "3": bestScorePageHtml("Song 3", 900003, 3, 3),
    };

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, playDataHtml, {});
      }

      if (url.pathname === "/my_page/my_best_score.php") {
        const page = url.searchParams.get("page") ?? "1";
        return response(200, pages[page] ?? "<ul class='my_best_scoreList'></ul>", {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });
    await client.login("fixture_user", "fixture_password");

    const allPlays = await client.fetchAllPlays("fixture_user");

    expect(allPlays.totalPages).toBe(3);
    expect(allPlays.pagesFetched).toEqual([1, 2, 3]);
    expect(allPlays.plays).toHaveLength(3);
    expect(allPlays.plays.map((play) => play.songName)).toEqual([
      "Song 1",
      "Song 2",
      "Song 3",
    ]);
  });

  test("multi-user sessions stay isolated under concurrent access", async () => {
    const playDataHtml = readFixture("play_data.php");
    const seenPlayDataCookies: string[] = [];

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        const body = request.body ?? "";
        const params = new URLSearchParams(body);
        const username = params.get("mb_id") ?? "unknown";
        return response(302, "", {
          location: "/",
          "set-cookie": [
            `sid=${username}; Path=/; Domain=.piugame.com; Max-Age=3600`,
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        const cookie = request.headers.cookie ?? "";
        seenPlayDataCookies.push(cookie);

        const hasUserA = cookie.includes("sid=user_a");
        const hasUserB = cookie.includes("sid=user_b");
        const hasPhp = cookie.includes("PHPSESSID=mockphp");

        if (!hasPhp || (hasUserA && hasUserB) || (!hasUserA && !hasUserB)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml);
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await Promise.all([
      client.login("user_a", "password_a"),
      client.login("user_b", "password_b"),
    ]);

    const [profileA, profileB] = await Promise.all([
      client.getPlayerData("user_a"),
      client.getPlayerData("user_b"),
    ]);

    expect(profileA.username).toBe("user_a");
    expect(profileB.username).toBe("user_b");
    expect(seenPlayDataCookies.some((cookie) => cookie.includes("sid=user_a"))).toBe(true);
    expect(seenPlayDataCookies.some((cookie) => cookie.includes("sid=user_b"))).toBe(true);
  });
});
