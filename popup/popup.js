// popup.js - Workday Time Entry Importer popup

(function () {
  'use strict';

  // Init
  async function init() {
    document.getElementById('downloadBtn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href     = chrome.runtime.getURL('template.xlsx');
      a.download = 'Timesheet template v1.2.xlsx';
      a.click();
    });

    document.getElementById('downloadExampleBtn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href     = chrome.runtime.getURL('example.xlsx');
      a.download = '11.2026 Example.xlsx';
      a.click();
    });

    // "View saved Workday data": slides a second view over the main one. The header and footer
    // stay put; only the area between them animates. (Content is intentionally blank for now.)
    var views = document.getElementById('oai-views');
    var mainView = document.getElementById('v-main');
    var dataView = document.getElementById('v-data');
    function showDataView(open) {
      views.classList.toggle('is-data', open);
      if (open) { mainView.setAttribute('inert', ''); dataView.removeAttribute('inert'); }
      else { dataView.setAttribute('inert', ''); mainView.removeAttribute('inert'); }
    }
    // Saved Grab data catalog: one "Project > Phase > Task" line per saved task, or a hint if none.
    var CATALOG_KEY = 'wte_catalog';
    var catalogProjects = [];
    var openProjects = new Set(); // expanded project names (everything starts collapsed)
    var filterInput = document.getElementById('oai-data-filter');
    var filterRow = document.getElementById('oai-data-filter-row');

    // Draw the grouped list for the current filter. A project whose name matches shows all its tasks;
    // otherwise only its matching tasks show. "#" keeps each task's position within its project.
    function renderList() {
      var list = document.getElementById('oai-data-list');
      var counts = document.getElementById('oai-data-counts');
      var query = (filterInput.value || '').trim().toLowerCase();
      list.textContent = '';
      var shownProjects = 0, shownTasks = 0;
      catalogProjects.forEach(function (project) {
        var projectMatch = !query || project.name.toLowerCase().indexOf(query) >= 0;
        var rows = [];
        project.tasks.forEach(function (task, index) {
          if (projectMatch || task.label.toLowerCase().indexOf(query) >= 0) rows.push({ task: task, number: index + 1 });
        });
        if (!rows.length) return;
        shownProjects++; shownTasks += rows.length;
        var group = document.createElement('div'); group.className = 'data-group';
        var head = document.createElement('div'); head.className = 'data-group-head'; head.textContent = project.name;
        group.appendChild(head);
        // Collapsed by default. While filtering by task text, groups that matched only through their
        // tasks open so the hits are visible.
        var open = openProjects.has(project.name) || (!!query && !projectMatch);
        var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'data-toggle';
        toggle.setAttribute('aria-expanded', String(open));
        var count = document.createElement('span'); count.className = 'data-toggle-count';
        count.textContent = rows.length + (rows.length === 1 ? ' task' : ' tasks');
        var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('width', '12'); chevron.setAttribute('height', '12');
        chevron.setAttribute('fill', 'none'); chevron.setAttribute('stroke', 'currentColor'); chevron.setAttribute('stroke-width', '2.5');
        chevron.setAttribute('stroke-linecap', 'round'); chevron.setAttribute('stroke-linejoin', 'round'); chevron.setAttribute('aria-hidden', 'true');
        chevron.setAttribute('class', 'data-toggle-chevron');
        var chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); chevronPath.setAttribute('d', 'm6 9 6 6 6-6');
        chevron.appendChild(chevronPath);
        var rule = document.createElement('span'); rule.className = 'data-toggle-rule';
        toggle.appendChild(count); toggle.appendChild(chevron); toggle.appendChild(rule);
        toggle.addEventListener('click', function () {
          if (openProjects.has(project.name)) openProjects.delete(project.name); else openProjects.add(project.name);
          renderList();
        });
        group.appendChild(toggle);
        if (open) {
          // Tasks are saved as "Phase > Task": show each phase once as a sub-heading with its tasks beneath.
          var lastPhase = null;
          rows.forEach(function (item) {
            var parts = item.task.label.split(/\s*>\s*/);
            var phase = parts.length > 1 ? parts.slice(0, -1).join(' > ') : '';
            var name = parts[parts.length - 1];
            if (phase !== lastPhase) {
              lastPhase = phase;
              if (phase) { var phaseHead = document.createElement('div'); phaseHead.className = 'data-phase'; phaseHead.textContent = phase; group.appendChild(phaseHead); }
            }
            var row = document.createElement('div'); row.className = 'data-row';
            var num = document.createElement('span'); num.className = 'data-num'; num.textContent = String(item.number);
            var label = document.createElement('span'); label.className = 'data-label'; label.textContent = name;
            row.appendChild(num); row.appendChild(label);
            group.appendChild(row);
          });
        }
        list.appendChild(group);
      });
      counts.textContent = shownProjects + (shownProjects === 1 ? ' project' : ' projects') + ' \u00b7 ' + shownTasks + (shownTasks === 1 ? ' task' : ' tasks');
      if (!shownProjects) {
        var none = document.createElement('div'); none.className = 'data-empty'; none.textContent = 'No projects or tasks match your filter.';
        list.appendChild(none);
      }
    }
    filterInput.addEventListener('input', renderList);
    document.getElementById('oai-data-expand-all').addEventListener('click', function () {
      catalogProjects.forEach(function (project) { openProjects.add(project.name); });
      renderList();
    });
    document.getElementById('oai-data-collapse-all').addEventListener('click', function () { openProjects.clear(); renderList(); });

    // " PST" / " PDT": the user's local timezone as an abbreviation (en-US short names; other zones fall back to GMT+n).
    function zoneSuffix(date) {
      try {
        var part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date)
          .find(function (p) { return p.type === 'timeZoneName'; });
        if (part) return ' ' + part.value;
      } catch (e) { /* no zone text */ }
      return '';
    }

    function renderCatalog(catalog) {
      var list = document.getElementById('oai-data-list');
      var asOf = document.getElementById('oai-data-asof');
      catalogProjects = ((catalog && catalog.projects) || []).filter(function (p) { return p.tasks && p.tasks.length; });
      if (!catalogProjects.length) {
        list.textContent = '';
        asOf.hidden = true; asOf.textContent = '';
        filterRow.hidden = true;
        document.getElementById('oai-data-expand-row').hidden = true;
        var empty = document.createElement('div');
        empty.className = 'data-empty';
        empty.textContent = "No saved data yet, click 'Grab data' button on the panel to source data";
        list.appendChild(empty);
        return;
      }
      var d = new Date(catalog.scannedAt);
      var two = function (n) { return String(n).padStart(2, '0'); };
      // "data sourced as of <mm/dd/yy>" then, on the next line, the local time (hh:mm AM/PM) in the user's timezone.
      asOf.textContent = 'data sourced as of ';
      var dateText = document.createElement('strong');
      dateText.textContent = two(d.getMonth() + 1) + '/' + two(d.getDate()) + '/' + two(d.getFullYear() % 100);
      asOf.appendChild(dateText);
      asOf.appendChild(document.createElement('br'));
      var hour12 = d.getHours() % 12 || 12;
      var timeText = document.createElement('strong');
      timeText.textContent = two(hour12) + ':' + two(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'am' : 'pm') + zoneSuffix(d);
      asOf.appendChild(timeText);
      asOf.hidden = false;
      filterRow.hidden = false;
      document.getElementById('oai-data-expand-row').hidden = false;
      renderList();
    }
    function loadCatalogView() { chrome.storage.local.get([CATALOG_KEY], function (r) { renderCatalog(r && r[CATALOG_KEY]); }); }
    chrome.storage.onChanged.addListener(function (changes, area) { if (area === 'local' && changes[CATALOG_KEY]) renderCatalog(changes[CATALOG_KEY].newValue); });
    loadCatalogView();
    document.getElementById('oai-data-btn').addEventListener('click', function () { loadCatalogView(); showDataView(true); });
    document.getElementById('oai-data-back').addEventListener('click', function () { showDataView(false); });

    // Preferences: "Auto-match Workday fields" (default ON). When OFF, the
    // content script uses the verified Unassigned hierarchy instead of matching
    // workbook project/task text against the live Workday picker.
    var storedAutoDefault = true; // the user's real "auto-match" choice, remembered while disabled
    var autoDefaultPref = document.getElementById('oai-autodefault-pref');
    if (autoDefaultPref) {
      chrome.storage.sync.get(['oai_auto_default'], function (prefs) {
        storedAutoDefault = prefs.oai_auto_default !== false; // unset -> ON by default
        autoDefaultPref.checked = storedAutoDefault;
        syncAutofillEnabled();
      });
      autoDefaultPref.addEventListener('change', function () {
        storedAutoDefault = autoDefaultPref.checked;
        chrome.storage.sync.set({ oai_auto_default: autoDefaultPref.checked });
      });
    }

    // Preference: "Default to Unassigned, Fill Time/Notes Only" (default OFF). When ON, the
    // content script sets Time Type to Unassigned > Unassigned Time > Unassigned for every
    // entry and enters only the hours and comments from the workbook (no project matching).
    var timeNotesPref = document.getElementById('oai-timenotes-pref');
    // "Auto-match Workday fields" only matters in the normal flow. When "Default to Unassigned"
    // is ON, nothing is matched -> grey the nested toggle out.
    function syncAutofillEnabled() {
      if (!autoDefaultPref) return;
      var off = !!(timeNotesPref && timeNotesPref.checked);
      autoDefaultPref.disabled = off;
      // Show it OFF while disabled (auto-match cannot run in fill-time-and-notes-only mode); restore
      // the remembered choice when re-enabled. Setting .checked programmatically does NOT fire the
      // change handler, so the stored oai_auto_default preference is preserved.
      autoDefaultPref.checked = off ? false : storedAutoDefault;
      var row = autoDefaultPref.closest('.oai-pref-row');
      if (row) row.classList.toggle('oai-pref-row--disabled', off);
    }
    // The row is hidden (see CLAUDE.md); make sure a previously saved ON cannot keep applying invisibly.
    chrome.storage.sync.set({ oai_fill_time_notes_only: false });
    if (timeNotesPref) {
      chrome.storage.sync.get(['oai_fill_time_notes_only'], function (prefs) {
        timeNotesPref.checked = !!prefs.oai_fill_time_notes_only; // unset -> OFF by default
        syncAutofillEnabled();
      });
      timeNotesPref.addEventListener('change', function () {
        chrome.storage.sync.set({ oai_fill_time_notes_only: timeNotesPref.checked });
        syncAutofillEnabled();
      });
    }

    // Default 1 / Default 2 switches: on by default and remembered. At least ONE must stay on (with auto-match off,
    // every dropdown value resolves to an active default; with both off Workday would reject the entry), so
    // turning off the last active one is refused and the switch snaps back on.
    // (State only for now: the fill code does not read these yet.)
    var DEFAULTS = [['oai-default1-pref', 'oai_default1_on'], ['oai-default2-pref', 'oai_default2_on']];
    var defaultBoxes = DEFAULTS.map(function (pair) { return document.getElementById(pair[0]); });
    var defaultStored = [true, true];   // the user's own choice (what is saved)
    var ocpAvailable = false;           // Default 1 (Open Code Pending) is disabled for now: always off, tooltip 'Coming soon'
    var NO_OCP_TIP = 'Coming soon';

    // Open Code Pending is only usable when the user's saved Workday data contains it. Unassigned is assumed always present.
    function catalogHasOpenCodePending(catalog) {
      if (!catalog || !catalog.projects) return false;
      var re = /open code pending/i;
      return catalog.projects.some(function (project) {
        return re.test(project.name || '') || (project.tasks || []).some(function (t) { return re.test(t.path || '') || re.test(t.label || ''); });
      });
    }

    // Paints the switches from the stored choices + availability. Stored values are never overwritten by availability,
    // so Default 1 returns to the user's choice once the data contains Open Code Pending.
    function paintDefaults() {
      var on = [defaultStored[0] && ocpAvailable, defaultStored[1]];
      if (!on[0] && !on[1]) on[1] = true; // Unassigned always available, so at least one default stays on
      defaultBoxes.forEach(function (box, index) { if (box) box.checked = on[index]; });
      var d1 = defaultBoxes[0];
      if (d1) {
        d1.disabled = !ocpAvailable;
        var row = d1.closest('.oai-pref-row');
        if (row) { row.classList.toggle('oai-pref-row--unavailable', !ocpAvailable); if (ocpAvailable) row.removeAttribute('data-cursor-tip'); else row.setAttribute('data-cursor-tip', NO_OCP_TIP); }
      }
    }

    chrome.storage.sync.get(DEFAULTS.map(function (pair) { return pair[1]; }), function (prefs) {
      defaultStored = DEFAULTS.map(function (pair) { return prefs[pair[1]] !== false; });
      if (!defaultStored[0] && !defaultStored[1]) { defaultStored[0] = true; var repair = {}; repair[DEFAULTS[0][1]] = true; chrome.storage.sync.set(repair); }
      paintDefaults();
    });
    
    defaultBoxes.forEach(function (box, index) {
      if (!box) return;
      box.addEventListener('change', function () {
        var other = defaultBoxes[1 - index];
        if (!box.checked && other && !other.checked) {
          box.checked = true; // refuse: at least one default must stay active
          var row = box.closest('.oai-pref-row');
          if (row) { row.classList.remove('oai-pref-row--nudge'); void row.offsetWidth; row.classList.add('oai-pref-row--nudge'); }
          return;
        }
        defaultStored[index] = box.checked;
        var update = {}; update[DEFAULTS[index][1]] = box.checked; chrome.storage.sync.set(update);
        paintDefaults();
      });
    });

    // Instant tooltip that follows the cursor (rows with data-cursor-tip).
    (function () {
      var tip = document.createElement('div'); tip.className = 'oai-cursor-tip'; document.body.appendChild(tip);
      function place(e) {
        var x = e.clientX + 14, y = e.clientY + 18;
        var w = tip.offsetWidth, h = tip.offsetHeight;
        if (x + w > window.innerWidth - 6) x = Math.max(6, window.innerWidth - w - 6);
        if (y + h > window.innerHeight - 6) y = e.clientY - h - 10;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      }
      document.addEventListener('mouseover', function (e) {
        var el = e.target.closest && e.target.closest('[data-cursor-tip]');
        if (!el) return;
        tip.textContent = el.getAttribute('data-cursor-tip'); tip.classList.add('is-visible'); place(e);
      });
      document.addEventListener('mousemove', function (e) {
        if (tip.classList.contains('is-visible')) { if (e.target.closest && e.target.closest('[data-cursor-tip]')) place(e); else tip.classList.remove('is-visible'); }
      });
      document.addEventListener('mouseout', function (e) {
        if (e.target.closest && e.target.closest('[data-cursor-tip]') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-cursor-tip]'))) tip.classList.remove('is-visible');
      });
    })();

    // Appearance widget
    OAIAppearance.init(document.getElementById('oai-appearance-widget'));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
