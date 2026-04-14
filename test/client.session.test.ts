import { describe, test, expect } from "vitest";

import { PiuClient } from "../src/client";
import {
  AuthenticationError,
  SSOAutomationError,
  SessionExpiredError,
  SSORequiredError,
} from "../src/errors";
import type { HttpTransport, TransportRequest, TransportResponse } from "../src/types";

const PLAY_DATA_HTML = `
<div class="subProfile_wrap">
  <div class="in_profile">
    <div class="profile_name">
      <div class="name_w">
        <span class="t1">CONRAD FOLLOWER</span>
        <span class="t2">PKIMCHI#7501</span>
      </div>
    </div>
    <div class="profile_img">
      <div class="re" style="background-image:url('https://www.piugame.com/data/avatar_img/avatar_a.png')"></div>
    </div>
    <div class="profile_etc"><span class="tt">1,034</span></div>
    <ul class="time_w">
      <li><span class="tt">last access date : 2026-04-11 12:37:31</span></li>
      <li><span class="tt">recently access games : ROUND1 SLM 2</span></li>
    </ul>
  </div>
</div>
<div class="board_search"><div class="total"><span class="t2">215</span></div></div>
<div class="play_data_wrap">
  <div class="my_w"><span class="num">18318</span></div>
  <div class="clear_w">
    <div class="l_con"><span class="t1">125 / 3,646</span></div>
    <div class="graph"><span class="num">3%</span></div>
  </div>
  <div class="plate_w">
    <ul class="list">
      <li><a data-type="fg"></a><span class="t_num">40</span></li>
    </ul>
  </div>
</div>
`;

const PUMBILITY_SCORE_HTML = `
<div class="pumbility_total_wrap">
  <div class="inn">
    <div class="t1">Pumbility</div>
    <div class="t2">9,352</div>
  </div>
</div>
`;

const PUMBILITY_TOP_HTML = `
<div class="rating_rangking_list_w pumblitiySt">
  <ul class="list">
    ${Array.from({ length: 50 }, (_, index) => {
      const rank = index + 1;
      const songName =
        rank === 1 ? "Spray" : rank === 50 ? "Cleaner" : `Song ${rank}`;
      const score = rank === 1 ? 300 : rank === 50 ? 160 : 200 - rank;
      return `
      <li>
        <div class="num"><div class="img_wrap"><div class="num"><span class="tt">${rank}</span></div></div></div>
        <div class="profile_img"><div class="re" style="background-image:url('https://www.piugame.com/data/song_img/${rank}.png')"></div></div>
        <div class="profile_name"><span class="t1">${songName}</span><span class="t2">WEi</span></div>
        <div class="stepBall_in">
          <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
          <div class="numw">
            <img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" />
            <img src="https://www.piugame.com/l_img/stepball/full/s_num_5.png" />
          </div>
        </div>
        <div class="grade_wrap"><img src="https://www.piugame.com/l_img/grade/s.png" /></div>
        <div class="score"><span class="tt">${score}</span></div>
        <div class="date"><span class="tt">2026-04-13 13:24:55 (GMT+9)</span></div>
      </li>
      `;
    }).join("")}
  </ul>
</div>
`;

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

class SsoReadinessClient extends PiuClient {
  public async waitForReadiness(
    context: any,
    page: any,
    submitted: boolean,
  ): Promise<unknown[]> {
    return this.waitForSsoSessionReadiness(context, page, submitted);
  }

  public async waitForEntry(context: any, page: any): Promise<void> {
    await this.waitForSsoEntryReadiness(context, page);
  }
}

function browserSessionCookie(): unknown {
  return {
    name: "sid",
    value: "mocksid",
    domain: ".piugame.com",
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 3600,
    secure: false,
    httpOnly: true,
  };
}

describe("PiuClient session manager", () => {
  test("valid session path keeps login count stable", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const pumbilityHtml = PUMBILITY_SCORE_HTML;
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

  test("recently validated session skips extra probe on repeated getPlayerData", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const pumbilityHtml = PUMBILITY_SCORE_HTML;
    let loginCalls = 0;
    let playDataCalls = 0;
    let pumbilityCalls = 0;

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
        playDataCalls += 1;
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml, {});
      }

      if (url.pathname === "/my_page/pumbility.php") {
        pumbilityCalls += 1;
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, pumbilityHtml, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({
      transport,
      cacheTtl: { playerDataMs: 1 },
    });

    await client.login("fixture_user", "fixture_password");

    playDataCalls = 0;
    pumbilityCalls = 0;

    await client.getPlayerData("fixture_user");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    await client.getPlayerData("fixture_user");

    expect(loginCalls).toBe(1);
    expect(playDataCalls).toBe(2);
    expect(pumbilityCalls).toBe(2);
  });

  test("cooldown expiry resumes session probe before getter request", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const pumbilityHtml = PUMBILITY_SCORE_HTML;
    let playDataCalls = 0;

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
        playDataCalls += 1;
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, playDataHtml, {});
      }

      if (url.pathname === "/my_page/pumbility.php") {
        return response(200, pumbilityHtml, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({
      transport,
      cacheTtl: { playerDataMs: 1 },
    });

    await client.login("fixture_user", "fixture_password");
    playDataCalls = 0;

    const session = (client as any).sessions.get("fixture_user");
    session.lastValidatedAt = Date.now() - 61_000;

    await client.getPlayerData("fixture_user");

    expect(playDataCalls).toBe(2);
  });

  test("getTopPlays returns top 50 pumbility-contributing scores", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const pumbilityHtml = PUMBILITY_TOP_HTML;

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
    const topPlays = await client.getTopPlays("fixture_user");

    expect(topPlays).toHaveLength(50);
    expect(topPlays[0]?.rank).toBe(1);
    expect(topPlays[0]?.songName).toBe("Spray");
    expect(topPlays[0]?.score).toBe(300);
    expect(topPlays[49]?.rank).toBe(50);
  });

  test("expired session triggers automatic relogin", async () => {
    const playDataHtml = PLAY_DATA_HTML;
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
    const playDataHtml = PLAY_DATA_HTML;
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
    const playDataHtml = PLAY_DATA_HTML;
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
    expect(loginCalls).toBe(1);
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

  test("SSO readiness resolves from PIUGAME cookies without page-load waits", async () => {
    let cookieReads = 0;
    let pollCalls = 0;
    let pageUrl = "https://api.am-pass.net/sso";
    const client = new SsoReadinessClient({ ssoTimeoutMs: 500 });
    const context = {
      cookies: async () => {
        cookieReads += 1;
        return cookieReads >= 2 ? [browserSessionCookie()] : [];
      },
    };
    const page = {
      url: () => pageUrl,
      waitForLoadState: async () => {
        throw new Error("waitForLoadState should not be used for SSO readiness.");
      },
      waitForTimeout: async () => {
        pollCalls += 1;
        pageUrl = "https://www.piugame.com/";
      },
      locator: (selector: string) => ({
        count: async () => (selector === ".profile_name" && pageUrl === "https://www.piugame.com/" ? 1 : 0),
      }),
    };

    const cookies = await client.waitForReadiness(context, page, true);

    expect(cookies).toHaveLength(1);
    expect(cookieReads).toBe(2);
    expect(pollCalls).toBe(1);
  });

  test("SSO readiness timeout remains an automation error when cookies never arrive", async () => {
    const client = new SsoReadinessClient({ ssoTimeoutMs: 5 });
    const context = {
      cookies: async () => [],
    };
    const page = {
      url: () => "https://api.am-pass.net/sso",
      waitForTimeout: async (timeoutMs: number) => {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, timeoutMs));
      },
    };

    await expect(client.waitForReadiness(context, page, false)).rejects.toBeInstanceOf(
      SSOAutomationError,
    );
  });

  test("SSO readiness maps post-submit login page to AuthenticationError", async () => {
    const client = new SsoReadinessClient({ ssoTimeoutMs: 500 });
    const context = {
      cookies: async () => [],
    };
    const page = {
      url: () => "https://www.piugame.com/bbs/login.php",
      waitForTimeout: async () => {
        throw new Error("login rejection should resolve before polling.");
      },
    };

    await expect(client.waitForReadiness(context, page, true)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  test("non-SSO path does not invoke resolver", async () => {
    const playDataHtml = PLAY_DATA_HTML;

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
    const playDataHtml = PLAY_DATA_HTML;
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
    expect(loginCalls).toBe(2);
  });

  test("fetch_all_plays iterates pages until detected last page", async () => {
    const playDataHtml = PLAY_DATA_HTML;

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
    const playDataHtml = PLAY_DATA_HTML;
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
