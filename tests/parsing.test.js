'use strict';

const assert = require('assert');
const dates = require('../lib/workday-dates');

function assertDateKey(date, expected, message) {
  assert.strictEqual(dates.dateKey(date), expected, message);
}

// Workday's live labels are month/day strings without a year.
const normalWeek = dates.weekFromLabels(
  ['Sun, 11/1', 'Mon, 11/2', 'Tue, 11/3', 'Wed, 11/4', 'Thu, 11/5', 'Fri, 11/6', 'Sat, 11/7'],
  2026,
);
assert(normalWeek, 'normal Workday week should parse');
assertDateKey(normalWeek.from, '2026-11-01', 'normal week start');
assertDateKey(normalWeek.to, '2026-11-07', 'normal week end');

const newYearWeek = dates.weekFromLabels(
  ['Sun, 12/27', 'Mon, 12/28', 'Tue, 12/29', 'Wed, 12/30', 'Thu, 12/31', 'Fri, 1/1', 'Sat, 1/2'],
  2026,
);
assert(newYearWeek, 'New Year week should parse');
assertDateKey(newYearWeek.dates[4], '2026-12-31', 'New Year week December date');
assertDateKey(newYearWeek.dates[5], '2027-01-01', 'New Year week rollover');

// New Enter Time layout labels ("Nov 1", "2", ...).
const newLayoutWeek = dates.weekFromDayLabels(['Nov 1', '2', '3', '4', '5', '6', '7'], 2026);
assert(newLayoutWeek, 'new-layout week should parse');
assertDateKey(newLayoutWeek.from, '2026-11-01', 'new layout week start');
assertDateKey(newLayoutWeek.to, '2026-11-07', 'new layout week end');
const newLayoutCrossMonth = dates.weekFromDayLabels(['Oct 26', '27', '28', '29', '30', '31', 'Nov 1'], 2026);
assertDateKey(newLayoutCrossMonth.dates[5], '2026-10-31', 'new layout cross-month October date');
assertDateKey(newLayoutCrossMonth.dates[6], '2026-11-01', 'new layout cross-month November date');
const newLayoutCrossMonthBare = dates.weekFromDayLabels(['Oct 26', '27', '28', '29', '30', '31', '1'], 2026);
assertDateKey(newLayoutCrossMonthBare.dates[6], '2026-11-01', 'bare day number rolls into the next month');
const newLayoutNewYear = dates.weekFromDayLabels(['Dec 27', '28', '29', '30', '31', 'Jan 1', '2'], 2026);
assertDateKey(newLayoutNewYear.dates[5], '2027-01-01', 'new layout New Year rollover');
assert.strictEqual(dates.weekFromDayLabels(['2', '3', '4', '5', '6', '7', '8'], 2026), null, 'first label must carry a month');
assert.strictEqual(dates.weekFromDayLabels(['Nov 1', 'x', '3', '4', '5', '6', '7'], 2026), null, 'garbage label rejected');

const crossMonthWeek = dates.sundayToSaturday(new Date(2026, 5, 30));
assertDateKey(crossMonthWeek.from, '2026-06-28', 'June/July week start');
assertDateKey(crossMonthWeek.to, '2026-07-04', 'June/July week end');

const crossMonthEntries = [
  { dow: 0, hours: 2, groupKey: 'cross-month' },
  { dow: 6, hours: 4, groupKey: 'cross-month' },
];
const crossMonthFiltered = dates.filterEntriesToWeek(crossMonthEntries, crossMonthWeek, '6.28.2026');
assert.strictEqual(crossMonthFiltered.entries.length, 2, 'both visible dates in a dual-month week remain eligible');
assertDateKey(crossMonthFiltered.entries[0].date, '2026-06-28', 'dual-month Sunday maps to June');
assertDateKey(crossMonthFiltered.entries[1].date, '2026-07-04', 'dual-month Saturday maps to July');

const crossMonthMismatch = dates.filterEntriesToWeek(crossMonthEntries, crossMonthWeek, '6.21.2026');
assert.strictEqual(crossMonthMismatch.entries.length, 0, 'a different dual-month workbook week is fully excluded');
assert.strictEqual(crossMonthMismatch.excluded.length, 2, 'excluded dual-month entries are auditable');

const entries = [
  { dow: 0, hours: 2, groupKey: 'a' },
  { dow: 1, hours: 3, groupKey: 'a' },
  { dow: 6, hours: 4, groupKey: 'a' },
];
const filtered = dates.filterEntriesToWeek(entries, normalWeek, '11-1-2026');
assert.strictEqual(filtered.entries.length, 3, 'matching workbook week remains eligible');
assert.strictEqual(filtered.excluded.length, 0, 'matching workbook week has no excluded entries');
assert(filtered.sourceMatchesPage, 'matching workbook week is recognized');

const mismatched = dates.filterEntriesToWeek(entries, normalWeek, '10-25-2026');
assert.strictEqual(mismatched.entries.length, 0, 'different workbook week cannot fill visible week');
assert.strictEqual(mismatched.excluded.length, 3, 'different workbook week is fully excluded');
assert(!mismatched.sourceMatchesPage, 'different workbook week is detected');

console.log('Workday date tests passed');
