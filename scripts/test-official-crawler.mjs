import assert from "node:assert/strict";
import {parseLinks, parseRobots, robotsAllows, scoreCandidate} from "./import/discover-official.mjs";
import {weeklyRule} from "./import/sources/district-weekly-csv.mjs";

const links = parseLinks('<a href="/gomi/calendar.pdf">令和8年度 ごみ収集カレンダー</a>', "https://www.city.example.jp/life/");
assert.deepEqual(links, [{url:"https://www.city.example.jp/gomi/calendar.pdf", text:"令和8年度 ごみ収集カレンダー"}]);

const schedule = scoreCandidate(`${links[0].text} ${links[0].url}`);
assert(schedule.score >= 8);
assert(schedule.reasons.includes("calendar"));

const robots = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
assert.equal(robotsAllows(robots, "https://example.jp/private/a"), false);
assert.equal(robotsAllows(robots, "https://example.jp/private/public/a"), true);
assert.equal(robotsAllows(robots, "https://example.jp/gomi"), true);

assert.deepEqual(
  weeklyRule("第二・四火曜日", "2026-04-01", "2027-03-31"),
  {day:2, weeks:[2, 4]},
  "kanji ordinals remain twice-monthly rules",
);

console.log("ok: official crawler discovery helpers");
