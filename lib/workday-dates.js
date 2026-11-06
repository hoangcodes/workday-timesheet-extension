// Pure date helpers shared by the Workday content script and Node tests.
(function (root) {
  'use strict';

  var MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  function validDate(year, month, day) {
    var date = new Date(year, month, day);
    if (isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return date;
  }

  function dateKey(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function sundayToSaturday(base) {
    if (!(base instanceof Date) || isNaN(base.getTime())) return null;
    var sunday = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    sunday.setDate(sunday.getDate() - sunday.getDay());
    var dates = [];
    for (var i = 0; i < 7; i++) {
      var day = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
      dates.push(day);
    }
    return { from: dates[0], to: dates[6], dates: dates, dateKeys: dates.map(dateKey) };
  }

  function parseSheetNameDate(sheetName) {
    var text = String(sheetName || '');
    var match = text.match(/(^|[^0-9])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[^0-9]|$)/);
    if (!match) return null;
    return validDate(parseInt(match[4], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
  }

  function parseMonthDay(text, year) {
    var match = String(text || '').match(/(?:^|[^0-9])(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?:[^0-9]|$)/);
    if (!match) return null;
    var parsedYear = match[3] ? parseInt(match[3], 10) : year;
    if (parsedYear < 100) parsedYear += 2000;
    return validDate(parsedYear, parseInt(match[1], 10) - 1, parseInt(match[2], 10));
  }

  function yearFromText(text, fallback) {
    var match = String(text || '').match(/\b(20\d{2})\b/);
    return match ? parseInt(match[1], 10) : fallback;
  }

  // Workday day labels omit the year. The header supplies it; when the week crosses
  // New Year, the monotonicity check rolls the final dates into the next year.
  function weekFromLabels(labels, yearHint) {
    if (!Array.isArray(labels) || labels.length < 7) return null;
    var year = yearHint || new Date().getFullYear();
    var dates = labels.slice(0, 7).map(function (label) { return parseMonthDay(label, year); });
    if (dates.some(function (date) { return !date; })) return null;
    for (var i = 1; i < dates.length; i++) {
      if (dates[i].getTime() < dates[i - 1].getTime()) {
        dates[i].setFullYear(dates[i - 1].getFullYear() + 1);
      }
    }
    return { from: dates[0], to: dates[6], dates: dates, dateKeys: dates.map(dateKey) };
  }

  // New Enter Time layout: cell labels are "Nov 1", "2", "3", ... (only the first cell and the
  // 1st of a month carry a month name) and the header range ("Nov 1 – 7, 2026") supplies the
  // year. A day number lower than the previous one rolls into the next month (and year).
  function weekFromDayLabels(labels, yearHint) {
    if (!Array.isArray(labels) || labels.length < 7) return null;
    var year = yearHint || new Date().getFullYear();
    var month = null, previousDay = 0, dates = [];
    for (var i = 0; i < 7; i++) {
      var match = String(labels[i] == null ? '' : labels[i]).match(/^\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})\s*$/);
      if (!match) return null;
      var day = parseInt(match[2], 10);
      if (match[1]) {
        var named = MONTHS[match[1].slice(0, 3).toLowerCase()];
        if (named === undefined) return null;
        if (month !== null && named < month) year++;
        month = named;
      } else {
        if (month === null) return null;
        if (day < previousDay) { month++; if (month > 11) { month = 0; year++; } }
      }
      var date = validDate(year, month, day);
      if (!date) return null;
      dates.push(date);
      previousDay = day;
    }
    return { from: dates[0], to: dates[6], dates: dates, dateKeys: dates.map(dateKey) };
  }

  function sameWeek(a, b) {
    return !!(a && b && dateKey(a.from) === dateKey(b.from) && dateKey(a.to) === dateKey(b.to));
  }

  // Map imported entries to the exact dates rendered by the current Workday week.
  // This is intentionally date-based instead of weekday-based: a dual-month week is
  // safe because only dates actually present on the open Workday page are eligible.
  function filterEntriesToWeek(entries, pageWeek, sheetName) {
    var sourceDate = parseSheetNameDate(sheetName);
    var sourceWeek = sourceDate ? sundayToSaturday(sourceDate) : null;
    var visible = new Set((pageWeek && pageWeek.dateKeys) || []);
    var excluded = [];
    var mapped = (entries || []).map(function (entry) {
      var sourceDates = sourceWeek && sourceWeek.dates;
      var date = sourceDates ? sourceDates[entry.dow] : (pageWeek && pageWeek.dates ? pageWeek.dates[entry.dow] : null);
      var mappedEntry = Object.assign({}, entry, { date: date || null, dateKey: dateKey(date) });
      if (visible.size && !visible.has(mappedEntry.dateKey)) excluded.push(mappedEntry);
      return mappedEntry;
    });
    var eligible = visible.size ? mapped.filter(function (entry) { return visible.has(entry.dateKey); }) : mapped;
    return {
      entries: eligible,
      excluded: excluded,
      sourceWeek: sourceWeek,
      pageWeek: pageWeek,
      sourceMatchesPage: !sourceWeek || !pageWeek || sameWeek(sourceWeek, pageWeek),
    };
  }

  var api = {
    dateKey: dateKey,
    sundayToSaturday: sundayToSaturday,
    parseSheetNameDate: parseSheetNameDate,
    parseMonthDay: parseMonthDay,
    weekFromLabels: weekFromLabels,
    weekFromDayLabels: weekFromDayLabels,
    filterEntriesToWeek: filterEntriesToWeek,
    sameWeek: sameWeek,
    yearFromText: yearFromText,
  };

  root.WTE_DATES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
