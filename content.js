// content.js -- Workday Time Entry Importer
// The UI is intentionally kept compatible with the proven OpenAir extension. Only the
// site adapter is different: Workday is a calendar and nested picker, not a row grid.
(function () {
  'use strict';

  var MATCH_MIN = 0.72;
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_PATTERNS = [/^sun/i, /^mon/i, /^tue/i, /^wed/i, /^thu/i, /^fri/i, /^sat/i];
  var _themeMode = 'light';
  var _themeColor = 'slate';
  var _autoDefault = true;
  var _fillTimeNotesOnly = false;
  var _cancelWorkdayImport = false;
  var panelStatus = null;
  var tooltipEl = null;
  var tooltipTimer = null;
  // The script is injected on every https://wd12.myworkday.com/connorgp/* route (the Enter Time
  // calendar is reached through several: This Week task/2997$4767, Last Week task/2997$4775,
  // Select Week gateway.htmld; measured live 2026-11-02). The UI itself appears only when the
  // Enter Time calendar is actually rendered (see isWorkdayTimesheetPage).
  var WORKDAY_ORIGIN = 'https://wd12.myworkday.com';
  var WORKDAY_PATH_PREFIX = '/connorgp/';
  var WORKDAY_FALLBACK_PATH ='Unassigned > Unassigned Time > Unassigned';
  // Measured against the live Workday page on 2026-11-02: opening the root picker took
  // ~850 ms and expanding a submenu took ~460 ms. Polling keeps the adapter tolerant of
  // slower sessions while the settle delay prevents clicks from racing Workday's GWT UI.
  var WORKDAY_TIMINGS = { pollMs: 100, menuTimeoutMs: 5000, saveTimeoutMs: 5000, entryAutoOpenWaitMs: 2000, entryOpenTimeoutMs: 5000, entryOpenAttempts: 2, dateConfirmGraceMs: 600, formStableMs: 1000, formStableTimeoutMs: 6000, fieldVerifyMs: 700, fieldFillAttempts: 3, timeTypeClickSettleMs: 800, searchSettleMs: 700, searchTimeoutMs: 4000, submenuSettleMs: 800, selectionSettleMs: 600 };

  var THEME_ACCENTS = {
    slate: { hex: '#44536B', dark: '#303d50' },
    nam:   { hex: '#1B3D82', dark: '#143061' },
    becky: { hex: '#550000', dark: '#3D0000' },
    jenna: { hex: '#6C3BAA', dark: '#572E89' },
    omkar: { hex: '#DAA520', dark: '#B8860B' },
    alec:  { hex: '#40826D', dark: '#336654' },
  };

  function readableOn(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16) / 255;
    var g = parseInt(h.substr(2, 2), 16) / 255;
    var b = parseInt(h.substr(4, 2), 16) / 255;
    function lin(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.38 ? '#1f2937' : '#ffffff';
  }

  function applyContentTheme(color, mode) {
    _themeColor = color || 'slate';
    _themeMode = mode || 'light';
    var accent = THEME_ACCENTS[_themeColor] || THEME_ACCENTS.slate;
    var el = document.getElementById('oai-theme-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'oai-theme-style';
      document.head.appendChild(el);
    }
    var onAccent = readableOn(accent.hex);
    // Hint text sits on a faint accent tint over the modal background: use the dark accent in
    // light mode (a near-black for light accents such as Omkar Gold) and the normal text colour
    // in the dark modes, where a dark accent would be invisible.
    var hintColor = _themeMode === 'dark' ? '#eaf4ff' : _themeMode === 'classic-dark' ? '#f4f0ff' :
      (onAccent === '#ffffff' ? accent.dark : '#1f2937');
    var css = ':root{--oai-accent:' + accent.hex + ';--oai-accent-dark:' + accent.dark + ';--oai-on-accent:' + onAccent + ';}';
    css += '.oai-btn--primary{background:' + accent.hex + '!important;border-color:' + accent.hex + '!important}' +
      '.oai-btn--primary:hover{background:' + accent.dark + '!important;border-color:' + accent.dark + '!important}' +
      '.oai-conf-step-hint{border-color:' + accent.hex + '!important;color:' + hintColor + '!important;background:' + accent.hex + '1a!important}';
    if (_themeMode !== 'light') {
      var dark = _themeMode === 'dark';
      var bg = dark ? '#0f172a' : '#1a1a24';
      var surface = dark ? '#1e293b' : '#252530';
      var border = dark ? '#334155' : '#3a3a4a';
      var text = dark ? '#eaf4ff' : '#f4f0ff';
      var muted = dark ? '#c9dcef' : '#d4cce6';
      // The copied panel has hard-coded light-mode child colors. Keep the nested
      // selectors explicit because Workday's page CSS can otherwise win through
      // inheritance/specificity and make the dropzone unreadable.
      css += '#oai-panel{background:' + surface + '!important;border-color:' + border + '!important;color:' + text + '!important}' +
        '#oai-panel .oai-header{color:' + onAccent + '!important}' +
        '#oai-panel .oai-title{color:' + onAccent + '!important}' +
        '#oai-panel .oai-body{background:' + surface + '!important}' +
        '#oai-panel .oai-dropzone{background:' + bg + '!important;border-color:' + border + '!important;color:' + text + '!important}' +
        '#oai-panel .oai-dropzone:hover,#oai-panel .oai-dropzone:focus,#oai-panel .oai-dropzone.oai-dz--active{background:' + surface + '!important;border-color:' + accent.hex + '!important}' +
        '#oai-panel .oai-dropzone-icon{color:' + muted + '!important}' +
        '#oai-panel .oai-dropzone-text,#oai-panel .oai-dropzone-text strong{color:' + text + '!important}' +
        '#oai-panel .oai-dz-sub,#oai-panel .oai-dz-sub--cols{color:' + muted + '!important}' +
        '#oai-panel .oai-btn--download{background:transparent!important;border-color:' + border + '!important;color:' + text + '!important}' +
        '#oai-panel .oai-btn--download:hover{background:' + bg + '!important;color:' + text + '!important}' +
        '#oai-panel .oai-status{color:' + muted + '!important}' +
        '#oai-panel .oai-status--success{color:#86efac!important}' +
        '#oai-panel .oai-status--error{color:#fca5a5!important}' +
        '#oai-panel .oai-status--warning{color:#fcd34d!important}' +
        '#oai-panel .oai-status--info{color:' + text + '!important}' +
        '.oai-modal-overlay .oai-modal{background:' + surface + '!important;border-color:' + border + '!important}' +
        '.oai-conf-header,.oai-modal-header,.oai-modal-footer,.oai-conf-actions{background:' + bg + '!important;border-color:' + border + '!important}' +
        '.oai-conf-title,.oai-modal-title,.oai-completion-msg{color:' + text + '!important}' +
        '.oai-info-icon{color:' + muted + '!important}' +
        '.oai-info-icon:hover{color:' + text + '!important}' +
        '.oai-sort-btn,.oai-modal-x{color:' + muted + '!important}' +
        '.oai-sort-btn:hover,.oai-modal-x:hover{background:' + surface + '!important;color:' + text + '!important}' +
        '.oai-sheet-item{background:' + surface + '!important;border-color:' + border + '!important;color:' + text + '!important}' +
        '.oai-sheet-item:hover,.oai-sheet-item--selected{background:' + bg + '!important;border-color:' + accent.hex + '!important;color:' + text + '!important}' +
        '.oai-conf-table td{background:' + surface + '!important;color:' + text + '!important;border-color:' + border + '!important}' +
        '.oai-conf-table th{background:' + bg + '!important;color:' + muted + '!important;border-color:' + border + '!important}' +
        '.oai-conf-sel,.oai-btn--secondary{background:' + bg + '!important;border-color:' + border + '!important;color:' + text + '!important}' +
        '.oai-combo-list{background:' + surface + '!important;border-color:' + border + '!important;color:' + text + '!important}' +
        '.oai-combo-opt:hover,.oai-combo-opt.is-selected{background:' + bg + '!important}' +
        // Review Data header row (file/sheet label, legend) and the Complete modal tables.
        '.oai-conf-sheet-label,.oai-conf-sheet-label strong,.oai-audit-title{color:' + text + '!important}' +
        '.oai-conf-legend,.oai-audit-summary,.oai-gif-chance,.oai-gif-reward{color:' + muted + '!important}' +
        '.oai-audit{border-top-color:' + border + '!important}' +
        '.oai-audit-scroll{border-color:' + border + '!important}' +
        '.oai-audit-table th{background:' + bg + '!important;color:' + muted + '!important;border-color:' + border + '!important}' +
        '.oai-audit-table td{background:' + surface + '!important;color:' + text + '!important;border-color:' + border + '!important}' +
        '.oai-audit-table td.oai-audit-reason{color:#fca5a5!important}' +
        '.oai-conf-cross-month-warning,.oai-audit-callout{background:rgba(185,28,28,0.18)!important;border-color:#b91c1c!important;color:#fca5a5!important}';
    }
    el.textContent = css;
  }

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync.get(['oai_theme_color', 'oai_theme_mode', 'oai_auto_default', 'oai_fill_time_notes_only'], function (prefs) {
      applyContentTheme(prefs.oai_theme_color, prefs.oai_theme_mode);
      _autoDefault = prefs.oai_auto_default !== false;
      _fillTimeNotesOnly = !!prefs.oai_fill_time_notes_only;
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      if (changes.oai_auto_default) _autoDefault = changes.oai_auto_default.newValue !== false;
      if (changes.oai_fill_time_notes_only) _fillTimeNotesOnly = !!changes.oai_fill_time_notes_only.newValue;
      applyContentTheme(changes.oai_theme_color ? changes.oai_theme_color.newValue : _themeColor,
        changes.oai_theme_mode ? changes.oai_theme_mode.newValue : _themeMode);
    });
  }

  // Fallback for missed live updates: re-read the saved theme whenever the page regains focus/visibility.
  function resyncThemeFromStorage() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime || !chrome.runtime.id) return;
      chrome.storage.sync.get(['oai_theme_color', 'oai_theme_mode'], function (prefs) {
        if (chrome.runtime.lastError) return;
        var c = prefs.oai_theme_color || 'slate', m = prefs.oai_theme_mode || 'light';
        if (c !== _themeColor || m !== _themeMode) applyContentTheme(c, m);
      });
    } catch (e) { /* extension context invalidated */ }
  }
  window.addEventListener('focus', resyncThemeFromStorage);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resyncThemeFromStorage(); });

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function normalise(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function setStatus(html, type) {
    if (!panelStatus) return;
    panelStatus.innerHTML = html;
    panelStatus.className = 'oai-status oai-status--' + type;
  }
  function clearStatus() { if (panelStatus) { panelStatus.innerHTML = ''; panelStatus.className = 'oai-status'; } }
  function scoreText(target, candidate) {
    var a = normalise(target), b = normalise(candidate);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 0.9;
    var aw = a.split(' ').filter(function (word) { return word.length > 2; });
    var bw = b.split(' ');
    if (!aw.length) return 0;
    var hits = aw.filter(function (word) { return bw.indexOf(word) >= 0; }).length;
    return hits / aw.length * 0.82;
  }
  function attachTooltip(el, text) {
    if (!text) return;
    el.addEventListener('mouseenter', function () {
      clearTimeout(tooltipTimer); // drop any stale timer from a neighbouring element
      tooltipTimer = setTimeout(function () {
        if (!tooltipEl) {
          tooltipEl = document.createElement('div');
          tooltipEl.className = 'oai-tooltip';
        }
        document.body.appendChild(tooltipEl); // keep the tooltip above the modal overlay
        tooltipEl.textContent = text;
        tooltipEl.classList.add('oai-tooltip--visible');
        var rect = el.getBoundingClientRect();
        var maxW = 240;
        var left = rect.left + rect.width / 2 - maxW / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - maxW - 4));
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
      }, 200);
    });
    el.addEventListener('mouseleave', function () {
      clearTimeout(tooltipTimer);
      if (tooltipEl) tooltipEl.classList.remove('oai-tooltip--visible');
    });
  }
  function attachTooltips(container) {
    container.querySelectorAll('[data-oai-tip]').forEach(function (el) { attachTooltip(el, el.dataset.oaiTip); });
  }

  // ── Workday page inspection ───────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  // Workday's date labels are `dayCell-<month index>-<day of month>` (Nov 1-7 is dayCell-10-1..7,
  // Oct 25-31 is dayCell-9-25..31, a month-crossing week mixes both), so the id is NOT a
  // Sunday-Saturday index. Take the visible labels in left-to-right (chronological) order.
  function visibleDayHeaders() {
    return Array.from(document.querySelectorAll('[data-automation-id^="dayCell-"]'))
      .filter(isVisible)
      .sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; })
      .filter(function (el, index, all) {
        // One header per date even if Workday renders a duplicate (e.g. a sticky copy).
        var id = el.getAttribute('data-automation-id');
        return all.findIndex(function (other) { return other.getAttribute('data-automation-id') === id; }) === index;
      });
  }

  // Workday ships two Enter Time calendars; both are supported.
  //  - 'legacy': week view with dayCell-*/nonTimedDaySeparator_* automation ids and a movable
  //    calendarAppointmentEnterTime tile.
  //  - 'v2' (rolled out 2026-11-05): a role="table" calendar exposing only data-testid hooks:
  //    calendar_container, date_cell_0..6 (Sun-Sat), date (label), date_range, total_quantity,
  //    time_entry_calendar_instances_wrapper (one per day, holds that day's entries).
  function v2DateCells() {
    return Array.from(document.querySelectorAll('[data-testid^="date_cell_"]'))
      .filter(function (cell) { return /^date_cell_\d+$/.test(cell.getAttribute('data-testid')) && isVisible(cell); })
      .sort(function (a, b) { return parseInt(a.getAttribute('data-testid').slice(10), 10) - parseInt(b.getAttribute('data-testid').slice(10), 10); });
  }
  function calendarLayout() {
    if (document.querySelector('[data-testid="calendar_container"]') && v2DateCells().length === 7) return 'v2';
    if (visibleDayHeaders().length === 7 && document.querySelector('[data-automation-id^="nonTimedDaySeparator_"]')) return 'legacy';
    return null;
  }
  function readWorkdayWeekV2() {
    if (!window.WTE_DATES) return null;
    var cells = v2DateCells();
    if (cells.length !== 7) return null;
    var labels = cells.map(function (cell) {
      var label = cell.querySelector('[data-testid="date"]');
      return label ? label.textContent : '';
    });
    var rangeEl = document.querySelector('[data-testid="date_range"]');
    var year = window.WTE_DATES.yearFromText(rangeEl ? rangeEl.textContent : '', null) ||
      window.WTE_DATES.yearFromText((document.body && document.body.innerText) || '', new Date().getFullYear());
    return window.WTE_DATES.weekFromDayLabels(labels, year);
  }

  function readWorkdayWeek() {
    if (!window.WTE_DATES) return null;
    if (v2DateCells().length === 7) return readWorkdayWeekV2();
    var headers = visibleDayHeaders();
    if (headers.length !== 7) return null;
    var bodyText = (document.body && document.body.innerText) || '';
    return window.WTE_DATES.weekFromLabels(headers.map(function (el) { return el.textContent || ''; }), window.WTE_DATES.yearFromText(bodyText, new Date().getFullYear()));
  }

  function isRelevantWorkdayUrl() {
    try {
      var current = new URL(window.location.href);
      return current.origin === WORKDAY_ORIGIN && current.pathname.indexOf(WORKDAY_PATH_PREFIX) === 0;
    } catch (error) {
      return false;
    }
  }
  function isWorkdayTimesheetPage() {
    // Enter Time calendar only: the page title is "Enter Time - Workday" on every route that
    // renders it, and the calendar must expose its date labels and day separators.
    return isRelevantWorkdayUrl() && /^enter time/i.test(document.title || '') &&
      !!(calendarLayout() && readWorkdayWeek());
  }

  function getEnterTimeDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"]')).find(function (dialog) {
      return isVisible(dialog) && /enter\s+time/i.test((dialog.innerText || '').slice(0, 100));
    }) || null;
  }

  function dialogTextDate(dialog) {
    var match = String(dialog && dialog.innerText || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (!match) return null;
    return new Date(parseInt(match[3], 10), parseInt(match[1], 10) - 1, parseInt(match[2], 10));
  }

  function appointmentDate(element, week) {
    var cell = element && element.closest && element.closest('[data-testid^="date_cell_"]');
    if (cell && week && week.dates) {
      var index = parseInt(String(cell.getAttribute('data-testid')).slice(10), 10);
      return week.dates[index] || null;
    }
    var match = String(element && element.getAttribute('data-automation-startdate') || '').match(/^(\d{1,2})-(\d{1,2})-/);
    if (!match || !week) return null;
    var year = week.from.getFullYear();
    var date = new Date(year, parseInt(match[1], 10) - 1, parseInt(match[2], 10));
    if (date < week.from && week.to.getFullYear() > week.from.getFullYear()) date.setFullYear(year + 1);
    return date;
  }

  function sameDate(a, b) { return !!(a && b && window.WTE_DATES.dateKey(a) === window.WTE_DATES.dateKey(b)); }
  function getEnterTimeAppointment() { return document.querySelector('[data-automation-id="calendarAppointmentEnterTime"]'); }

  function activateWorkdayControl(element, resolveTopmostHit, forcedTarget) {
    if (!element) return;
    // Workday's week calendar handles clicks on a full-size overlay above the
    // narrow day-separator node. Dispatching directly to the separator bypasses
    // that handler. Resolve the same topmost hit target a real pointer click
    // would use, while retaining the separator's day-specific coordinates.
    var rect = element.getBoundingClientRect();
    var clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
    var clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
    var automationId = element.getAttribute('data-automation-id') || '';
    var dayMatch = automationId.match(/^nonTimedDaySeparator_(\d+)$/);
    if (dayMatch) {
      var dayHeader = visibleDayHeaders()[parseInt(dayMatch[1], 10)];
      if (dayHeader) {
        var headerRect = dayHeader.getBoundingClientRect();
        clientX = Math.round(headerRect.left + headerRect.width / 2);
      }
    }
    var target = element;
    if (forcedTarget) target = forcedTarget;
    else if (resolveTopmostHit !== false) {
      var hit = document.elementFromPoint(clientX, clientY);
      var role = element.getAttribute('role');
      var isPickerItem = role === 'menuitem' || role === 'menuitemradio';
      // Never dispatch into the extension's own UI (panel/status/modals); if it
      // covers the coordinate, fall back to the Workday element itself.
      var inExtensionUi = !!(hit && hit.closest && hit.closest('#oai-panel,[class*="oai-"]'));
      // Picker options: the hit must be the option or inside it. Workday re-renders
      // the list under the pointer, so a stale coordinate can land on a different
      // option (e.g. "Administration" sitting where "Project Plan Tasks" was).
      // Never click a neighbour; dispatch to the intended option instead.
      if (hit && !inExtensionUi && (!isPickerItem || element.contains(hit))) target = hit;
    }
    // Never focus a picker option: moving focus off the Time Type input while it is still empty makes
    // Workday flag "The field Time Type is required" (measured live), even though the option is then selected.
    var inPicker = !!(target.closest && target.closest('[role="menuitem"],[role="menuitemradio"],[data-automation-id="promptOption"],[data-automation-id="multiSelectHeader"],[data-automation-id="DELETE_charm"]'));
    if (!inPicker && typeof target.focus === 'function') target.focus();
    var eventOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: clientX,
      clientY: clientY,
      screenX: clientX + (window.screenX || 0),
      screenY: clientY + (window.screenY || 0),
      button: 0,
      buttons: 1,
    };
    try { target.dispatchEvent(new PointerEvent('pointerdown', eventOptions)); } catch (error) { target.dispatchEvent(new MouseEvent('pointerdown', eventOptions)); }
    target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    try { target.dispatchEvent(new PointerEvent('pointerup', eventOptions)); } catch (error) { target.dispatchEvent(new MouseEvent('pointerup', eventOptions)); }
    target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    target.dispatchEvent(new MouseEvent('click', eventOptions));
  }

  function dateMismatchError(actual, expected) {
    return new Error('Workday opened ' + window.WTE_DATES.dateKey(actual) + ' instead of ' + window.WTE_DATES.dateKey(expected) + '.');
  }

  // Resolves only with a visible Enter Time dialog whose date is verified to match.
  // Returns null if no dialog appears. Throws if a dialog is open for another date
  // (after a short grace period for Workday's async render) or its date is unreadable.
  async function waitForEnterTimeDialog(expectedDate, timeoutMs) {
    var mismatchMs = 0, unverified = false;
    for (var elapsed = 0; elapsed < timeoutMs; elapsed += WORKDAY_TIMINGS.pollMs) {
      var dialog = getEnterTimeDialog();
      if (dialog) {
        if (!expectedDate) return dialog;
        var actualDate = dialogTextDate(dialog);
        if (actualDate && sameDate(actualDate, expectedDate)) return dialog;
        if (actualDate) {
          mismatchMs += WORKDAY_TIMINGS.pollMs;
          if (mismatchMs >= WORKDAY_TIMINGS.dateConfirmGraceMs) throw dateMismatchError(actualDate, expectedDate);
        } else {
          unverified = true;
        }
      } else {
        mismatchMs = 0;
      }
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    if (unverified) throw new Error('Workday opened an Enter Time dialog, but its date could not be verified.');
    return null;
  }

  async function waitForEnterTimeAppointment(expectedDate, week, timeoutMs) {
    for (var elapsed = 0; elapsed < timeoutMs; elapsed += WORKDAY_TIMINGS.pollMs) {
      var appointment = getEnterTimeAppointment();
      if (appointment && (!expectedDate || sameDate(appointmentDate(appointment, week), expectedDate))) return appointment;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return null;
  }

  async function openWorkdayEntry(dow, expectedDate) {
    var dialog = getEnterTimeDialog();
    if (dialog) {
      throw new Error('A Workday entry form is already open; close it before continuing.');
    }
    var week = readWorkdayWeek();

    if (calendarLayout() === 'v2') {
      // v2 has no movable tile and (measured 2026-11-05) a cancelled blank form leaves nothing
      // behind that blocks other days, so there is no stale-tile guard here: click the day's
      // date cell and verify the dialog's date. Re-query every attempt (the calendar re-renders).
      for (var v2Attempt = 0; v2Attempt < WORKDAY_TIMINGS.entryOpenAttempts; v2Attempt++) {
        var cell = document.querySelector('[data-testid="date_cell_' + dow + '"]');
        if (!cell) throw new Error('Workday date cell not found for ' + DAY_NAMES[dow] + '.');
        activateWorkdayControl(cell);
        dialog = await waitForEnterTimeDialog(expectedDate, WORKDAY_TIMINGS.entryOpenTimeoutMs);
        if (dialog) return dialog;
      }
      throw new Error('Could not open Workday entry form for ' + DAY_NAMES[dow] + '. If an unsaved Enter Time form is still on the page, refresh Workday and run the import again.');
    }

    for (var attempt = 0; attempt < WORKDAY_TIMINGS.entryOpenAttempts; attempt++) {
      var appointment = getEnterTimeAppointment();
      if (appointment && expectedDate) {
        var pendingDate = appointmentDate(appointment, week);
        // A pending tile for another date must never be clicked, and no other
        // date is clicked while it exists.
        if (pendingDate && !sameDate(pendingDate, expectedDate)) {
          // Measured live: while a leftover (unsaved) Enter Time tile exists, Workday
          // ignores clicks on every other day, and clicking the tile reopens ITS date.
          // Only a save on that date or a page refresh clears it.
          var staleError = new Error('A leftover Workday Enter Time tile for ' + window.WTE_DATES.dateKey(pendingDate) + ' is blocking other days. Refresh the Workday page, then run the import again.');
          staleError.staleTile = true;
          throw staleError;
        }
      }
      if (!appointment) {
        // Re-query every attempt: Workday re-renders the calendar and can detach nodes.
        var separator = document.querySelector('[data-automation-id="nonTimedDaySeparator_' + dow + '"]');
        if (!separator) throw new Error('Workday day selector not found for ' + DAY_NAMES[dow] + '.');
        activateWorkdayControl(separator);
        // Workday creates the temporary calendarAppointmentEnterTime tile first, then
        // opens the real dialog asynchronously (~800 ms in the live calendar). Do not
        // race that auto-open by immediately clicking the transient tile.
        dialog = await waitForEnterTimeDialog(expectedDate, WORKDAY_TIMINGS.entryAutoOpenWaitMs);
        if (dialog) return dialog;
        appointment = await waitForEnterTimeAppointment(expectedDate, week, WORKDAY_TIMINGS.entryAutoOpenWaitMs);
      }
      // A retry never re-clicks the day separator while a tile exists (that could
      // spawn a second tile); it clicks the existing tile for the requested date.
      if (appointment) {
        activateWorkdayControl(appointment);
        dialog = await waitForEnterTimeDialog(expectedDate, WORKDAY_TIMINGS.entryOpenTimeoutMs);
        if (dialog) return dialog;
      }
    }
    throw new Error('Could not open Workday entry form for ' + DAY_NAMES[dow] + '.');
  }

  function findTimeTypeInput(dialog) { return dialog && (dialog.querySelector('input[data-uxi-widget-type="selectinput"]') || dialog.querySelector('input[placeholder="Search"]')); }
  function findHoursInput(dialog) { return dialog && dialog.querySelector('input[data-automation-id="numericInput"]'); }
  function findCommentInput(dialog) { return dialog && dialog.querySelector('textarea'); }
  async function waitForVisibleTimeTypeInput(dialog) {
    for (var i = 0; i < WORKDAY_TIMINGS.menuTimeoutMs / WORKDAY_TIMINGS.pollMs; i++) {
      var input = findTimeTypeInput(dialog);
      if (isVisible(input)) return input;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return null;
  }
  function buttonByText(container, text) {
    return Array.from((container || document).querySelectorAll('button')).find(function (button) { return isVisible(button) && (button.textContent || '').trim().toLowerCase() === text.toLowerCase(); });
  }
  function setNativeValue(input, value) {
    if (!input) return;
    var proto = Object.getPrototypeOf(input);
    var descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, String(value)); else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setWorkdayHours(input, value) {
    var numeric = Number(value);
    if (!isFinite(numeric) || numeric <= 0) throw new Error('Hours must be a positive number.');
    var formatted = Number.isInteger(numeric) ? numeric.toFixed(1) : String(numeric);
    input.focus();
    if (typeof input.select === 'function') input.select();
    setNativeValue(input, formatted);
    input.blur();
  }

  function visiblePickerItems(role) {
    // Workday renders the open picker in a separate portal/dialog, not inside
    // the Enter Time dialog. Query the document globally and filter by visibility.
    var selector = role === 'radio' ? '[role="menuitemradio"]' : role === 'menuitem' ? '[role="menuitem"]' : '[role="menuitem"],[role="menuitemradio"]';
    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
  }
  function visibleMenuRadios() { return visiblePickerItems('radio'); }
  function menuLabel(item) {
    return String(item && (item.innerText || item.textContent) || '')
      .replace(/^submenu\s+/i, '').replace(/\s+related actions$/i, '').trim();
  }
  function mappingError(message) {
    var error = new Error(message);
    error.code = 'WORKDAY_MAPPING';
    return error;
  }

  async function waitForTimeTypeSelection(dialog, target) {
    var wanted = normalise(target);
    if (!wanted) return false;
    for (var i = 0; i < WORKDAY_TIMINGS.menuTimeoutMs / WORKDAY_TIMINGS.pollMs; i++) {
      var instruction = dialog && dialog.querySelector('[data-automation-id="promptAriaInstruction"]');
      var selectedText = normalise(instruction && instruction.textContent || '');
      var selectedOptions = Array.from((dialog || document).querySelectorAll('[role="listbox"] [aria-selected="true"],[role="option"][aria-selected="true"],[data-automation-id="promptLeafNode"]'))
        .filter(isVisible).map(function (option) { return normalise(option.textContent || ''); }).join(' ');
      var instructionMatches = selectedText.indexOf(wanted) >= 0;
      var optionMatches = !selectedOptions || selectedOptions.indexOf(wanted) >= 0;
      if (instructionMatches && optionMatches) return true;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return false;
  }

  async function waitForEnterTimeDialogClosed(timeoutMs) {
    var limit = timeoutMs || WORKDAY_TIMINGS.menuTimeoutMs;
    for (var i = 0; i < limit / WORKDAY_TIMINGS.pollMs; i++) {
      if (!getEnterTimeDialog()) return true;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return !getEnterTimeDialog();
  }

  // Visible "Error: ..." messages inside the dialog, for actionable failure reports.
  function workdayDialogErrors(dialog) {
    var text = String(dialog && dialog.innerText || '');
    var found = text.match(/Error:[^\n]*/g) || [];
    return found.length ? ' Workday reported: ' + found.join(' ') : '';
  }

  async function waitForVisibleOkButton(dialog) {
    for (var i = 0; i < WORKDAY_TIMINGS.menuTimeoutMs / WORKDAY_TIMINGS.pollMs; i++) {
      var button = buttonByText(dialog, 'OK');
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return null;
  }

  // Measured live 2026-11-02: ~0.5 s after the Time Type selection is confirmed,
  // Workday re-renders the Enter Time form. Hours and Comment are replaced by NEW
  // elements and Hours resets to 0, so anything typed before that is lost (and OK
  // then reports an error). Wait until the field elements stop being replaced.
  async function waitForFormStable(dialog) {
    var lastHours = null, lastComment = null, stableMs = 0;
    for (var elapsed = 0; elapsed < WORKDAY_TIMINGS.formStableTimeoutMs; elapsed += WORKDAY_TIMINGS.pollMs) {
      var hours = findHoursInput(dialog), comment = findCommentInput(dialog);
      if (hours && comment && hours === lastHours && comment === lastComment) stableMs += WORKDAY_TIMINGS.pollMs; else stableMs = 0;
      lastHours = hours; lastComment = comment;
      if (stableMs >= WORKDAY_TIMINGS.formStableMs) return;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    throw new Error('Workday entry form did not finish re-rendering after the Time Type selection.');
  }

  function timeTypeStillSelected(dialog) {
    var instruction = dialog.querySelector('[data-automation-id="promptAriaInstruction"]');
    return !!instruction && /\b1 item selected\b/i.test(instruction.textContent || '');
  }

  // Enter Hours and Comment, then re-read the LIVE fields and verify Workday kept
  // them. If Workday re-rendered and dropped a value, wait for the form to settle
  // and enter them again. OK is never pressed on unverified values.
  async function fillWorkdayEntryFields(dialog, entry) {
    var expectedHours = Number(entry.hours);
    var wantedComment = String(entry.notes || '').replace(/\r\n/g, '\n');
    var problem = '';
    for (var attempt = 0; attempt < WORKDAY_TIMINGS.fieldFillAttempts; attempt++) {
      await waitForFormStable(dialog);
      var hours = findHoursInput(dialog);
      if (!hours) throw new Error('Workday Hours field was not found.');
      setWorkdayHours(hours, entry.hours);
      var comment = findCommentInput(dialog);
      if (comment && wantedComment) { setNativeValue(comment, wantedComment); comment.blur(); }
      await delay(WORKDAY_TIMINGS.fieldVerifyMs);
      var liveHours = findHoursInput(dialog), liveComment = findCommentInput(dialog);
      var problems = [];
      if (!timeTypeStillSelected(dialog)) problems.push('Time Type selection was lost');
      if (!liveHours || Number(liveHours.value) !== expectedHours || liveHours.getAttribute('aria-invalid') === 'true') {
        problems.push('Hours is "' + (liveHours ? liveHours.value : 'missing') + '" instead of ' + entry.hours);
      }
      if (wantedComment && (!liveComment || String(liveComment.value).replace(/\r\n/g, '\n') !== wantedComment)) problems.push('Comment was not kept');
      if (!problems.length) return;
      problem = problems.join('; ');
    }
    throw new Error('Workday did not keep the entered values (' + problem + ').' + workdayDialogErrors(dialog));
  }

  function workdaySaveMessages() {
    var messages = Array.from(document.querySelectorAll('[role="status"],[aria-live="polite"],[aria-live="assertive"]'))
      .map(function (element) { return String(element.innerText || '').trim(); })
      .filter(function (text) { return /changes have been saved/i.test(text); });
    // v2: the Summary totals change when an entry is saved; treat that as a fresh save signal.
    var totals = Array.from(document.querySelectorAll('[data-testid="total_quantity"]')).map(function (el) { return String(el.textContent || '').trim(); });
    if (totals.length) messages.push('totals:' + totals.join('/'));
    return messages;
  }

  function workdayCalendarEvents() {
    var legacy = Array.from(document.querySelectorAll('[data-automation-id="calendarevent"]')).map(function (event) {
      return { id: event.getAttribute('data-automation-eventid') || event.id || '', element: event };
    });
    // v2: saved entries are children of each day's time_entry_calendar_instances_wrapper.
    var v2 = [];
    Array.from(document.querySelectorAll('[data-testid="time_entry_calendar_instances_wrapper"]')).forEach(function (wrapper, cellIndex) {
      Array.from(wrapper.children).forEach(function (child, childIndex) {
        v2.push({ id: 'v2:' + cellIndex + ':' + childIndex + ':' + String(child.textContent || '').trim().slice(0, 80), element: child });
      });
    });
    return legacy.concat(v2);
  }

  async function waitForWorkdaySave(expectedDate, pageWeek, beforeEventIds, beforeSaveMessages) {
    var priorIds = new Set(beforeEventIds || []);
    var priorMessages = beforeSaveMessages || [];
    for (var i = 0; i < WORKDAY_TIMINGS.saveTimeoutMs / WORKDAY_TIMINGS.pollMs; i++) {
      var newEvent = workdayCalendarEvents().some(function (event) {
        return !priorIds.has(event.id) && (!expectedDate || sameDate(appointmentDate(event.element, pageWeek), expectedDate));
      });
      var freshSaveMessage = workdaySaveMessages().some(function (message) { return priorMessages.indexOf(message) < 0; });
      if (newEvent || freshSaveMessage) return true;
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return false;
  }

  function visibleDiscardPrompt() {
    return Array.from(document.querySelectorAll('[role="dialog"]')).find(function (candidate) {
      return isVisible(candidate) && /discard\s+changes\?/i.test(candidate.innerText || '');
    }) || null;
  }

  // Cancel an unsaved Enter Time form that this extension opened. Once the form is
  // dirty (a Time Type was picked, Hours typed, ...) Workday asks "Discard Changes?"
  // and keeps the form open until that prompt is answered, so confirm it. Only ever
  // call this for a form the extension opened and has not saved.
  async function cancelWorkdayEntry(dialog) {
    var cancel = buttonByText(dialog, 'Cancel');
    if (!cancel) return false;
    activateWorkdayControl(cancel, false);
    var answered = false;
    for (var i = 0; i < WORKDAY_TIMINGS.menuTimeoutMs / WORKDAY_TIMINGS.pollMs; i++) {
      if (!getEnterTimeDialog()) return true;
      var prompt = visibleDiscardPrompt();
      if (prompt && !answered) {
        var discard = buttonByText(prompt, 'Discard');
        if (discard) { activateWorkdayControl(discard, false); answered = true; }
      }
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return !getEnterTimeDialog();
  }

  // ── Time Type selection by SEARCH ─────────────────────────────────────────
  // Measured live 2026-11-02: typing a term into the Time Type box and pressing Enter
  // returns a FLAT list of final, full-path options ("Project > Phase > Task") from the
  // whole hierarchy, so nothing has to be drilled through. Quirks handled below:
  //  - with exactly ONE match Workday selects it immediately (no list is shown);
  //  - the list is virtualized (~6 of N rows are in the DOM), so it is scrolled;
  //  - the field is single-select with a DELETE_charm that clears the selection.

  function timeTypeSelectionLabel(dialog) {
    var chip = dialog && dialog.querySelector('[data-automation-id="selectedItem"]');
    return chip ? String(chip.innerText || chip.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function resultLabel(item) { return menuLabel(item).replace(/\s+/g, ' '); }
  function radioSignature() { return visibleMenuRadios().map(resultLabel).sort().join('\u001f'); }
  function resultScroller() {
    return Array.from(document.querySelectorAll('[data-automation-id="activeListContainer"]')).find(isVisible) || null;
  }
  function typeIntoTimeTypeSearch(input, text) {
    input.focus();
    var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor.set.call(input, text);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }
  function pressEnter(input) {
    var options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', options));
    input.dispatchEvent(new KeyboardEvent('keypress', options));
    input.dispatchEvent(new KeyboardEvent('keyup', options));
  }

  async function clearTimeTypeSelection(dialog) {
    var charm = Array.from(dialog.querySelectorAll('[data-automation-id="DELETE_charm"]')).find(isVisible);
    if (!charm) return;
    activateWorkdayControl(charm, false);
    for (var i = 0; i < WORKDAY_TIMINGS.menuTimeoutMs / WORKDAY_TIMINGS.pollMs; i++) {
      if (!timeTypeSelectionLabel(dialog)) { await delay(WORKDAY_TIMINGS.selectionSettleMs); return; }
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    throw new Error('Workday did not clear the Time Type selection.');
  }

  // Every result label, scrolling the virtualized list top to bottom.
  async function collectTimeTypeResults() {
    var labels = [];
    function harvest() {
      visibleMenuRadios().forEach(function (item) {
        var label = resultLabel(item);
        if (label && labels.indexOf(label) < 0) labels.push(label);
      });
    }
    harvest();
    var scroller = resultScroller();
    if (scroller) {
      for (var step = 0; step < 40; step++) {
        var before = scroller.scrollTop;
        scroller.scrollTop = before + Math.max(40, scroller.clientHeight - 30);
        await delay(300);
        harvest();
        if (scroller.scrollTop === before) break;
      }
      scroller.scrollTop = 0;
      await delay(250);
    }
    return labels;
  }

  // Type `query` and press Enter. Returns { selected: label } when Workday auto-selected
  // a single match, or { results: [labels] } (empty when nothing matched).
  async function searchTimeType(dialog, query) {
    var input = await waitForVisibleTimeTypeInput(dialog);
    if (!input) throw new Error('Workday Time Type field was not found.');
    if (timeTypeSelectionLabel(dialog)) await clearTimeTypeSelection(dialog);
    var before = radioSignature();
    if (!visiblePickerItems().length) {
      // The full pointer sequence opens the picker; plain click() is unreliable here.
      activateWorkdayControl(input, false);
      await delay(WORKDAY_TIMINGS.timeTypeClickSettleMs);
    }
    typeIntoTimeTypeSearch(input, query);
    await delay(WORKDAY_TIMINGS.searchSettleMs);
    pressEnter(input);
    var stable = '';
    for (var elapsed = 0; elapsed < WORKDAY_TIMINGS.searchTimeoutMs; elapsed += WORKDAY_TIMINGS.pollMs) {
      var selected = timeTypeSelectionLabel(dialog);
      if (selected) return { selected: selected };
      var signature = radioSignature();
      // A list is "done" when it is non-empty, different from before, and unchanged
      // on two consecutive polls (the list renders in stages).
      if (signature && signature !== before) {
        if (signature === stable) return { results: await collectTimeTypeResults() };
        stable = signature;
      } else {
        stable = '';
      }
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return { results: [] };
  }

  function resultLeaf(label) { var parts = label.split(/\s*>\s*/); return parts[parts.length - 1].trim(); }
  function resultHead(label) { return label.split(/\s*>\s*/)[0].trim(); }

  // Best match for the workbook Task among the searched results: exact leaf, else
  // a unique strong fuzzy leaf. Ties are broken by similarity of the workbook
  // Project to the option's project; a remaining tie is reported, never guessed.
  function pickTimeTypeResult(labels, project, task) {
    var wantedTask = normalise(task);
    if (!wantedTask) throw mappingError('Task is blank for the selected Workday Project.');
    // A task saved by Grab data is "Phase > Task": match the full path first.
    var wantedPath = normalise(project + ' > ' + task);
    var exactPath = labels.filter(function (label) { return normalise(label) === wantedPath; });
    if (exactPath.length === 1) return exactPath[0];
    var candidates = labels.filter(function (label) { return normalise(resultLeaf(label)) === wantedTask; });
    if (!candidates.length) {
      var scored = labels.map(function (label) { return { label: label, score: scoreText(task, resultLeaf(label)) }; })
        .filter(function (candidate) { return candidate.score >= MATCH_MIN; });
      if (scored.length) {
        var bestScore = Math.max.apply(null, scored.map(function (candidate) { return candidate.score; }));
        candidates = scored.filter(function (candidate) { return Math.abs(candidate.score - bestScore) < 0.001; }).map(function (candidate) { return candidate.label; });
      }
    }
    if (!candidates.length) throw mappingError('Task "' + task + '" was not found for Project "' + project + '" in Workday.');
    if (candidates.length === 1) return candidates[0];
    var ranked = candidates.map(function (label) { return { label: label, score: scoreText(project, resultHead(label)) }; });
    var top = Math.max.apply(null, ranked.map(function (item) { return item.score; }));
    var winners = ranked.filter(function (item) { return Math.abs(item.score - top) < 0.001; });
    if (winners.length > 1) throw mappingError('Task "' + task + '" matches several Workday options for Project "' + project + '"; it is ambiguous.');
    return winners[0].label;
  }

  async function selectTimeTypeResult(dialog, label) {
    function find() { return visibleMenuRadios().find(function (item) { return resultLabel(item) === label; }) || null; }
    // The list is virtualized and clipped by its scroller: an option can be in the DOM
    // yet lie outside the visible area, where a dispatched click is silently ignored
    // (measured live). Scroll it into view, re-find it (the list re-renders), and
    // click only when the topmost element at its centre is inside the option.
    var scroller = resultScroller();
    if (scroller) { scroller.scrollTop = 0; await delay(250); }
    var clicked = false;
    for (var attempt = 0; attempt < 12 && !clicked; attempt++) {
      var item = find();
      if (!item) {
        if (!scroller) break;
        var before = scroller.scrollTop;
        scroller.scrollTop = before + Math.max(40, scroller.clientHeight - 30);
        await delay(300);
        if (scroller.scrollTop === before && !find()) break;
        continue;
      }
      item.scrollIntoView({ block: 'center' });
      await delay(350);
      item = find();
      if (!item) continue;
      var rect = item.getBoundingClientRect();
      var hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
      if (hit && item.contains(hit)) { activateWorkdayControl(item); clicked = true; }
    }
    if (!clicked) throw new Error('Workday option "' + label + '" could not be scrolled into view to select it.');
    await delay(WORKDAY_TIMINGS.selectionSettleMs);
    if (!await waitForTimeTypeSelection(dialog, label)) throw new Error('Workday did not confirm Time Type "' + label + '".');
  }

  // The workbook Project is "Client : Engagement"; the Client part is what is searched.
  function timeTypeSearchQuery(project) {
    return String(project || '').split(/\s*[:>→]\s*/)[0].trim();
  }

  async function chooseWorkdayTimeTypePrimary(dialog, timeType, projectTask) {
    var project = String(timeType || '').trim();
    var task = String(projectTask || '').trim();
    if (!project) throw mappingError('Project is blank.');
    if (!task) throw mappingError('Task is blank for the selected Workday Project.');
    var outcome = await searchTimeType(dialog, timeTypeSearchQuery(project));
    if (outcome.selected) {
      // Workday auto-selected a single match; keep it only if its Task matches.
      try { pickTimeTypeResult([outcome.selected], project, task); }
      catch (error) { await clearTimeTypeSelection(dialog); throw error; }
      if (!await waitForTimeTypeSelection(dialog, outcome.selected)) throw new Error('Workday did not confirm Time Type "' + outcome.selected + '".');
      return;
    }
    if (!outcome.results.length) throw mappingError('Project "' + project + '" was not found in Workday.');
    await selectTimeTypeResult(dialog, pickTimeTypeResult(outcome.results, project, task));
  }

  async function chooseWorkdayUnassigned(dialog) {
    var wanted = normalise(WORKDAY_FALLBACK_PATH);
    var outcome = await searchTimeType(dialog, 'Unassigned');
    if (outcome.selected) {
      if (normalise(outcome.selected) !== wanted) {
        await clearTimeTypeSelection(dialog);
        throw new Error('Workday selected "' + outcome.selected + '" instead of "' + WORKDAY_FALLBACK_PATH + '".');
      }
      if (!await waitForTimeTypeSelection(dialog, outcome.selected)) throw new Error('Workday did not confirm Time Type "' + outcome.selected + '".');
      return;
    }
    var match = outcome.results.find(function (label) { return normalise(label) === wanted; });
    if (!match) throw new Error('Workday did not list "' + WORKDAY_FALLBACK_PATH + '".');
    await selectTimeTypeResult(dialog, match);
  }

  async function chooseWorkdayTimeType(dialog, timeType, projectTask) {
    if (_fillTimeNotesOnly) {
      // "Default to Unassigned, Fill Time/Notes Only": the user's explicit choice,
      // so it is not counted as a mapping fallback.
      await chooseWorkdayUnassigned(dialog);
      return { usedFallback: false, dialog: dialog };
    }
    if (!_autoDefault) {
      await chooseWorkdayUnassigned(dialog);
      return { usedFallback: true, originalMessage: 'Auto-match Workday fields is disabled.', dialog: dialog };
    }
    try {
      await chooseWorkdayTimeTypePrimary(dialog, timeType, projectTask);
      return { usedFallback: false, dialog: dialog };
    } catch (error) {
      if (error.code !== 'WORKDAY_MAPPING') throw error;
      var originalMessage = error.message;
      try {
        // Same still-blank form, no cancel/reopen: search for Unassigned instead.
        await chooseWorkdayUnassigned(dialog);
        return { usedFallback: true, originalMessage: originalMessage, dialog: dialog };
      } catch (fallbackError) {
        // Fallback failure is terminal: the caller must not click OK or cancel the
        // form, and must stop processing with the unsaved form left open.
        var combined = new Error(originalMessage + ' Fallback "' + WORKDAY_FALLBACK_PATH + '" also failed: ' + fallbackError.message);
        combined.fallbackFailed = true;
        throw combined;
      }
    }
  }

  async function fillWorkdayEntries(entries, mappings, pageWeek) {
    var results = { success: 0, failed: [], skipped: 0, fallbacks: 0, fallbackEntries: [], cancelled: false };
    for (var i = 0; i < entries.length; i++) {
      if (_cancelWorkdayImport) { results.cancelled = true; break; }
      var entry = entries[i];
      var mapping = mappings.get(entry.groupKey) || { timeType: entry.clientEngagement, projectTask: entry.task };
      var expectedDate = entry.date || (pageWeek && pageWeek.dates ? pageWeek.dates[entry.dow] : null);
      var ownedDialog = null;
      try {
        if (pageWeek && expectedDate && pageWeek.dateKeys.indexOf(window.WTE_DATES.dateKey(expectedDate)) < 0) {
          results.skipped++; results.failed.push({ day: entry.dayName, client: mapping.timeType, reason: 'date is not part of the open Workday week' }); continue;
        }
        ownedDialog = await openWorkdayEntry(entry.dow, expectedDate);
        if (_cancelWorkdayImport) {
          results.cancelled = true;
          await cancelWorkdayEntry(ownedDialog);
          break;
        }
        var selection = await chooseWorkdayTimeType(ownedDialog, mapping.timeType, mapping.projectTask);
        ownedDialog = selection.dialog || ownedDialog;
        if (selection.usedFallback) {
          results.fallbacks++;
          results.fallbackEntries.push({
            day: entry.dayName || '?',
            expected: [mapping.timeType, mapping.projectTask].filter(Boolean).join(' > '),
            actual: 'Unassigned',
            note: 'Unassigned fallback; ' + (selection.originalMessage || 'unable to find time type')
          });
        }
        // Wait out Workday's post-selection re-render, then enter and VERIFY Hours and
        // Comment. Never press OK until Workday has kept the values.
        await fillWorkdayEntryFields(ownedDialog, entry);
        var ok =await waitForVisibleOkButton(ownedDialog);
        if (!ok) throw new Error('Workday OK button was not found.');
        var beforeEventIds = workdayCalendarEvents().map(function (event) { return event.id; });
        var beforeSaveMessages = workdaySaveMessages();
        // Full pointer sequence, targeting the button itself (HTMLElement.click()
        // alone is unreliable on Workday's controls).
        activateWorkdayControl(ok, false);
        if (!await waitForEnterTimeDialogClosed(WORKDAY_TIMINGS.saveTimeoutMs)) {
          throw new Error('Workday kept the entry form open after OK; the entry was not accepted.' + workdayDialogErrors(ownedDialog));
        }
        if (!await waitForWorkdaySave(expectedDate, pageWeek, beforeEventIds, beforeSaveMessages)) throw new Error('Workday closed the entry form but did not confirm the saved calendar event within ' + (WORKDAY_TIMINGS.saveTimeoutMs / 1000) + ' seconds.');
        results.success++;
      } catch (error) {
        results.failed.push({ day: entry.dayName || '?', client: mapping.timeType || entry.clientEngagement || '', reason: error.message });
        if (error.staleTile) {
          // Every remaining entry would fail the same way; stop once with one clear message.
          var remaining = entries.length - i - 1;
          if (remaining > 0) results.failed[results.failed.length - 1].reason += ' ' + remaining + ' more entr' + (remaining === 1 ? 'y was' : 'ies were') + ' not processed.';
          break;
        }
        if (error.fallbackFailed) {
          results.failed[results.failed.length - 1].reason += ' The unsaved Workday form was left open (OK was not clicked); processing stopped.';
          break;
        }
        if (ownedDialog && getEnterTimeDialog() === ownedDialog) {
          await cancelWorkdayEntry(ownedDialog);
          if (getEnterTimeDialog()) {
            results.failed[results.failed.length - 1].reason += ' Workday kept the unsaved entry form open; processing stopped for safety.';
            break;
          }
        } else if (getEnterTimeDialog()) {
          results.failed[results.failed.length - 1].reason += ' A Workday entry form remained open; it was not changed or cancelled, and processing stopped for safety.';
          break;
        }
      }
      if (_cancelWorkdayImport) { results.cancelled = true; break; }
    }
    return results;
  }

  // ── Excel parsing and exact Workday date filtering ─────────────────────────

  function detectDow(cell) {
    if (cell instanceof Date) return cell.getDay();
    if (typeof cell === 'number' && cell > 40000 && cell < 60000) return new Date((cell - 25569) * 86400 * 1000).getUTCDay();
    var text = String(cell == null ? '' : cell).trim();
    for (var i = 0; i < DAY_PATTERNS.length; i++) if (DAY_PATTERNS[i].test(text)) return i;
    return -1;
  }
  function parseSheet(wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) throw new Error('Sheet "' + sheetName + '" not found.');
    var a1 = ws.A1;
    if (!a1 || !/(client|time\s*type|project)/i.test(String(a1.v || ''))) throw new Error('Cell A1 must say "Project", "Client : Engagement", or "Time Type".');
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!rows || rows.length < 2) throw new Error('Sheet appears empty.');
    var header = rows[0] || [];
    var dayCols = [];
    for (var i = 0; i < header.length; i++) {
      var headerText = String(header[i] == null ? '' : header[i]);
      var dow = detectDow(header[i]);
      if (dow < 0 || /note|comment/i.test(headerText)) continue;
      dayCols.push({ idx: i, dow: dow, day: DAY_NAMES[dow], notesIdx: i + 1 });
    }
    if (!dayCols.length) [2, 4, 6, 8, 10, 12, 14].forEach(function (position, day) { dayCols.push({ idx: position, dow: day, day: DAY_NAMES[day], notesIdx: position + 1 }); });
    var entries = [], skippedCells = 0;
    for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      var row = rows[rowIndex]; if (!row) continue;
      var timeType = String(row[0] || '').trim();
      var projectTask = String(row[1] || '').trim();
      if (/^total/i.test(timeType)) continue;
      var groupKey = timeType + '\x00' + projectTask + '\x00#' + rowIndex;
      dayCols.forEach(function (dayColumn) {
        var rawHours = row[dayColumn.idx];
        var notes = String(row[dayColumn.notesIdx] || '').trim();
        var hours = parseFloat(rawHours);
        var hasHours = !isNaN(hours) && hours > 0;
        if (!hasHours && !notes) { skippedCells++; return; }
        entries.push({ clientEngagement: timeType, task: projectTask, timeType: timeType, projectTask: projectTask, hours: hasHours ? hours : 0, notes: notes, dow: dayColumn.dow, col: dayColumn.dow, dayName: dayColumn.day, row: null, groupKey: groupKey });
      });
    }
    if (!entries.length) throw new Error('No time entries found. Check that hours or notes are filled in.');
    return { entries: entries, skippedCells: skippedCells };
  }

  function crossMonthInfo(pageWeek, prepared) {
    var result = { isCross: false, from: pageWeek && pageWeek.from, to: pageWeek && pageWeek.to, excluded: prepared ? prepared.excluded.length : 0 };
    if (pageWeek && pageWeek.from && pageWeek.to) result.isCross = pageWeek.from.getMonth() !== pageWeek.to.getMonth() || pageWeek.from.getFullYear() !== pageWeek.to.getFullYear();
    return result;
  }
  function formatDateRange(from, to) {
    if (!from || !to) return '';
    return from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function buildGroups(entries) {
    var map = new Map(), groups = [];
    entries.forEach(function (entry) {
      var group = map.get(entry.groupKey);
      if (!group) {
        group = { key: entry.groupKey, id: 'g' + groups.length, timeType: entry.timeType || entry.clientEngagement, projectTask: entry.projectTask || entry.task, days: new Array(7).fill(null) };
        map.set(entry.groupKey, group); groups.push(group);
      }
      group.days[entry.dow] = { hours: entry.hours, notes: entry.notes };
    });
    return groups;
  }
  function gridStats(groups) {
    var totals = new Array(7).fill(0), grand = 0;
    groups.forEach(function (group) { group.days.forEach(function (cell, index) { if (cell) { totals[index] += cell.hours || 0; grand += cell.hours || 0; } }); });
    return { totals: totals, grand: grand };
  }

  function uniqueReviewChoices(options, property, labelProperty) {
    var seen = new Set();
    return options.map(function (option) { return { value: String(option[property] || '').trim(), label: String(option[labelProperty || property] || '').trim() }; })
      .filter(function (option) {
        if (!option.value || seen.has(option.value)) return false;
        seen.add(option.value); return true;
      });
  }

  function resolveReviewChoice(rawValue, choices) {
    var raw = String(rawValue || '').trim();
    if (!raw) return '';
    var exact = choices.filter(function (choice) { return normalise(choice.value) === normalise(raw); });
    if (exact.length === 1) return exact[0].value;
    var candidates = choices.map(function (choice) { return { choice: choice, score: scoreText(raw, choice.value) }; })
      .filter(function (candidate) { return candidate.score >= MATCH_MIN; });
    if (!candidates.length) return '';
    var bestScore = Math.max.apply(null, candidates.map(function (candidate) { return candidate.score; }));
    var best = candidates.filter(function (candidate) { return Math.abs(candidate.score - bestScore) < 0.001; });
    return best.length === 1 ? best[0].choice.value : '';
  }

  // Pick the saved Project/Task that best fits the workbook's Project and Task text. Only
  // tasks whose leaf (or whole Phase > Task) scores >= MATCH_MIN count; the Project name breaks
  // ties. A remaining tie, or no match, returns blanks - never a guess.
  function bestCatalogMatch(project, task, options) {
    var blank = { timeType: '', projectTask: '' };
    if (!_autoDefault || !options.length || !String(task || '').trim()) return blank;
    var candidates = [];
    options.forEach(function (option) {
      var leaf = String(option.projectTask).split(/\s*>\s*/).pop();
      var score = Math.max(scoreText(task, leaf), scoreText(task, option.projectTask));
      if (score >= MATCH_MIN) candidates.push({ option: option, score: score, projectScore: scoreText(String(project || '').split(':')[0], option.timeType) });
    });
    if (!candidates.length) return blank;
    var best = Math.max.apply(null, candidates.map(function (c) { return c.score; }));
    var top = candidates.filter(function (c) { return Math.abs(c.score - best) < 0.001; });
    if (top.length > 1) {
      var bestProject = Math.max.apply(null, top.map(function (c) { return c.projectScore; }));
      top = top.filter(function (c) { return Math.abs(c.projectScore - bestProject) < 0.001; });
    }
    // A catalogued Project the workbook never mentions is not evidence: require some overlap
    // when several Projects remain.
    if (top.length !== 1) return blank;
    return { timeType: top[0].option.timeType, projectTask: top[0].option.projectTask };
  }

  function optionPath(option) { return option.timeType + ' > ' + option.projectTask; }

  function projectTaskChoices(options, project) {
    return uniqueReviewChoices(options.filter(function (option) {
      return normalise(option.timeType) === normalise(project);
    }), 'projectTask', 'label');
  }

  function selectOptionsHtml(placeholder, choices, selectedValue) {
    var selected = String(selectedValue || '').trim();
    var html = '<option value="">' + esc(placeholder) + '</option>';
    choices.forEach(function (choice) {
      html += '<option value="' + esc(choice.value) + '"' + (choice.value === selected ? ' selected' : '') + '>' + esc(choice.label) + '</option>';
    });
    return html;
  }

  function unassignedReviewMapping(options) {
    return options.find(function (option) {
      return normalise(option.timeType) === normalise('Unassigned') &&
        normalise(option.projectTask) === normalise('Unassigned Time > Unassigned');
    }) || null;
  }

  function readonlyUnassignedCell(text, label) {
    return '<select class="oai-conf-sel oai-conf-sel--readonly" disabled aria-label="' + esc(label) + '"><option>' + esc(text) + '</option></select>';
  }

  // `unassignedOnly` = "Default to Unassigned, Fill Time/Notes Only": Project and Task are
  // not editable or matched; every entry uses the Unassigned Time Type.
  function buildGrid(groups, editable, mappings, workdayOptions, unassignedOnly) {
    var stats = gridStats(groups);
    var options = Array.isArray(workdayOptions) ? workdayOptions : [];
    var projectOptions = uniqueReviewChoices(options, 'timeType');
    var combined = !!(editable && options.length && !unassignedOnly);
    var head = '<tr>' + (combined ? '<th class="oai-conf-th oai-conf-th--client" colspan="2">PROJECT &gt; TASK</th>' : '<th class="oai-conf-th oai-conf-th--client">PROJECT</th><th class="oai-conf-th oai-conf-th--task">TASK</th>') + DAY_NAMES.map(function (day) { return '<th class="oai-conf-th oai-conf-th--day">' + day.toUpperCase() + '</th>'; }).join('') + '<th class="oai-conf-th oai-conf-th--total">TOTAL</th></tr>';
    var body = groups.map(function (group) {
      var mapping = mappings.get(group.key) || { timeType: group.timeType, projectTask: group.projectTask };
      var currentTimeType = String(mapping.timeType || '').trim();
      var currentProjectTask = String(mapping.projectTask || '').trim();
      var left;
      var task;
      if (unassignedOnly) {
        left = readonlyUnassignedCell('Unassigned', 'Project for ' + group.id);
        task = readonlyUnassignedCell('Unassigned Time > Unassigned', 'Task for ' + group.id);
      } else if (combined) {
        // One dropdown spanning Project + Task, listing every saved "Project > Phase > Task".
        var selectedPath = '';
        var existing = options.find(function (option) { return normalise(option.timeType) === normalise(currentTimeType) && normalise(option.projectTask) === normalise(currentProjectTask); });
        if (existing) selectedPath = optionPath(existing);
        else {
          var guess = bestCatalogMatch(group.timeType, group.projectTask, options);
          if (guess.timeType) selectedPath = guess.timeType + ' > ' + guess.projectTask;
        }
        var pathChoices = options.map(function (option) { var path = optionPath(option); return { value: path, label: path }; });
        left = '<div class="oai-combo"><input type="hidden" class="oai-wd-map-input" data-field="combined" data-group="' + esc(group.id) + '" value="' + esc(selectedPath) + '">' +
          '<button type="button" class="oai-conf-sel oai-combo-btn" aria-haspopup="listbox" aria-label="Project and Task for ' + esc(group.id) + '"><span class="oai-combo-text' + (selectedPath ? '' : ' oai-combo-text--empty') + '">' + esc(selectedPath || '- will default to unassigned -') + '</span>'+'<svg class="oai-combo-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'+'</button></div>';
        task = null;
      } else {
        left = editable ? '<input class="oai-conf-sel oai-wd-map-input" data-field="timeType" data-group="' + esc(group.id) + '" value="' + esc(mapping.timeType) + '" aria-label="Project for ' + esc(group.id) + '">' : esc(group.timeType || '');
        task = editable ? '<input class="oai-conf-sel oai-wd-map-input" data-field="projectTask" data-group="' + esc(group.id) + '" value="' + esc(mapping.projectTask) + '" aria-label="Task for ' + esc(group.id) + '">' : esc(group.projectTask || '');
      }
      var total = group.days.reduce(function (sum, cell) { return sum + (cell ? cell.hours || 0 : 0); }, 0);
      var cells = group.days.map(function (cell) {
        if (!cell) return '<td class="oai-conf-td oai-conf-td--hours oai-conf-td--empty">&mdash;</td>';
        var notes = cell.notes ? '<span class="oai-conf-ind oai-conf-ind--yes" data-oai-tip="Comment present">&#10003;</span>' : '<span class="oai-conf-ind oai-conf-ind--no" data-oai-tip="No comment">&#10005;</span>';
        return '<td class="oai-conf-td oai-conf-td--hours oai-conf-td--filled" data-oai-tip="' + esc(cell.notes || 'No comment') + '"><span class="oai-cell-content">' + esc(cell.hours) + notes + '</span></td>';
      }).join('');
      return '<tr class="oai-conf-row"><td class="oai-conf-td oai-conf-td--client"' + (task === null ? ' colspan="2"' : '') + '>' + left + '</td>' + (task === null ? '' : '<td class="oai-conf-td oai-conf-td--task">' + task + '</td>') + cells + '<td class="oai-conf-td oai-conf-td--rowtotal">' + (total ? total.toFixed(2) : '') + '</td></tr>';
    }).join('');
    var footer = '<tr class="oai-conf-row-footer"><td class="oai-conf-td oai-conf-td--footer-label" colspan="2">TOTAL</td>' + stats.totals.map(function (total) { return '<td class="oai-conf-td oai-conf-td--daytotal">' + (total ? total.toFixed(2) : '&mdash;') + '</td>'; }).join('') + '<td class="oai-conf-td oai-conf-td--grandtotal">' + stats.grand.toFixed(2) + '</td></tr>';
    return '<div class="oai-conf-scroll"><table class="oai-conf-table"><thead>' + head + '</thead><tbody>' + body + footer + '</tbody></table></div>';
  }

  function crossMonthNotice(crossMonth) {
    if (!crossMonth || !crossMonth.isCross) return '';
    return '<div class="oai-conf-cross-month-warning">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0-1.71 3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>' +
      ' This Workday week spans two months (' + esc(formatDateRange(crossMonth.from, crossMonth.to)) + '). The importer will use exact dates visible in the current Workday week only.' + (crossMonth.excluded ? ' ' + crossMonth.excluded + ' workbook date(s) were excluded because they are not visible on this page.' : '') + '</div>';
  }

  function showSheetPicker(names) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div'); overlay.className = 'oai-modal-overlay';
      var modal = document.createElement('div'); modal.className = 'oai-modal oai-modal--sheet';
      modal.innerHTML = '<div class="oai-modal-header"><span class="oai-modal-title">Select Worksheet</span><div class="oai-modal-header-right"><button class="oai-sort-btn" id="oai-sheet-sort" type="button" aria-label="Sort worksheets descending" title="Sort worksheets descending"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l4-4 4 4"/><path d="M7 5v14"/><path d="M21 15l-4 4-4-4"/><path d="M17 19V5"/></svg></button><button class="oai-modal-x" id="oai-sheet-x" type="button" aria-label="Close">&times;</button></div></div><div class="oai-sheet-list" id="oai-sheet-list"></div><div class="oai-modal-footer"><button class="oai-btn oai-btn--primary" id="oai-sheet-ok" type="button">Continue</button></div>';
      var list = modal.querySelector('#oai-sheet-list');
      var sortButton = modal.querySelector('#oai-sheet-sort');
      var sortAscending = false;
      var selected = names.length ? names[names.length - 1] : null;

      function renderList() {
        list.innerHTML = '';
        var orderedNames = sortAscending ? names.slice() : names.slice().reverse();
        orderedNames.forEach(function (name) {
          var button = document.createElement('button');
          button.className = 'oai-sheet-item' + (name === selected ? ' oai-sheet-item--selected' : '');
          button.type = 'button';
          button.textContent = name;
          button.addEventListener('click', function () {
            selected = name;
            list.querySelectorAll('.oai-sheet-item').forEach(function (item) { item.classList.remove('oai-sheet-item--selected'); });
            button.classList.add('oai-sheet-item--selected');
          });
          list.appendChild(button);
        });
        sortButton.setAttribute('aria-label', 'Sort worksheets ' + (sortAscending ? 'descending' : 'ascending'));
        sortButton.title = 'Sort worksheets ' + (sortAscending ? 'descending' : 'ascending');
      }

      renderList();
      function close(value) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(value); }
      sortButton.addEventListener('click', function () { sortAscending = !sortAscending; renderList(); });
      modal.querySelector('#oai-sheet-x').addEventListener('click', function () { close(null); });
      modal.querySelector('#oai-sheet-ok').addEventListener('click', function () { close(selected); });
      overlay.appendChild(modal); document.body.appendChild(overlay);
    });
  }

  function showWorkdayReview(entries, stats, crossMonth, meta, workdayOptions) {
    return new Promise(function (resolve) {
      var groups = buildGroups(entries);
      var mappings = new Map(groups.map(function (group) { return [group.key, { timeType: group.timeType || '', projectTask: group.projectTask || '' }]; }));
      var overlay = document.createElement('div'); overlay.className = 'oai-modal-overlay';
      var modal = document.createElement('div'); modal.className = 'oai-modal oai-modal--conf';
      function finish(result) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(result); }
      function readInputs() {
        modal.querySelectorAll('.oai-wd-map-input').forEach(function (input) {
          var group = groups.find(function (item) { return item.id === input.dataset.group; });
          if (!group) return;
          var current = mappings.get(group.key) || {};
          if (input.dataset.field === 'combined') {
            var chosen = (Array.isArray(workdayOptions) ? workdayOptions : []).find(function (option) { return optionPath(option) === input.value; });
            current.timeType = chosen ? chosen.timeType : ''; current.projectTask = chosen ? chosen.projectTask : '';
          } else {
            current[input.dataset.field] = input.value.trim();
          }
          mappings.set(group.key, current);
        });
      }
      var unassignedOnly = _fillTimeNotesOnly;
      var grid = buildGrid(groups, true, mappings, workdayOptions, unassignedOnly);
      var hint = unassignedOnly
        ? 'Default to Unassigned is on. Every entry uses Time Type Unassigned > Unassigned Time > Unassigned; only the hours and comments from the workbook are entered. Project and Task are not matched.'
        : 'Review the workbook data. After you confirm Fill Workday, the importer resolves each row against the live Workday Project Plan Tasks hierarchy; unmatched values use Unassigned.';
      // Compact two-line box like OpenAir's; the full explanation stays in the (i) tooltip.
      var hintHtml = unassignedOnly
        ? 'Default to Unassigned is on<br>- Every entry is Unassigned; only the hours and comments are entered'
        : 'Step 1: Review the table data below - project, task, time, and notes - against your excel workbook<br>&bull; Anything not found in Workday, will be entered as Unassigned';
      modal.innerHTML = '<div class="oai-conf-header"><span class="oai-conf-title-group"><span class="oai-conf-title">Step 1: Review Data</span><span class="oai-info-icon" data-oai-tip="' + esc(hint) + '"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span></span><button class="oai-modal-x" id="oai-wd-x" aria-label="Close">&times;</button></div><div class="oai-conf-inner"><div class="oai-conf-hint-legend-row"><div class="oai-conf-step-hint">' + hintHtml + '</div><div class="oai-conf-right-col">' + (meta.fileName ? '<div class="oai-conf-sheet-label">file name: <strong>' + esc(meta.fileName) + '</strong><br>sheet name: <strong>' + esc(meta.sheetName || '') + '</strong></div>' : '') + '</div></div>' + grid + '</div><div class="oai-conf-actions">' + crossMonthNotice(crossMonth) + '<div class="oai-conf-buttons"><button class="oai-btn oai-btn--primary" id="oai-wd-fill">Fill calendar</button></div></div>';
      attachTooltips(modal);
      // Custom dropdown for the combined Project > Task field: a native <select> cannot show two lines,
      // so the closed control clamps to two lines (ellipsis after that) and the list shows full paths.
      var openCombo = null;
      function closeCombo() {
        if (!openCombo) return;
        if (openCombo.list.parentNode) openCombo.list.parentNode.removeChild(openCombo.list);
        openCombo.button.setAttribute('aria-expanded', 'false');
        openCombo = null;
      }
      function openComboFor(combo) {
        closeCombo();
        var button = combo.querySelector('.oai-combo-btn'), hidden = combo.querySelector('input[type="hidden"]'), text = combo.querySelector('.oai-combo-text');
        var list = document.createElement('div'); list.className = 'oai-combo-list'; list.setAttribute('role', 'listbox');
        var choices = [{ value: '', label: '- will default to unassigned -' }].concat((Array.isArray(workdayOptions) ? workdayOptions : []).map(function (option) { var path = optionPath(option); return { value: path, label: path }; }));
        choices.forEach(function (choice) {
          var item = document.createElement('div'); item.className = 'oai-combo-opt' + (choice.value === hidden.value ? ' is-selected' : '') + (choice.value ? '' : ' oai-combo-opt--empty');
          item.setAttribute('role', 'option'); item.textContent = choice.label;
          item.addEventListener('mousedown', function (event) { event.preventDefault(); });
          item.addEventListener('click', function () {
            hidden.value = choice.value; text.textContent = choice.label; text.classList.toggle('oai-combo-text--empty', !choice.value);
            closeCombo(); button.focus();
          });
          list.appendChild(item);
        });
        overlay.appendChild(list);
        var rect = button.getBoundingClientRect();
        list.style.width = Math.max(rect.width, 260) + 'px';
        var below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
        var maxHeight = Math.min(260, Math.max(below, above));
        list.style.maxHeight = maxHeight + 'px';
        var left = Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 12);
        list.style.left = Math.max(8, left) + 'px';
        if (below >= Math.min(list.scrollHeight, 260) || below >= above) list.style.top = (rect.bottom + 4) + 'px'; else list.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        button.setAttribute('aria-expanded', 'true');
        var selected = list.querySelector('.is-selected'); if (selected) selected.scrollIntoView({ block: 'nearest' });
        openCombo = { list: list, button: button };
      }
      modal.querySelectorAll('.oai-combo').forEach(function (combo) {
        combo.querySelector('.oai-combo-btn').addEventListener('click', function (event) {
          event.stopPropagation();
          if (openCombo && openCombo.button === this) closeCombo(); else openComboFor(combo);
        });
      });
      overlay.addEventListener('click', function (event) { if (openCombo && !openCombo.list.contains(event.target)) closeCombo(); });
      modal.addEventListener('scroll', closeCombo, true);
      overlay.addEventListener('keydown', function (event) { if (event.key === 'Escape' && openCombo) { event.stopPropagation(); closeCombo(); } });
      modal.querySelectorAll('select[data-field="timeType"]').forEach(function (projectSelect) {
        projectSelect.addEventListener('change', function () {
          var taskSelect = Array.from(modal.querySelectorAll('select[data-field="projectTask"]')).find(function (input) {
            return input.dataset.group === projectSelect.dataset.group;
          });
          if (!taskSelect) return;
          var choices = projectTaskChoices(Array.isArray(workdayOptions) ? workdayOptions : [], projectSelect.value);
          var selected = resolveReviewChoice(taskSelect.value, choices);
          taskSelect.innerHTML = selectOptionsHtml('- will default to unassigned -', choices, selected);
        });
      });
      modal.querySelector('#oai-wd-x').addEventListener('click', function () { finish({ confirmed: false }); });
      modal.querySelector('#oai-wd-fill').addEventListener('click', function () { readInputs(); finish({ confirmed: true, mappings: mappings }); });
      overlay.appendChild(modal); document.body.appendChild(overlay);
    });
  }

  // gifs.js is the editable registry (loaded before this script). This one-entry fallback only
  // keeps the scan modal working if that script is ever missing.
  var OAI_GIFS_FALLBACK = [
    { url: 'https://cdn3.emoji.gg/emojis/136245-sneakycat.gif', alt: 'sneakycat', chance: 100 },
  ];
  var _gifWeights = null;
  var _gifWeightsLen = -1;
  function computeGifWeights(list) {
    var pinnedSum = 0;
    var unpinned = [];
    list.forEach(function (gif, index) { if (typeof gif.chance === 'number') pinnedSum += gif.chance; else unpinned.push(index); });
    var budget = Math.max(0, 100 - pinnedSum);
    var weights = list.map(function (gif) { return typeof gif.chance === 'number' ? gif.chance : 0; });
    if (unpinned.length) {
      var random = unpinned.map(function () { return Math.random(); });
      var total = random.reduce(function (sum, value) { return sum + value; }, 0) || 1;
      unpinned.forEach(function (index, randomIndex) { weights[index] = budget * random[randomIndex] / total; });
    }
    return weights;
  }
  function rollGif() {
    var list = ((window.OAI_GIFS && window.OAI_GIFS.length) ? window.OAI_GIFS : OAI_GIFS_FALLBACK).slice();
    if (!list.length) return null;
    if (!_gifWeights || _gifWeightsLen !== list.length) { _gifWeights = computeGifWeights(list); _gifWeightsLen = list.length; }
    var total = _gifWeights.reduce(function (sum, value) { return sum + value; }, 0) || 1;
    var roll = Math.random() * total;
    var cumulative = 0;
    var index = 0;
    for (var i = 0; i < _gifWeights.length; i++) { cumulative += _gifWeights[i]; if (roll < cumulative) { index = i; break; } }
    return { url: list[index].url, alt: list[index].alt || '', chance: typeof list[index].displayChance === 'number' ? list[index].displayChance : Math.ceil(_gifWeights[index] / total * 100) };
  }

  // ── Grab data: scan the user's Project Plan Tasks hierarchy ───────────────
  // Workday builds the Time Type list per user and serves each level only when it is opened
  // (see CLAUDE.md), so it cannot be read from the page. "Grab data" opens Saturday's Enter Time
  // form, walks Project Plan Tasks -> project -> phase -> task through the picker UI WITHOUT
  // selecting anything (selecting a Time Type makes Workday create an entry), then cancels the
  // blank form. The result replaces the saved catalog in chrome.storage.local (Project / Task
  // names only - never workbook contents) and feeds the Step 1 dropdowns.
  var CATALOG_KEY = 'wte_catalog';
  var _catalog = null; // { scannedAt: ms, projects: [{ name, tasks: [{ path, label }] }] }
  var _scanCancelled = false;
  var _scanRunning = false;
  var _lastPickerClick = '';

  // Small "last data pull mm/dd/yy" note under the Grab data button (hidden until a pull exists).
  function updateGrabSub() {
    var sub = document.getElementById('oai-grab-sub');
    if (!sub) return;
    if (!_catalog || !_catalog.scannedAt) { sub.hidden = true; sub.textContent = ''; return; }
    var d = new Date(_catalog.scannedAt);
    var two = function (n) { return String(n).padStart(2, '0'); };
    sub.textContent = 'prev data grab ';
    var when = document.createElement('strong');
    when.textContent = two(d.getMonth() + 1) + '/' + two(d.getDate()) + '/' + two(d.getFullYear() % 100);
    sub.appendChild(when);
    sub.hidden = false;
  }

  function loadCatalog() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([CATALOG_KEY], function (result) { _catalog = result && result[CATALOG_KEY] || null; updateGrabSub(); });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes[CATALOG_KEY]) { _catalog = changes[CATALOG_KEY].newValue || null; updateGrabSub(); }
    });
  }

  // Flat options for the review dropdowns: Project = first level under Project Plan Tasks,
  // Task = the remaining path ("Phase > Task"), in the order Workday listed them.
  function catalogOptions() {
    var options = [];
    ((_catalog && _catalog.projects) || []).forEach(function (project) {
      (project.tasks || []).forEach(function (task) {
        options.push({ timeType: project.name, projectTask: task.label, label: task.label, path: task.path });
      });
    });
    return options;
  }

  function pickerLabel(item) { return menuLabel(item).replace(/\s+/g, ' ').trim(); }
  function pickerItems() {
    return visiblePickerItems().map(function (item) { return { element: item, label: pickerLabel(item), role: item.getAttribute('role') }; });
  }
  function pickerSignatureNow() {
    return pickerItems().map(function (item) { return item.role + ':' + item.label; }).sort().join('\u001f');
  }
  // A level is ready when it is non-empty, different from `previous`, and unchanged on two polls
  // (the picker is briefly empty after a click and renders in stages).
  async function waitForPickerLevel(previous, timeoutMs) {
    var stable = '';
    for (var elapsed = 0; elapsed < timeoutMs; elapsed += WORKDAY_TIMINGS.pollMs) {
      var signature = pickerSignatureNow();
      if (signature && signature !== previous) {
        if (signature === stable) return true;
        stable = signature;
      } else {
        stable = '';
      }
      await delay(WORKDAY_TIMINGS.pollMs);
    }
    return false;
  }
  function pickerScroller() {
    var first = visiblePickerItems()[0];
    for (var node = first && first.parentElement; node && node !== document.body; node = node.parentElement) {
      var overflow = window.getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return resultScroller();
  }
  // Every item of the current level, scrolling the (virtualized) list top to bottom.
  async function listPickerLevel() {
    var seen = new Map();
    function harvest() {
      pickerItems().forEach(function (item) {
        var key = item.role + '|' + item.label;
        if (item.label && !seen.has(key)) seen.set(key, { label: item.label, role: item.role });
      });
    }
    harvest();
    var scroller = pickerScroller();
    if (scroller) {
      scroller.scrollTop = 0;
      await delay(200);
      harvest();
      for (var step = 0; step < 60; step++) {
        var before = scroller.scrollTop;
        scroller.scrollTop = before + Math.max(40, scroller.clientHeight - 30);
        await delay(250);
        harvest();
        if (scroller.scrollTop === before) break;
      }
      scroller.scrollTop = 0;
      await delay(200);
    }
    return Array.from(seen.values());
  }
  // Click one picker item by label, scrolling it into view first and clicking only when the
  // topmost element at its centre is inside it (same rule as selecting a result).
  async function clickPickerItem(label, role) {
    var scroller = pickerScroller();
    if (scroller) { scroller.scrollTop = 0; await delay(200); }
    function find() { return pickerItems().find(function (item) { return item.label === label && item.role === role; }) || null; }
    for (var attempt = 0; attempt < 40; attempt++) {
      var found = find();
      if (found) {
        found.element.scrollIntoView({ block: 'center' });
        await delay(250);
        found = find();
        if (found) {
          var rect = found.element.getBoundingClientRect();
          var px = Math.round(rect.left + rect.width / 2), py = Math.round(rect.top + rect.height / 2);
          // Look through the extension's own UI (e.g. the scan box can float over the lower picker rows,
          // measured live): click the topmost PAGE element at the point, never the extension.
          var hit = document.elementsFromPoint(px, py).find(function (node) { return !(node.closest && node.closest('[class*="oai-"]')); }) || null;
          var other = hit && hit.closest ? hit.closest('[role="menuitem"],[role="menuitemradio"]') : null;
          // Accept the item itself, its wrapper, or anything that is not a DIFFERENT picker item.
          if (hit && (found.element.contains(hit) || hit.contains(found.element) || !other || other === found.element)) {
            _lastPickerClick = (hit.getAttribute('data-automation-id') || hit.tagName) + ' @' + px + ',' + py;
            activateWorkdayControl(found.element, true, found.element.contains(hit) ? hit : (found.element.querySelector('[data-automation-id="promptOption"]') || found.element));
            return true;
          }
        }
      } else if (scroller) {
        var before = scroller.scrollTop;
        scroller.scrollTop = before + Math.max(40, scroller.clientHeight - 30);
        await delay(250);
        if (scroller.scrollTop === before && !find()) return false;
      } else {
        return false;
      }
    }
    return false;
  }
  function pickerBackHeader() {
    return Array.from(document.querySelectorAll('[data-automation-id="multiSelectHeader"]')).find(isVisible) || null;
  }
  // True when every visible picker item belongs to `labels` (the items listed for that level)
  // and the view is not the child level we just left (`childSignature`).
  function pickerShowsLevel(labels, childSignature) {
    var items = pickerItems();
    if (!items.length || pickerSignatureNow() === childSignature) return false;
    return items.every(function (item) { return labels.has(item.label); });
  }
  // One click on the back header, then wait for the parent level. NEVER click it again once the
  // parent is showing: at the project list the header reads "Project Plan Tasks", and a second
  // click backs out to the Time Type root (measured live). Retry only if nothing changed.
  async function pickerBack(parentLabels) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var header = pickerBackHeader();
      if (!header) return !parentLabels || pickerShowsLevel(parentLabels, null);
      var child = pickerSignatureNow();
      activateWorkdayControl(header, false);
      for (var waited = 0; waited < WORKDAY_TIMINGS.menuTimeoutMs; waited += WORKDAY_TIMINGS.pollMs) {
        await delay(WORKDAY_TIMINGS.pollMs);
        if (!parentLabels) { if (pickerSignatureNow() !== child) { await delay(WORKDAY_TIMINGS.submenuSettleMs); return true; } continue; }
        if (pickerShowsLevel(parentLabels, child)) { await delay(300); if (pickerShowsLevel(parentLabels, child)) return true; }
      }
      if (pickerSignatureNow() !== child) return false; // changed, but not to the expected level: do not click again
    }
    return false;
  }

  function scanLeaf(stack, label) {
    var path = / > /.test(label) ? label : stack.concat(label).join(' > ');
    var parts = path.split(/\s*>\s*/);
    return { project: parts[0], task: { path: path, label: parts.length > 1 ? parts.slice(1).join(' > ') : parts[0] } };
  }

  // Depth-first: for each submenu click in, recurse, click the picker's own back header, continue.
  async function walkPickerLevel(stack, state) {
    if (stack.length > 6) return;
    var entries = await listPickerLevel();
    var levelLabels = new Set(entries.map(function (e) { return e.label; }));
    if (stack.length === 0) { state.totalProjects = entries.filter(function (e) { return e.role !== 'menuitemradio'; }).length || entries.length; if (state.onStart) state.onStart(state.totalProjects); }
    for (var i = 0; i < entries.length; i++) {
      if (_scanCancelled) throw new Error('Scan cancelled.');
      var entry = entries[i];
      if (entry.role === 'menuitemradio') {
        var leaf = scanLeaf(stack, entry.label);
        var project = state.byProject.get(leaf.project);
        if (!project) { project = { name: leaf.project, tasks: [] }; state.byProject.set(leaf.project, project); state.projects.push(project); }
        if (!project.tasks.some(function (task) { return task.path === leaf.task.path; })) project.tasks.push(leaf.task);
        continue;
      }
      var opened = false, reason = 'could not be opened';
      for (var attempt = 0; attempt < 2 && !opened; attempt++) {
        if (!pickerShowsLevel(levelLabels, null)) await pickerBack(levelLabels);
        var before = pickerSignatureNow();
        state.lastClick = _lastPickerClick;
        if (!await clickPickerItem(entry.label, entry.role)) { reason = 'could not be found in the list'; continue; }
        state.lastClick = _lastPickerClick;
        if (!await waitForPickerLevel(before, WORKDAY_TIMINGS.menuTimeoutMs)) { reason = 'did not load'; continue; }
        opened = true;
      }
      if (opened) {
        await walkPickerLevel(stack.concat(entry.label), state);
        if (!await pickerBack(levelLabels)) {
          state.warnings.push('"' + entry.label + '": could not return to the previous list; scan stopped.');
          if (stack.length === 0) state.doneProjects++;
          throw new Error('The picker did not go back after "' + entry.label + '". Scan stopped; ' + state.projects.length + ' project(s) were read.');
        }
      } else {
        state.warnings.push('"' + entry.label + '" ' + reason + ' [header: ' + ((pickerBackHeader() && pickerLabel(pickerBackHeader())) || 'none') + '; visible: ' + pickerItems().slice(0, 3).map(function (item) { return item.label.slice(0, 30); }).join(' | ') + '; last click: ' + (state.lastClick || 'n/a') + '].');
      }
      if (stack.length === 0) { state.doneProjects++; state.onProgress(state.doneProjects, state.totalProjects, entry.label); }
    }
  }

  // Leave the picker and the blank form without selecting anything, answering the
  // "Discard Changes?" prompt only if Workday raises it.
  async function closeScanDialog(dialog) {
    for (var i = 0; i < 8 && pickerBackHeader(); i++) { if (!await pickerBack()) break; }
    var input = findTimeTypeInput(dialog);
    if (input && visiblePickerItems().length) {
      var escape = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent('keydown', escape));
      input.dispatchEvent(new KeyboardEvent('keyup', escape));
      await delay(WORKDAY_TIMINGS.selectionSettleMs);
    }
    if (getEnterTimeDialog()) await cancelWorkdayEntry(getEnterTimeDialog() || dialog);
    await delay(WORKDAY_TIMINGS.selectionSettleMs);
    if (getEnterTimeDialog()) throw new Error('The Enter Time form could not be closed after the scan. Close it manually (Cancel) and refresh Workday.');
  }

  async function scanProjectPlans(onProgress, onStart) {
    var week = readWorkdayWeek();
    if (!week) throw new Error('The Enter Time calendar was not detected. Open the weekly Enter Time page first.');
    if (getEnterTimeDialog()) throw new Error('An Enter Time form is already open. Cancel it, then click Grab data again.');
    var state = { projects: [], byProject: new Map(), warnings: [], totalProjects: 0, doneProjects: 0, onProgress: onProgress, onStart: onStart };
    var dialog = await openWorkdayEntry(6, week.dates[6]); // Saturday
    var failure = null;
    try {
      var input = await waitForVisibleTimeTypeInput(dialog);
      if (!input) throw new Error('Workday Time Type field was not found.');
      activateWorkdayControl(input, false);
      await delay(WORKDAY_TIMINGS.timeTypeClickSettleMs);
      if (!await waitForPickerLevel('', WORKDAY_TIMINGS.menuTimeoutMs)) throw new Error('The Time Type list did not open.');
      var root = pickerItems().find(function (item) { return normalise(item.label) === 'project plan tasks'; });
      if (!root) throw new Error('"Project Plan Tasks" was not found in the Time Type list.');
      var rootSignature = pickerSignatureNow();
      if (!await clickPickerItem(root.label, root.role)) throw new Error('Could not open "Project Plan Tasks".');
      if (!await waitForPickerLevel(rootSignature, WORKDAY_TIMINGS.menuTimeoutMs)) throw new Error('"Project Plan Tasks" did not load.');
      await walkPickerLevel([], state);
    } catch (error) {
      failure = error;
    }
    var closeError = null;
    try { await closeScanDialog(dialog); } catch (error) { closeError = error; }
    if (failure) throw failure;
    if (closeError) throw closeError;
    if (!state.projects.length) throw new Error('No Projects were found under Project Plan Tasks.');
    var needsRefresh = calendarLayout() === 'legacy' && !!getEnterTimeAppointment();
    return { scannedAt: Date.now(), projects: state.projects, warnings: state.warnings, needsRefresh: needsRefresh };
  }

  function formatDuration(ms) {
    var seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return seconds + ' sec';
    return Math.floor(seconds / 60) + ' min ' + String(seconds % 60).padStart(2, '0') + ' sec';
  }

  // Scan progress box: panel-sized, floats just left of the importer panel and never covers
  // the page (a full-screen overlay would block the picker clicks the scan performs).
  // The gif is rolled and preloaded ahead of time so it is already cached when a scan starts.
  var _scanGif = null;
  function prepareScanGif() {
    _scanGif = rollGif();
    if (_scanGif) { var image = new Image(); image.decoding = 'async'; image.src = _scanGif.url; _scanGif.image = image; }
  }

  // Estimate before measuring: ~9 s per project (open submenu, scroll/harvest its phases and tasks, back).
  // After two projects the measured pace replaces the guess.
  var SCAN_GUESS_PER_PROJECT_MS = 14000; // measured live: ~13 s per project (8 projects, 56 tasks ≈ 105 s)
  var SCAN_BUFFER = 1.25;               // padding so the estimate errs long, not short
  var SCAN_FIXED_MS = 10000;            // opening the form, the picker and closing it again
  function etaText(remainingMs) {
    var seconds = Math.ceil(remainingMs / 1000);
    if (seconds <= 0) return 'Almost done…';
    if (seconds <= 15) return 'Estimate: ' + seconds + ' sec';
    if (seconds <= 60) return 'Estimate: under 1 minute';
    var minutes = Math.ceil(seconds / 60);
    return 'Estimate: ' + minutes + ' minute' + (minutes === 1 ? '' : 's');
  }

  function showScanModal() {
    if (!_scanGif) prepareScanGif();
    var picked = _scanGif;
    var box = document.createElement('div'); box.className = 'oai-modal--completion oai-scan-box';
    box.innerHTML = '<div class="oai-conf-header"><span class="oai-conf-title">Grab data</span></div>' +
      '<div class="oai-scan-body">' +
        '<div class="oai-scan-msg">Scanning your Project Plans…</div>' +
        '<div class="oai-scan-gif" id="oai-scan-gif"></div>' +
        '<div class="oai-gif-chance" id="oai-scan-chance"></div>' +
        '<div class="oai-scan-bar"><div class="oai-scan-bar-fill" id="oai-scan-fill"></div></div>' +
        '<div class="oai-scan-eta" id="oai-scan-eta">Estimate: calculating…</div>' +
      '</div>' +
      '<div class="oai-scan-actions"><button class="oai-btn oai-btn--secondary" id="oai-scan-cancel">Cancel</button></div>';
    document.body.appendChild(box);
    var holder = box.querySelector('#oai-scan-gif');
    if (picked && picked.image) {
      var show = function () {
        if (holder.dataset.done) return;
        holder.dataset.done = '1';
        var img = document.createElement('img'); img.className = 'oai-gif-img'; img.alt = picked.alt; img.src = picked.url;
        holder.appendChild(img);
        box.querySelector('#oai-scan-chance').textContent = 'this gif had a ' + picked.chance + '% chance of appearing!';
      };
      if (picked.image.complete && picked.image.naturalWidth) show();
      else { holder.innerHTML = '<span class="oai-spinner oai-spinner--lg"></span>'; picked.image.addEventListener('load', function () { holder.innerHTML = ''; show(); }); picked.image.addEventListener('error', function () { holder.innerHTML = ''; }); }
    }
    var startedAt = Date.now(), total = 0, done = 0, doneAt = Date.now(), endsAt = 0;
    var eta = box.querySelector('#oai-scan-eta'), fill = box.querySelector('#oai-scan-fill');
    function recompute() {
      if (!total) return;
      var remainingProjects = Math.max(0, total - done);
      var perProject = done >= 2 ? (doneAt - startedAt) / done : SCAN_GUESS_PER_PROJECT_MS;
      endsAt = doneAt + (remainingProjects * perProject * SCAN_BUFFER) + (done ? 0 : SCAN_FIXED_MS);
    }
    var timer = setInterval(function () {
      if (!total) return;
      eta.textContent = done >= total ? 'Finishing up…' : etaText(Math.max(0, endsAt - Date.now()));
    }, 1000);
    box.querySelector('#oai-scan-cancel').addEventListener('click', function () { _scanCancelled = true; this.disabled = true; this.textContent = 'Cancelling…'; });
    return {
      start: function (count) { total = count; startedAt = doneAt = Date.now(); recompute(); eta.textContent = etaText(Math.max(0, endsAt - Date.now())); },
      progress: function (completed, count) {
        total = count || total; done = completed; doneAt = Date.now(); recompute();
        if (total) fill.style.width = Math.min(100, Math.round(done / total * 100)) + '%';
        eta.textContent = done >= total ? 'Finishing up…' : etaText(Math.max(0, endsAt - Date.now()));
      },
      close: function () { clearInterval(timer); if (box.parentNode) box.parentNode.removeChild(box); prepareScanGif(); },
    };
  }

  async function runGrabData() {
    if (_scanRunning) return;
    _scanRunning = true; _scanCancelled = false;
    var buttons = document.querySelectorAll('#oai-grab-btn, #oai-dl-btn');
    buttons.forEach(function (button) { button.disabled = true; });
    var modal = null;
    try {
      clearStatus();
      modal = showScanModal();
      var result = await scanProjectPlans(modal.progress, modal.start);
      await new Promise(function (resolve, reject) {
        chrome.storage.local.set({ wte_catalog: { scannedAt: result.scannedAt, projects: result.projects } }, function () {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
        });
      });
      modal.close(); modal = null;
      var taskCount = result.projects.reduce(function (sum, project) { return sum + project.tasks.length; }, 0);
      setStatus('Saved ' + result.projects.length + ' Projects and ' + taskCount + ' Tasks. They now fill the Step 1 dropdowns.' +
        (result.needsRefresh ? ' Refresh Workday before importing (this calendar leaves a placeholder after the scan).' : '') +
        (result.warnings.length ? ' ' + result.warnings.length + ' item(s) could not be read: ' + esc(result.warnings.slice(0, 3).join(' ')) + (result.warnings.length > 3 ? ' …' : '') : ''), result.needsRefresh || result.warnings.length ? 'warning' : 'success');
      // The plain success note clears itself after 7 s; warnings and errors stay until the next action.
      if (!result.needsRefresh && !result.warnings.length) {
        var savedMessage = panelStatus && panelStatus.innerHTML;
        setTimeout(function () { if (panelStatus && panelStatus.innerHTML === savedMessage) clearStatus(); }, 7000);
      }
    } catch (error) {
      if (modal) modal.close();
      setStatus(esc(error.message || 'Grab data failed.'), _scanCancelled ? 'warning' : 'error');
    } finally {
      _scanRunning = false;
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function showCompletionModal(results) {
    return new Promise(function (resolve) {
      var failed = results && results.failed || [];
      var cancelledNote = results && results.cancelled ? '<p class="oai-completion-msg">Import cancelled. No additional entries were started.</p>' : '';
      var fallbackEntries = results && results.fallbackEntries || [];
      // Everything diagnostic lives behind "See Logs"; the Complete modal stays clean. The button is
      // hidden when nothing needs reviewing (no failures and no Unassigned fallbacks).
      var fallbackHtml = fallbackEntries.length ? '<div class="oai-audit"><div class="oai-audit-title">Unassigned Fallback</div><div class="oai-audit-summary">' + esc(fallbackEntries.length + (fallbackEntries.length === 1 ? ' entry' : ' entries') + ' entered as ' + WORKDAY_FALLBACK_PATH) + '</div><div class="oai-audit-scroll"><table class="oai-audit-table"><thead><tr><th>Day</th><th>Expected</th><th>Actual</th><th>Notes</th></tr></thead><tbody>' + fallbackEntries.map(function (item) { return '<tr><td>' + esc(item.day) + '</td><td>' + esc(item.expected) + '</td><td>' + esc(item.actual) + '</td><td>' + esc(item.note) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
      var auditHtml = failed.length ? '<div class="oai-audit oai-audit--panel" id="oai-audit-panel"><div class="oai-audit-title">Audit Log</div><div class="oai-audit-scroll"><table class="oai-audit-table"><thead><tr><th>Day</th><th>Project</th><th>Issue</th></tr></thead><tbody>' + failed.map(function (item) { return '<tr><td>' + esc(item.day) + '</td><td>' + esc(item.client) + '</td><td class="oai-audit-reason">' + esc(item.reason) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
      var failedNote = failed.length ? '<div class="oai-audit-callout" role="alert"><strong>' + esc(failed.length + (failed.length === 1 ? ' entry' : ' entries') + ' could not be entered.') + '</strong> Review your Workday timesheet and enter ' + (failed.length === 1 ? 'it' : 'them') + ' manually or re-run the import.</div>' : '';
      var hasLogs = failed.length > 0 || fallbackEntries.length > 0;
      var overlay = document.createElement('div'); overlay.className = 'oai-modal-overlay';
      var modal = document.createElement('div'); modal.className = 'oai-modal oai-modal--completion';
      modal.innerHTML = '<div class="oai-conf-header"><span class="oai-conf-title">Complete</span></div><div class="oai-completion-body"><div class="oai-completion-icon"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><p class="oai-completion-msg"><strong>thank you for using the extension</strong></p><p class="oai-completion-msg">Workday entry processing finished. Review the calendar before submitting.</p>' + cancelledNote + '</div><div class="oai-conf-actions">' + (hasLogs ? '<button class="oai-btn oai-btn--secondary" id="oai-see-logs" type="button">See Logs</button>' : '') + '<div class="oai-conf-buttons"><button class="oai-btn oai-btn--primary" id="oai-done-close">Close</button></div></div>';
      overlay.appendChild(modal); document.body.appendChild(overlay);
      var logsButton = modal.querySelector('#oai-see-logs');
      if (logsButton) logsButton.addEventListener('click', function () {
        var logsOverlay = document.createElement('div'); logsOverlay.className = 'oai-modal-overlay';
        var logsModal = document.createElement('div'); logsModal.className = 'oai-modal oai-modal--completion oai-modal--completion-wide';
        logsModal.innerHTML = '<div class="oai-conf-header"><span class="oai-conf-title">Logs</span></div><div class="oai-completion-body">' + failedNote + fallbackHtml + auditHtml + '</div><div class="oai-conf-actions"><div class="oai-conf-buttons"><button class="oai-btn oai-btn--primary" id="oai-logs-close" type="button">Close</button></div></div>';
        logsOverlay.appendChild(logsModal); document.body.appendChild(logsOverlay);
        logsModal.querySelector('#oai-logs-close').addEventListener('click', function () { if (logsOverlay.parentNode) logsOverlay.parentNode.removeChild(logsOverlay); });
      });
      modal.querySelector('#oai-done-close').addEventListener('click', function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(); });
    });
  }
  async function handleFile(file) {
    if (!file || !/\.xlsx$/i.test(file.name || '')) { setStatus('Only <strong>.xlsx</strong> files are supported.', 'error'); return; }
    try {
      clearStatus();
      var workbookBuffer = await file.arrayBuffer();
      // This workbook can contain a long history of weekly tabs. Reading only the
      // workbook index lets Select Worksheet appear without inflating every sheet
      // first; full parsing is deferred until the user picks one tab.
      var workbookIndex = XLSX.read(workbookBuffer, { type: 'array', bookSheets: true });
      var sheetName = await showSheetPicker(workbookIndex.SheetNames);
      if (!sheetName) { clearStatus(); return; }
      setStatus('<span class="oai-spinner"></span> Reading selected worksheet and Workday calendar…', 'info');
      var workbook = XLSX.read(workbookBuffer, { type: 'array', cellDates: true, sheets: [sheetName] });
      var parsed = parseSheet(workbook, sheetName);
      var pageWeek = readWorkdayWeek();
      if (!pageWeek) throw new Error('Workday calendar dates were not detected. Make sure the weekly Enter Time calendar is open.');
      // Like the OpenAir importer, fill whatever week is open: each Sunday-Saturday column maps to
      // the date Workday renders in that position. The worksheet name is NOT used to pick the week
      // (passing null disables the sheet-week mapping), so a sheet for another week is not blocked.
      var prepared = window.WTE_DATES.filterEntriesToWeek(parsed.entries, pageWeek, null);
      if (!prepared.entries.length) {
        throw new Error('Worksheet "' + sheetName + '" has no entries with hours or comments to enter.');
      }
      var crossMonth = crossMonthInfo(pageWeek, prepared);
      var uniqueKeys = new Set(prepared.entries.map(function (entry) { return entry.groupKey; }));
      var stats = { entries: prepared.entries.length, dataRows: uniqueKeys.size, skippedCells: parsed.skippedCells, excluded: prepared.excluded.length };
      clearStatus();
      // Match OpenAir's responsive flow: parsing opens Review Data immediately.
      // Workday's nested, asynchronous picker is resolved only after confirmation,
      // for the entry being written—not by cataloging the user's entire hierarchy.
      var review = await showWorkdayReview(prepared.entries, stats, crossMonth, { fileName: file.name, sheetName: sheetName }, catalogOptions());
      if (!review.confirmed) { clearStatus(); return; }
      _cancelWorkdayImport = false;
      setStatus('<span class="oai-status-progress"><span class="oai-spinner"></span> Entering Workday time…</span><button type="button" class="oai-status-cancel" id="oai-cancel-import">Cancel</button>', 'info');
      var cancelButton = panelStatus && panelStatus.querySelector('#oai-cancel-import');
      if (cancelButton) cancelButton.addEventListener('click', function () {
        _cancelWorkdayImport = true;
        cancelButton.disabled = true;
        cancelButton.textContent = 'Cancelling…';
      });
      var results;
      results = await fillWorkdayEntries(prepared.entries, review.mappings, pageWeek);
      clearStatus(); await showCompletionModal(results);
    } catch (error) { setStatus(esc(error.message || error), 'error'); }
  }

  // Hide/show the importer panel with a slide (CSS transitions). Kept in memory only.
  var _panelHidden = false;
  function setPanelHidden(hidden) {
    _panelHidden = hidden;
    var panel = document.getElementById('oai-panel'), restore = document.getElementById('oai-restore');
    if (panel) panel.classList.toggle('oai-panel--hidden', hidden);
    if (restore) restore.classList.toggle('is-visible', hidden);
  }

  function createPanel() {
    if (document.getElementById('oai-panel')) return;
    var panel = document.createElement('div'); panel.id = 'oai-panel';
    panel.innerHTML = '<div class="oai-header"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v2"/><path d="M15.726 21.01A2 2 0 0 1 14 22H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2"/><path d="M18 2v2"/><path d="M2 13h2"/><path d="M8 8h14"/><rect x="8" y="3" width="14" height="14" rx="2"/></svg><span class="oai-title">Workday Time Importer</span><button type="button" class="oai-hide-btn" id="oai-hide-btn" data-tip="Hide panel" aria-label="Hide panel"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m8 14 4-4 4 4"/></svg></button></div><div class="oai-body"><div class="oai-dropzone" id="oai-dz" tabindex="0" role="button" aria-label="Drop .xlsx or click to browse"><div class="oai-dropzone-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div class="oai-dropzone-text">Drop <strong>.xlsx</strong> here</div><div class="oai-dz-sub">or click to browse</div><div class="oai-dz-sub oai-dz-sub--cols">Columns: Project, Task, [day] time, [day] notes</div><input type="file" id="oai-file-input" accept=".xlsx" style="display:none"></div><div class="oai-btn-row"><div class="oai-grab-wrap"><button class="oai-btn--download oai-btn--grab" id="oai-grab-btn" title="Scan your Project Plans in Workday and save them for the Step 1 dropdowns"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.693V5"/><path d="m22 22-1.875-1.875"/><path d="M3 12a9 3 0 0 0 8.697 2.998"/><path d="M3 5v14a9 3 0 0 0 9.28 2.999"/><circle cx="18" cy="18" r="3"/><ellipse cx="12" cy="5" rx="9" ry="3"/></svg><span>Grab data</span></button><div class="oai-grab-sub" id="oai-grab-sub" hidden></div></div><button class="oai-btn--download oai-btn--dl" id="oai-dl-btn"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16"/><path d="M6 22h2"/><path d="M7 14v8"/></svg><span>Download template</span></button></div><div class="oai-status" id="oai-status" aria-live="polite"></div></div>';
    // Restore tab shown where the panel's bottom-right corner is while the panel is slid away.
    var restore = document.createElement('button'); restore.type = 'button'; restore.id = 'oai-restore';
    restore.setAttribute('data-tip', 'Show panel'); restore.setAttribute('aria-label', 'Show panel');
    restore.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m8 14 4-4 4 4"/></svg>';
    if (_panelHidden) { panel.classList.add('oai-panel--hidden'); restore.classList.add('is-visible'); }
    document.body.appendChild(panel); document.body.appendChild(restore); panelStatus = panel.querySelector('#oai-status');
    panel.querySelector('#oai-hide-btn').addEventListener('click', function () { setPanelHidden(true); });
    restore.addEventListener('click', function () { setPanelHidden(false); });
    var dropzone = panel.querySelector('#oai-dz'); var fileInput = panel.querySelector('#oai-file-input');
    dropzone.addEventListener('dragover', function (event) { event.preventDefault(); dropzone.classList.add('oai-dz--active'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('oai-dz--active'); });
    dropzone.addEventListener('drop', function (event) { event.preventDefault(); dropzone.classList.remove('oai-dz--active'); if (event.dataTransfer.files[0]) handleFile(event.dataTransfer.files[0]); });
    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) handleFile(fileInput.files[0]); fileInput.value = ''; });
    panel.querySelector('#oai-grab-btn').addEventListener('click', runGrabData);
    updateGrabSub();
    prepareScanGif();
    panel.querySelector('#oai-dl-btn').addEventListener('click', function () { var link = document.createElement('a'); link.href = chrome.runtime.getURL('template.xlsx'); link.download = 'Workday time template.xlsx'; link.click(); });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (message.action === 'ping') { sendResponse({ ok: true, isTimesheetPage: isWorkdayTimesheetPage() }); return false; }
      if (message.action === 'applyTheme') { applyContentTheme(message.color, message.mode); sendResponse({ ok: true }); return false; }
    });
  }
  loadCatalog();
  function init() {
    var timer = null;
    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () { scheduled = false; ensurePanel(); }, 150);
    });
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      observer.disconnect();
    }
    function ensurePanel() {
      if (!isWorkdayTimesheetPage()) {
        // Workday navigates between Time pages through SPA transitions that stay under
        // /connorgp/. Remove the panel whenever the Enter Time calendar is not showing, but keep
        // the observer/timer alive so the panel returns when the calendar renders.
        var existing = document.getElementById('oai-panel');
        if (existing) existing.remove();
        var existingRestore = document.getElementById('oai-restore');
        if (existingRestore) existingRestore.remove();
        panelStatus = null;
        return;
      }
      createPanel();
    }
    ensurePanel();
    // Workday's initial SPA render can replace the calendar after document_idle. Use
    // both mutation-driven retries and a low-frequency fallback until the task stabilizes.
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timer = setInterval(ensurePanel, 1000);
    window.addEventListener('pagehide', stop, { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
