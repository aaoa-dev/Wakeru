import assert from "node:assert/strict";
import {binsOn, dayState} from "../js/schedule.js";

const date = value => new Date(`${value}T00:00`);
const calendar = {
  validFrom:"2026-01-01", validTo:"2026-12-31",
  noCollection:{weekdays:[0], dates:["12-29"], bins:{paper:["12-30"]}},
};

assert.deepEqual(binsOn(calendar, {burnable:[2]}, date("2026-12-29")), [], "recurring rules stay closed on global holidays");
assert.deepEqual(binsOn(calendar, {burnable:{dates:["2026-12-29"]}}, date("2026-12-29")), ["burnable"], "official dates override broad holiday closures");
assert.deepEqual(binsOn(calendar, {burnable:{add:["2026-12-29"], days:[1]}}, date("2026-12-29")), ["burnable"], "explicit additions override broad holiday closures");
assert.deepEqual(binsOn(calendar, {paper:{dates:["2026-12-30"]}}, date("2026-12-30")), [], "bin-specific closures remain authoritative");
assert.equal(dayState(calendar, date("2027-01-01")), "unpublished");

console.log("ok: schedule precedence");
