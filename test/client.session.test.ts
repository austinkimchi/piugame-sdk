import { afterEach, describe, test, expect, vi } from "vitest";

import { PiuClient } from "../src/client";
import {
  AuthenticationError,
  SSOAutomationError,
  SessionExpiredError,
  SSORequiredError,
  TitleUpdateError,
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

function titleHtml(activeTitle: "CONRAD FOLLOWER" | "SUNNY FOLLOWER" = "CONRAD FOLLOWER"): string {
  const conradInUse = activeTitle === "CONRAD FOLLOWER";
  const sunnyInUse = activeTitle === "SUNNY FOLLOWER";

  return `
  <div class="board_search"><div class="total_wrap"><span class="t2">2</span></div></div>
  <ul class="data_titleList2">
    <li class="have" data-name="CONRAD FOLLOWER">
      <div class="txt_w"><div class="txt">CONRAD FOLLOWER</div></div>
      <div class="state_w">
        ${
          conradInUse
            ? '<button type="button" class="stateBox"><i class="tt">Title in use</i></button>'
            : `<form action="https://www.piugame.com/logic/user_title_update.php" method="post">
                <input type="hidden" name="no" value="conrad-token" />
                <button type="submit" class="stateBox"><i class="tt">Set</i></button>
              </form>`
        }
      </div>
      <div class="txt_w2"><div class="txt">Follower title</div></div>
    </li>
    <li class="have" data-name="SUNNY FOLLOWER">
      <div class="txt_w"><div class="txt">SUNNY FOLLOWER</div></div>
      <div class="state_w">
        ${
          sunnyInUse
            ? '<button type="button" class="stateBox"><i class="tt">Title in use</i></button>'
            : `<form action="https://www.piugame.com/logic/user_title_update.php" method="post">
                <input type="hidden" name="no" value="L2JXVVZ0NDYwSm1CbFZiemNad2lBUT09" />
                <button type="submit" class="stateBox"><i class="tt">Set</i></button>
              </form>`
        }
      </div>
      <div class="txt_w2"><div class="txt">[SUNNY STEP] 100+ Plays</div></div>
    </li>
    <li class="not" data-name="LOCKED TITLE">
      <div class="txt_w"><div class="txt">LOCKED TITLE</div></div>
      <div class="state_w"><button type="button" class="stateBox"><i class="tt">Not achieving the unlock condition</i></button></div>
      <div class="txt_w2"><div class="txt">Locked condition</div></div>
    </li>
    <li class="have" data-name="BEGINNER">
      <div class="txt_w"><div class="txt">BEGINNER</div></div>
      <div class="state_w">
        <form action="https://www.piugame.com/logic/user_title_update.php" method="post">
          <input type="hidden" name="no" value="cU1zQktpTE84SWZPSTNIbkpKSytNUT09" />
          <button type="submit" class="stateBox"><i class="tt">Set</i></button>
        </form>
      </div>
    </li>
  </ul>
  `;
}

function playerDataHtmlWithTitle(titleName: string): string {
  return PLAY_DATA_HTML.replace("CONRAD FOLLOWER", titleName);
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

  public async waitForBootstrap(context: any, page: any): Promise<unknown[]> {
    return this.waitForSsoBootstrapCookies(context, page);
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

function mockPlaywrightForSso(cookies: unknown[]): {
  browserCloseCalls: () => number;
  gotoCalls: () => number;
} {
  let browserCloseCalls = 0;
  let gotoCalls = 0;

  vi.doMock("playwright", () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          cookies: async () => cookies,
          newPage: async () => ({
            goto: async () => {
              gotoCalls += 1;
            },
            url: () => "https://www.piugame.com/",
            waitForTimeout: async () => undefined,
          }),
        }),
        close: async () => {
          browserCloseCalls += 1;
        },
      }),
    },
  }));

  return {
    browserCloseCalls: () => browserCloseCalls,
    gotoCalls: () => gotoCalls,
  };
}

afterEach(() => {
  vi.doUnmock("playwright");
});

describe("PiuClient session manager", () => {
  test("defaults to Phoenix domain", async () => {
    let requestedUrl: string | undefined;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        requestedUrl = request.url;
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, PLAY_DATA_HTML, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });
    await client.login("fixture_user", "fixture_password");

    expect(requestedUrl).toBe("https://phoenix.piugame.com/bbs/login_check.php");
  });

  test("Phoenix 2 version targets the main PIUGAME domain", async () => {
    let requestedUrl: string | undefined;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        requestedUrl = request.url;
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, PLAY_DATA_HTML, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ version: "phoenix2", transport });
    await client.login("fixture_user", "fixture_password");

    expect(requestedUrl).toBe("https://www.piugame.com/bbs/login_check.php");
  });

  test("baseUrl overrides version", async () => {
    let requestedUrl: string | undefined;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        requestedUrl = request.url;
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.example.test; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, PLAY_DATA_HTML, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({
      version: "phoenix2",
      baseUrl: "https://example.test",
      transport,
    });
    await client.login("fixture_user", "fixture_password");

    expect(requestedUrl).toBe("https://example.test/bbs/login_check.php");
  });

  test("login POST uses browser navigation headers and raw form separators", async () => {
    let postedHeaders: Record<string, string> | undefined;
    let postedBody: string | undefined;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        postedHeaders = request.headers;
        postedBody = request.body;
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, PLAY_DATA_HTML, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });
    await client.login("fixture_user@example.com", "fixture_password");

    expect(postedHeaders?.accept).toContain("text/html");
    expect(postedHeaders?.origin).toBe("https://phoenix.piugame.com");
    expect(postedHeaders?.referer).toBe("https://phoenix.piugame.com/");
    expect(postedHeaders?.["sec-fetch-mode"]).toBe("navigate");
    expect(postedHeaders?.["upgrade-insecure-requests"]).toBe("1");
    expect(postedHeaders?.["user-agent"]).toContain("Mozilla/5.0");
    expect(postedBody).toContain("url=%2F&mb_id=fixture_user%40example.com&mb_password=");
    expect(postedBody).not.toContain("&amp;");
  });

  test("login POST keeps caller-provided user agent", async () => {
    let postedUserAgent: string | undefined;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        postedUserAgent = request.headers["user-agent"];
        return response(302, "", {
          location: "/",
          "set-cookie": [
            "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=mockphp; Path=/",
          ],
        });
      }

      if (url.pathname === "/my_page/play_data.php") {
        return response(200, PLAY_DATA_HTML, {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport, userAgent: "custom-test-agent" });
    await client.login("fixture_user", "fixture_password");

    expect(postedUserAgent).toBe("custom-test-agent");
  });

  test("cache keys are version-scoped", () => {
    const phoenixClient = new PiuClient();
    const phoenix2Client = new PiuClient({ version: "phoenix2" });

    expect((phoenixClient as any).buildCacheKey("fixture_user", "player_data")).toBe(
      "phoenix:fixture_user:player_data",
    );
    expect((phoenix2Client as any).buildCacheKey("fixture_user", "player_data")).toBe(
      "phoenix2:fixture_user:player_data",
    );
  });

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

  test("hybrid SSO hydrates bootstrap cookies and completes login through transport", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    let loginCalls = 0;
    let secondLoginSawBootstrapCookie = false;
    const playwright = mockPlaywrightForSso([
      {
        ...(browserSessionCookie() as Record<string, unknown>),
        value: "bootstrap",
      },
    ]);

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;

        if (loginCalls === 1) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        secondLoginSawBootstrapCookie = request.headers.cookie?.includes("sid=bootstrap") ?? false;
        if (!secondLoginSawBootstrapCookie) {
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

    const client = new PiuClient({ transport });

    await client.login("fixture_user", "fixture_password");
    const data = await client.getPlayerData("fixture_user");

    expect(data.username).toBe("fixture_user");
    expect(loginCalls).toBe(2);
    expect(secondLoginSawBootstrapCookie).toBe(true);
    expect(playwright.gotoCalls()).toBe(1);
    expect(playwright.browserCloseCalls()).toBe(1);
  });

  test("SSO bootstrap uses HTTP redirect cookies before falling back to Playwright", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    let loginCalls = 0;
    let ssoBootstrapCalls = 0;
    let secondLoginSawBootstrapCookie = false;

    vi.doMock("playwright", () => ({
      chromium: {
        launch: async () => {
          throw new Error("Playwright should not launch for HTTP SSO bootstrap.");
        },
      },
    }));

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.hostname === "api.am-pass.net" && url.pathname === "/sso") {
        ssoBootstrapCalls += 1;
        return response(
          302,
          "",
          {
            location: "https://phoenix.piugame.com/ssoc",
          },
          request.url,
        );
      }

      if (url.pathname === "/ssoc") {
        return response(
          302,
          "",
          {
            location: "/",
            "set-cookie": [
              "sid=bootstrap; Path=/; Domain=.piugame.com; Max-Age=3600",
              "PHPSESSID=bootphp; Path=/; Domain=.piugame.com; Max-Age=3600",
            ],
          },
          request.url,
        );
      }

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;

        if (loginCalls === 1) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        const cookieHeader = request.headers.cookie ?? "";
        secondLoginSawBootstrapCookie =
          cookieHeader.includes("sid=bootstrap") &&
          cookieHeader.includes("PHPSESSID=bootphp");

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

    const client = new PiuClient({ transport });

    await client.login("fixture_user", "fixture_password");
    const data = await client.getPlayerData("fixture_user");

    expect(data.username).toBe("fixture_user");
    expect(loginCalls).toBe(2);
    expect(ssoBootstrapCalls).toBe(1);
    expect(secondLoginSawBootstrapCookie).toBe(true);
  });

  test("speculative SSO bootstrap skips the initial login POST", async () => {
    const requestOrder: string[] = [];
    let loginCalls = 0;
    let secondLoginSawBootstrapCookie = false;

    vi.doMock("playwright", () => ({
      chromium: {
        launch: async () => {
          throw new Error("Playwright should not launch for speculative HTTP SSO bootstrap.");
        },
      },
    }));

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);
      requestOrder.push(`${request.method} ${url.hostname}${url.pathname}`);

      if (url.hostname === "api.am-pass.net" && url.pathname === "/sso") {
        expect(url.searchParams.get("referer")).toBe(
          Buffer.from("https://phoenix.piugame.com/bbs/login_check.php").toString("base64"),
        );
        return response(
          302,
          "",
          {
            location: "https://phoenix.piugame.com/ssoc?sid=bootstrap",
          },
          request.url,
        );
      }

      if (url.pathname === "/ssoc") {
        return response(
          302,
          "",
          {
            location: "/",
            "set-cookie": [
              "sid=bootstrap; Path=/; Domain=.piugame.com; Max-Age=3600",
              "PHPSESSID=bootphp; Path=/; Domain=.piugame.com; Max-Age=3600",
            ],
          },
          request.url,
        );
      }

      if (url.pathname === "/bbs/login_check.php") {
        loginCalls += 1;
        const cookieHeader = request.headers.cookie ?? "";
        secondLoginSawBootstrapCookie =
          cookieHeader.includes("sid=bootstrap") &&
          cookieHeader.includes("PHPSESSID=bootphp");

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

        return response(200, PLAY_DATA_HTML);
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport, speculativeSsoBootstrap: true });

    await client.login("fixture_user", "fixture_password");
    const data = await client.getPlayerData("fixture_user");

    expect(data.username).toBe("fixture_user");
    expect(loginCalls).toBe(1);
    expect(secondLoginSawBootstrapCookie).toBe(true);
    expect(requestOrder.slice(0, 3)).toEqual([
      "GET api.am-pass.net/sso",
      "GET phoenix.piugame.com/ssoc",
      "POST phoenix.piugame.com/bbs/login_check.php",
    ]);
  });

  test("speculative SSO bootstrap falls back to normal login when bootstrap cookies do not arrive", async () => {
    const requestOrder: string[] = [];
    let loginCalls = 0;

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);
      requestOrder.push(`${request.method} ${url.hostname}${url.pathname}`);

      if (url.hostname === "api.am-pass.net" && url.pathname === "/sso") {
        return response(404, "missing bootstrap", {}, request.url);
      }

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
        return response(200, PLAY_DATA_HTML);
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport, speculativeSsoBootstrap: true });

    await client.login("fixture_user", "fixture_password");

    expect(loginCalls).toBe(1);
    expect(requestOrder.slice(0, 2)).toEqual([
      "GET api.am-pass.net/sso",
      "POST phoenix.piugame.com/bbs/login_check.php",
    ]);
  });

  test("speculative SSO bootstrap maps ambiguous credential response to AuthenticationError", async () => {
    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.hostname === "api.am-pass.net" && url.pathname === "/sso") {
        return response(
          302,
          "",
          {
            location: "https://phoenix.piugame.com/ssoc?sid=bootstrap",
          },
          request.url,
        );
      }

      if (url.pathname === "/ssoc") {
        return response(
          302,
          "",
          {
            location: "/",
            "set-cookie": [
              "sid=bootstrap; Path=/; Domain=.piugame.com; Max-Age=3600",
              "PHPSESSID=bootphp; Path=/; Domain=.piugame.com; Max-Age=3600",
            ],
          },
          request.url,
        );
      }

      if (url.pathname === "/bbs/login_check.php") {
        return response(200, "credentials rejected", {
          "set-cookie": [
            "sid=bootstrap; Path=/; Domain=.piugame.com; Max-Age=3600",
            "PHPSESSID=bootphp; Path=/",
          ],
        });
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport, speculativeSsoBootstrap: true });

    await expect(client.login("fixture_user", "bad_password")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  test("hybrid SSO maps bad second login credentials to AuthenticationError", async () => {
    mockPlaywrightForSso([browserSessionCookie()]);

    const transport: HttpTransport = async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/bbs/login_check.php") {
        return response(302, "", {
          location:
            request.headers.cookie?.includes("sid=mocksid")
              ? "/bbs/login.php?url=%2F"
              : "https://api.am-pass.net/sso?redirect=piu",
        });
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });

    await expect(client.login("fixture_user", "bad_password")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  test("hybrid SSO repeated redirect after second login returns SSORequiredError", async () => {
    mockPlaywrightForSso([browserSessionCookie()]);

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

    const client = new PiuClient({ transport });

    await expect(client.login("fixture_user", "fixture_password")).rejects.toBeInstanceOf(
      SSORequiredError,
    );
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

  test("SSO bootstrap readiness resolves from PIUGAME cookies on base host", async () => {
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
      waitForTimeout: async () => {
        pollCalls += 1;
        pageUrl = "https://www.piugame.com/bbs/login_check.php";
      },
    };

    const cookies = await client.waitForBootstrap(context, page);

    expect(cookies).toHaveLength(1);
    expect(cookieReads).toBe(2);
    expect(pollCalls).toBe(1);
  });

  test("SSO bootstrap readiness times out when PIUGAME cookies never arrive", async () => {
    const client = new SsoReadinessClient({ ssoTimeoutMs: 5 });
    const context = {
      cookies: async () => [],
    };
    const page = {
      url: () => "https://www.piugame.com/",
      waitForTimeout: async (timeoutMs: number) => {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, timeoutMs));
      },
    };

    await expect(client.waitForBootstrap(context, page)).rejects.toBeInstanceOf(
      SSOAutomationError,
    );
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

  test("getTitle always refreshes live user title state", async () => {
    let titleCalls = 0;

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
        return response(200, PLAY_DATA_HTML, {});
      }

      if (url.pathname === "/my_page/title.php") {
        titleCalls += 1;
        return response(200, titleHtml(titleCalls === 1 ? "CONRAD FOLLOWER" : "SUNNY FOLLOWER"), {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({
      transport,
      cacheTtl: { titleMs: 60 * 60 * 1000 },
    });
    await client.login("fixture_user", "fixture_password");

    const first = await client.getTitle("fixture_user");
    const second = await client.getTitle("fixture_user");

    expect(titleCalls).toBe(2);
    expect(first.find((title) => title.name === "CONRAD FOLLOWER")?.inUse).toBe(true);
    expect(second.find((title) => title.name === "SUNNY FOLLOWER")?.inUse).toBe(true);
  });

  test("getTitle upserts durable title catalog metadata when Mongo is connected", async () => {
    const upsertedCatalogs: unknown[][] = [];

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
        return response(200, PLAY_DATA_HTML, {});
      }

      if (url.pathname === "/my_page/title.php") {
        return response(200, titleHtml("CONRAD FOLLOWER"), {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });
    (client as any).mongoStorage = {
      getSession: async () => null,
      setSession: async () => undefined,
      upsertTitleCatalog: async (titles: unknown[]) => {
        upsertedCatalogs.push(titles);
      },
    };

    await client.login("fixture_user", "fixture_password");
    await client.getTitle("fixture_user");

    expect(upsertedCatalogs).toHaveLength(1);
    expect(upsertedCatalogs[0]).toMatchObject([
      { name: "CONRAD FOLLOWER", description: "Follower title" },
      { name: "SUNNY FOLLOWER", description: "[SUNNY STEP] 100+ Plays" },
      { name: "LOCKED TITLE", description: "Locked condition" },
      { name: "BEGINNER", description: null },
    ]);
  });

  test("setTitle posts the title token, refreshes titles, and clears profile cache", async () => {
    let titleSet = false;
    let postedBody: string | undefined;
    let postedContentType: string | undefined;
    let postedOrigin: string | undefined;
    let postedReferer: string | undefined;

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

        return response(
          200,
          playerDataHtmlWithTitle(titleSet ? "SUNNY FOLLOWER" : "CONRAD FOLLOWER"),
          {},
        );
      }

      if (url.pathname === "/my_page/pumbility.php") {
        return response(200, PUMBILITY_SCORE_HTML, {});
      }

      if (url.pathname === "/my_page/title.php") {
        if (!hasSessionCookie(request)) {
          return response(302, "", {
            location: "https://api.am-pass.net/sso?redirect=piu",
          });
        }

        return response(200, titleHtml(titleSet ? "SUNNY FOLLOWER" : "CONRAD FOLLOWER"), {});
      }

      if (url.pathname === "/logic/user_title_update.php") {
        postedBody = request.body;
        postedContentType = request.headers["content-type"];
        postedOrigin = request.headers.origin;
        postedReferer = request.headers.referer;
        titleSet = true;
        return response(200, "<script>alert('Title has been changed.')</script>", {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });
    await client.login("fixture_user", "fixture_password");

    const before = await client.getPlayerData("fixture_user");
    expect(before.titleName).toBe("CONRAD FOLLOWER");

    const result = await client.setTitle("fixture_user", "sunny follower");

    expect(postedBody).toBe("no=L2JXVVZ0NDYwSm1CbFZiemNad2lBUT09");
    expect(postedContentType).toBe("application/x-www-form-urlencoded");
    expect(postedOrigin).toBe("https://phoenix.piugame.com");
    expect(postedReferer).toBe("https://phoenix.piugame.com/my_page/title.php");
    expect(result.success).toBe(true);
    expect(result.titleName).toBe("SUNNY FOLLOWER");
    expect(result.titles.find((title) => title.name === "SUNNY FOLLOWER")?.inUse).toBe(true);

    const after = await client.getPlayerData("fixture_user");
    expect(after.titleName).toBe("SUNNY FOLLOWER");
  });

  test("setTitle posts Phoenix 2 origin and referer when version targets Phoenix 2", async () => {
    let titleSet = false;
    let postedOrigin: string | undefined;
    let postedReferer: string | undefined;

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
        return response(200, PLAY_DATA_HTML, {});
      }

      if (url.pathname === "/my_page/title.php") {
        return response(200, titleHtml(titleSet ? "SUNNY FOLLOWER" : "CONRAD FOLLOWER"), {});
      }

      if (url.pathname === "/logic/user_title_update.php") {
        postedOrigin = request.headers.origin;
        postedReferer = request.headers.referer;
        titleSet = true;
        return response(200, "<script>alert('Title has been changed.')</script>", {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ version: "phoenix2", transport });
    await client.login("fixture_user", "fixture_password");

    const result = await client.setTitle("fixture_user", "sunny follower");

    expect(postedOrigin).toBe("https://www.piugame.com");
    expect(postedReferer).toBe("https://www.piugame.com/my_page/title.php");
    expect(result.success).toBe(true);
  });

  test("setTitle rejects unavailable titles before posting", async () => {
    let postCalls = 0;

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
        return response(200, PLAY_DATA_HTML, {});
      }

      if (url.pathname === "/my_page/title.php") {
        return response(200, titleHtml("CONRAD FOLLOWER"), {});
      }

      if (url.pathname === "/logic/user_title_update.php") {
        postCalls += 1;
        return response(200, "unexpected", {});
      }

      return response(404, "not found");
    };

    const client = new PiuClient({ transport });
    await client.login("fixture_user", "fixture_password");

    await expect(client.setTitle("fixture_user", "LOCKED TITLE")).rejects.toBeInstanceOf(
      TitleUpdateError,
    );
    await expect(client.setTitle("fixture_user", "CONRAD FOLLOWER")).rejects.toBeInstanceOf(
      TitleUpdateError,
    );
    await expect(client.setTitle("fixture_user", "MISSING TITLE")).rejects.toBeInstanceOf(
      TitleUpdateError,
    );
    expect(postCalls).toBe(0);
  });
});
