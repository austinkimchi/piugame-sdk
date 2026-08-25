import { describe, test, expect } from "vitest";

import {
  extractLastPageNumber,
  parseBestScorePage,
  parseOwnedTitleCount,
  parsePumbilityScore,
  parsePlayerData,
  parseRecentPlays,
  parseTopPlays,
  parseTitleEntries,
} from "../src/parsers";

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
      <div class="re" style="background-image:url('https://www.piugame.com/data/avatar_img/abc.png')"></div>
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
      <li><a data-type="ug"></a><span class="t_num">1</span></li>
      <li><a data-type="sg"></a><span class="t_num">1</span></li>
      <li><a data-type="mg"></a><span class="t_num">39</span></li>
      <li><a data-type="tg"></a><span class="t_num">44</span></li>
      <li><a data-type="fg"></a><span class="t_num">40</span></li>
    </ul>
  </div>
</div>
`;

const RECENT_PLAYED_HTML = `
<ul class="recently_playeList">
  <li>
    <div class="wrap_in"><div class="in" style="background-image:url('https://www.piugame.com/data/song_img/a.png')"></div></div>
    <div class="song_name"><p>Clematis Rapsodia</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw">
        <img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" />
        <img src="https://www.piugame.com/l_img/stepball/full/s_num_5.png" />
      </div>
    </div>
    <div class="con2"><ul class="list"><li></li><li><div class="tx">STAGE BREAK</div></li><li></li></ul></div>
    <table class="recently_play">
      <tr>
        <td data-th="Perfect"><span class="tx">555</span></td>
        <td data-th="Great"><span class="tx">60</span></td>
        <td data-th="Good"><span class="tx">28</span></td>
        <td data-th="Bad"><span class="tx">16</span></td>
        <td data-th="Miss"><span class="tx">28</span></td>
      </tr>
    </table>
    <div class="recently_date_tt">2026-04-11 12:45:50 (GMT+9)</div>
  </li>
  <li>
    <div class="wrap_in"><div class="in" style="background-image:url('https://www.piugame.com/data/song_img/b.png')"></div></div>
    <div class="song_name"><p>BATTLE NO.1</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw">
        <img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" />
        <img src="https://www.piugame.com/l_img/stepball/full/s_num_4.png" />
      </div>
    </div>
    <div class="con2">
      <ul class="list">
        <li></li>
        <li>
          <div class="tx">927,332</div>
          <img src="https://www.piugame.com/l_img/grade/aa_p.png" />
        </li>
        <li><img src="https://www.piugame.com/l_img/plate/fg.png" /></li>
      </ul>
    </div>
    <table class="recently_play"><tr><td data-th="Perfect"><span class="tx">1</span></td></tr></table>
    <div class="recently_date_tt">2026-04-11 12:30:00 (GMT+9)</div>
  </li>
</ul>
`;

const PUMBILITY_SCORE_HTML = `
<div class="pumbility_total_wrap">
  <div class="inn">
    <div class="t1">Pumbility</div>
    <div class="t2">9,352</div>
  </div>
</div>
`;

const TOP_PLAYS_HTML = `
<div class="rating_rangking_list_w pumblitiySt">
  <ul class="list">
    ${Array.from({ length: 50 }, (_, i) => {
      const rank = i + 1;
      const song = rank === 1 ? "Spray" : rank === 50 ? "Cleaner" : `Song ${rank}`;
      const score = rank === 1 ? 300 : rank === 50 ? 160 : 200 - rank;
      return `
      <li>
        <div class="num"><div class="img_wrap"><div class="num"><span class="tt">${rank}</span></div></div></div>
        <div class="profile_name"><span class="t1">${song}</span><span class="t2">WEi</span></div>
        <div class="profile_img"><div class="re" style="background-image:url('https://www.piugame.com/data/song_img/${rank}.png')"></div></div>
        <div class="stepBall_in">
          <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
          <div class="numw"><img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" /><img src="https://www.piugame.com/l_img/stepball/full/s_num_5.png" /></div>
        </div>
        <div class="grade_wrap"><img src="https://www.piugame.com/l_img/grade/s.png" /></div>
        <div class="score"><span class="tt">${score}</span></div>
        <div class="date"><span class="tt">2026-04-13 13:24:55 (GMT+9)</span></div>
      </li>`;
    }).join("")}
  </ul>
</div>
`;

const TITLE_HTML = `
<div class="board_search"><div class="total_wrap"><span class="t2">8</span></div></div>
<ul class="data_titleList2">
  <li class="have" data-name="CONRAD FOLLOWER">
    <div class="txt_w"><div class="txt">CONRAD FOLLOWER</div></div>
    <div class="txt_w2"><div class="txt">Follower title</div></div>
    <div class="state_w"><div class="stateBox"><div class="tt">Title in use</div></div></div>
  </li>
  <li class="have" data-name="GOLD MEMBER">
    <div class="txt_w"><div class="txt">GOLD MEMBER</div></div>
    <form action="https://www.piugame.com/logic/user_title_update.php" method="post">
      <input type="hidden" name="no" value="M3RkK2M0Wm1Ncms0UXljOFl3alNBdz09" />
    </form>
    <div class="state_w"><div class="stateBox"><div class="tt">Set</div></div></div>
  </li>
  <li class="locked" data-name="DOMINION CHALLENGER">
    <div class="txt_w"><div class="txt">DOMINION CHALLENGER</div></div>
    <div class="state_w"><div class="stateBox"><div class="tt">Not achieving the unlock condition</div></div></div>
  </li>
  <li class="have" data-name="BEGINNER">
    <div class="txt_w"><div class="txt">BEGINNER</div></div>
    <form action="https://www.piugame.com/logic/user_title_update.php" method="post">
      <input type="hidden" name="no" value="cU1zQktpTE84SWZPSTNIbkpKSytNUT09" />
    </form>
    <div class="state_w"><div class="stateBox"><div class="tt">Set</div></div></div>
  </li>
</ul>
`;

const BEST_SCORE_HTML = `
<div class="board_search"><div class="total_wrap"><span class="t2">269</span></div></div>
<ul class="my_best_scoreList">
  <li>
    <div class="song_name"><p>BATTLE NO.1</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw"><img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" /><img src="https://www.piugame.com/l_img/stepball/full/s_num_4.png" /></div>
    </div>
    <div class="etc_con">
      <ul class="list">
        <li><div class="txt_v"><span class="num">927,332</span></div></li>
        <li><img src="https://www.piugame.com/l_img/grade/aa_p.png" /></li>
        <li><img src="https://www.piugame.com/l_img/plate/fg.png" /></li>
      </ul>
    </div>
  </li>
</ul>
<div class="board_paging">
  <button type="button" onclick="location.href='?&&amp;page=1'" class="on">1</button>
  <button type="button" onclick="location.href='?&&amp;page=23'" class="icon"><i class="xi last"></i></button>
</div>
`;

describe("parsers", () => {
  test("parsePlayerData extracts profile and summary values", () => {
    const data = parsePlayerData(PLAY_DATA_HTML, "fixture_user");

    expect(data.username).toBe("fixture_user");
    expect(data.titleName).toBe("CONRAD FOLLOWER");
    expect(data.gameIdTag).toBe("PKIMCHI#7501");
    expect(data.gameId).toBe("PKIMCHI");
    expect(data.gameTag).toBe("#7501");
    expect(data.avatarUrl).toContain("/data/avatar_img/");
    expect(data.pp).toBe(1034);
    expect(data.lastAccess).toBe("2026-04-11 12:37:31");
    expect(data.recentArcade).toBe("ROUND1 SLM 2");
    expect(data.playCount).toBe(215);
    expect(data.rating).toBe(18318);
    expect(data.clear.cleared).toBe(125);
    expect(data.clear.total).toBe(3646);
    expect(data.progressPercent).toBe(3);
    expect(data.plateCounts.ug).toBe(1);
    expect(data.plateCounts.sg).toBe(1);
    expect(data.plateCounts.mg).toBe(39);
    expect(data.plateCounts.tg).toBe(44);
    expect(data.plateCounts.fg).toBe(40);
  });

  test("parseRecentPlays extracts plays including stage break and judgments", () => {
    const plays = parseRecentPlays(RECENT_PLAYED_HTML);

    expect(plays.length).toBeGreaterThan(0);

    const first = plays[0];
    expect(first.songName).toBe("Clematis Rapsodia");
    expect(first.mode).toBe("S");
    expect(first.level).toBe("15");
    expect(first.stageBreak).toBe(true);
    expect(first.score).toBeNull();
    expect(first.judgments.perfect).toBe(555);
    expect(first.judgments.great).toBe(60);
    expect(first.judgments.good).toBe(28);
    expect(first.judgments.bad).toBe(16);
    expect(first.judgments.miss).toBe(28);
    expect(first.playedAt).toBe("2026-04-11 12:45:50 (GMT+9)");

    const second = plays[1];
    expect(second.songName).toBe("BATTLE NO.1");
    expect(second.stageBreak).toBe(false);
    expect(second.score).toBe(927332);
    expect(second.grade).toBe("aa_p");
    expect(second.plate).toBe("fg");
  });

  test("parsePlayerData normalizes spaces around # in gameIdTag", () => {
    const html = PLAY_DATA_HTML.replace("PKIMCHI#7501", "PKIMCHI   #   7501");
    const data = parsePlayerData(html, "fixture_user");

    expect(data.gameIdTag).toBe("PKIMCHI#7501");
    expect(data.gameId).toBe("PKIMCHI");
    expect(data.gameTag).toBe("#7501");
  });

  test("parsePumbilityScore extracts total score", () => {
    const score = parsePumbilityScore(PUMBILITY_SCORE_HTML);
    expect(score).toBe(9352);
  });

  test("parseTopPlays extracts pumbility-contributing entries", () => {
    const plays = parseTopPlays(TOP_PLAYS_HTML);

    expect(plays).toHaveLength(50);

    const first = plays[0];
    expect(first.rank).toBe(1);
    expect(first.songName).toBe("Spray");
    expect(first.artist).toBe("WEi");
    expect(first.mode).toBe("S");
    expect(first.level).toBe("15");
    expect(first.grade).toBe("s");
    expect(first.score).toBe(300);
    expect(first.playedAt).toBe("2026-04-13 13:24:55 (GMT+9)");

    const last = plays[49];
    expect(last.rank).toBe(50);
    expect(last.songName).toBe("Cleaner");
    expect(last.score).toBe(160);
  });

  test("parseTitleEntries extracts title state and metadata", () => {
    const ownedCount = parseOwnedTitleCount(TITLE_HTML);
    const titles = parseTitleEntries(TITLE_HTML);

    expect(ownedCount).toBe(8);
    expect(titles.length).toBe(4);

    const inUse = titles.find((title) => title.name === "CONRAD FOLLOWER");
    expect(inUse).toBeTruthy();
    expect(inUse?.owned).toBe(true);
    expect(inUse?.inUse).toBe(true);
    expect(inUse?.setToken).toBeNull();
    expect(inUse?.statusText).toBe("Title in use");

    const settable = titles.find((title) => title.name === "GOLD MEMBER");
    expect(settable).toBeTruthy();
    expect(settable?.owned).toBe(true);
    expect(settable?.settable).toBe(true);
    expect(settable?.setToken).toBe("M3RkK2M0Wm1Ncms0UXljOFl3alNBdz09");
    expect(settable?.statusText).toBe("Set");

    const locked = titles.find((title) => title.name === "DOMINION CHALLENGER");
    expect(locked).toBeTruthy();
    expect(locked?.owned).toBe(false);
    expect(locked?.locked).toBe(true);
    expect(locked?.setToken).toBeNull();

    const beginner = titles.find((title) => title.name === "BEGINNER");
    expect(beginner).toBeTruthy();
    expect(beginner?.description).toBeNull();
  });

  test("parseBestScorePage extracts score items and pagination", () => {
    const page = parseBestScorePage(BEST_SCORE_HTML, 1);

    expect(page.page).toBe(1);
    expect(page.total).toBe(269);
    expect(page.lastPage).toBe(23);
    expect(page.plays.length).toBeGreaterThan(0);

    const first = page.plays[0];
    expect(first.songName).toBe("BATTLE NO.1");
    expect(first.mode).toBe("S");
    expect(first.level).toBe("14");
    expect(first.score).toBe(927332);
    expect(first.grade).toBe("aa_p");
    expect(first.plate).toBe("fg");

    expect(extractLastPageNumber(BEST_SCORE_HTML)).toBe(23);
  });

  test("keeps sparse rows isolated and tolerates missing step-ball markup", () => {
    const sparseRecentHtml = `
      <ul class="recently_playeList">
        <li>
          <div class="song_name"><p>First Song</p></div>
          <div class="con2"><ul class="list"><li></li><li><div class="tx">123,456</div></li><li></li></ul></div>
          <table class="recently_play"><tr><td data-th="Perfect"><span class="tx">10</span></td></tr></table>
        </li>
        <li>
          <div class="song_name"><p>Second Song</p></div>
          <div class="stepBall_in">
            <div class="tw"><img src="/l_img/stepball/full/d_text.png"></div>
            <div class="numw"><img src="/l_img/stepball/full/d_num_0.png"><img src="/l_img/stepball/full/d_guess.png"></div>
          </div>
          <div class="con2"><ul class="list"><li></li><li><div class="tx">STAGE BREAK</div></li><li></li></ul></div>
          <table class="recently_play"><tr><td data-th="Miss"><span class="tx">7</span></td></tr></table>
        </li>
      </ul>`;

    const plays = parseRecentPlays(sparseRecentHtml);

    expect(plays).toEqual([
      expect.objectContaining({
        songName: "First Song", mode: null, level: null, score: 123456, stageBreak: false,
        judgments: { perfect: 10, great: null, good: null, bad: null, miss: null },
      }),
      expect.objectContaining({
        songName: "Second Song", mode: "D", level: "0?", score: null, stageBreak: true,
        judgments: { perfect: null, great: null, good: null, bad: null, miss: 7 },
      }),
    ]);
  });

  test("uses the numeric pagination fallback when no last-page button exists", () => {
    const html = `<div class="board_paging"><button>1</button><button>  7 </button><button>not a page</button></div>`;
    expect(extractLastPageNumber(html)).toBe(7);
  });
});
