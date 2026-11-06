# Workday Time Entry Importer — Build Specification

This repository is the Workday adaptation of the OpenAir Timesheet Importer. The
OpenAir repository is a reference implementation only and must remain unchanged.

## Product goal

Keep the existing extension experience: Chrome popup, drag-and-drop Excel import,
worksheet selection, review modals, themes, local templates, icons, and completion
feedback. Replace only the website integration with Workday’s calendar-based Enter
Time workflow.

Input columns remain compatible with the proven workbook shape:

1. `Project` (the legacy `Client : Engagement` or `Time Type` heading is also accepted)
2. `Task` (the legacy `Project Task` heading is also accepted)
3. Sunday–Saturday hour/comment pairs

## URL scope

The content script is injected on `https://wd12.myworkday.com/connorgp/*`
(`host_permissions` and `content_scripts.matches`). **`web_accessible_resources.matches`
must stay origin-only (`https://wd12.myworkday.com/*`): Chrome rejects any path other than
`/*` there ("Invalid match pattern"), and a rejected manifest makes the extension fail to
reload, leaving the previous manifest active.** After any manifest edit, reload the
extension and confirm there is no error on its `chrome://extensions` card.
Workday is a single-page app and reaches the Enter Time calendar through several routes
without a page load (measured live 2026-11-02, from the Time landing page
`/connorgp/d/inst/<session id>/cacheable-task/2997$2151.htmld`, whose "Enter Time" worklet has
three options):

- This Week → `/connorgp/d/task/2997$4767.htmld`
- Last Week → `/connorgp/d/task/2997$4775.htmld`
- Select Week → date prompt at `/task/2997$4765.htmld`, then a full reload to
  `/connorgp/d/gateway.htmld?reloadToken=…`

Because the routes (and the landing page) differ, injection is by tenant path, not by task
URL: a content script matched to one task URL is never injected after an SPA transition from
the landing page. The importer panel is shown only when `isWorkdayTimesheetPage()` is true:
URL under `/connorgp/`, `document.title` starts with "Enter Time", and the calendar's
a recognised calendar (either layout, see below) with seven date labels is rendered. `ensurePanel` re-checks on
DOM mutations and every second, and removes the panel when the calendar is not showing. On
every other Workday page the UI stays hidden and nothing on the page is touched. Do not
broaden host scope beyond `wd12.myworkday.com/connorgp/`. (The popup has no "workday detected"
indicator.)

## Engineering requirements

- Follow software engineering best practices.
- Minimize technical debt: use cohesive modules, stable selectors, pure helpers for
  date logic, defensive checks, and focused tests.
- Prefer Workday `data-automation-id` and ARIA roles. Do not depend on generated CSS
  class names or screen coordinates.
- Keep the extension local-only. Do not add a server, remote code, telemetry, or
  persistent storage for workbook contents.
- Do not silently guess. Any unresolved Workday mapping must be visible in the final
  audit log with a useful remediation message.
- Preserve the source UI/assets and use local `lib/xlsx.full.min.js`.

## Workday DOM contract

The current live page exposes:

- `data-automation-id="dayCell-<month index>-<day of month>"` for the visible date labels
  (text like `Sun, 11/1`). The id is **not** a Sunday–Saturday index: Nov 1–7 is
  `dayCell-10-1…7`, Last Week (Oct 25–31) is `dayCell-9-25…31`, and a month-crossing week
  mixes both. Read the 7 visible labels in left-to-right order and parse their text
  (`visibleDayHeaders()` / `readWorkdayWeek()`); never derive the weekday from the id.
- `data-automation-id="nonTimedDaySeparator_0"` through `_6` for day selection.
- `data-automation-id="calendarAppointmentEnterTime"` for the movable Enter Time
  calendar tile.
- An Enter Time dialog with an input using `data-uxi-widget-type="selectinput"`,
  `data-automation-id="numericInput"` for Hours, a textarea for Comment, and an
  `OK` button.

### Two calendar layouts (both supported)

Workday rolled out a new Enter Time calendar on 2026-11-05; the old one still exists, and the
importer supports both (`calendarLayout()` returns `'v2'`, `'legacy'`, or `null`). The Enter Time
**dialog is identical** in both (same `role="dialog"`, `selectinput` Time Type, `numericInput`
Hours, textarea Comment, OK/Cancel), so all form code is shared.

New layout ('v2'): a `role="table"` calendar with only `data-testid` hooks (class names are
generated `css-…`, never use them): `calendar_container`, `day_of_the_week`, `date_cell_0…6`
(Sunday–Saturday, in order), `date` (label inside each cell: `Nov 1`, `2`, `3`… — only the
first cell and the 1st of a month carry a month name), `date_range` (`Nov 1 – 7, 2026`, gives
the year), `time_entry_calendar_instances_wrapper` (one per day, holds that day's entries),
`total_quantity` (Summary totals), `summary`, `review_button`, `submit`. Dates are parsed by
the pure, unit-tested `weekFromDayLabels()`. Behaviour differences measured live:

- No `calendarAppointmentEnterTime` tile, and a cancelled blank form leaves nothing that blocks
  other days, so the stale-tile guard does not apply; opening a day = pointer-click the
  `date_cell_<dow>` and verify the dialog's date (retry once). A failure message tells the user to
  refresh if an unsaved form is left on the page.
- Save confirmation (no `calendarevent`/`data-automation-startdate` here): OK counts as saved
  when the dialog closes **and** one of these appears — a new child in that day's
  `time_entry_calendar_instances_wrapper`, a "changes have been saved" status, or a change in the
  Summary `total_quantity` text (`workdaySaveMessages()` appends a `totals:` pseudo-message).
- **Unverified on v2** (avoided because Workday creates an entry when a Time Type is picked):
  whether a pending/leftover tile appears after selecting a Time Type, and the exact node a saved
  entry renders as. The save check above is deliberately signal-redundant for this reason.

Legacy layout: `dayCell-<month index>-<day of month>`, `nonTimedDaySeparator_*`,
`calendarAppointmentEnterTime`, `calendarevent` (see the DOM contract above).

The importer panel is anchored bottom-right, 20px left of Workday's Summary column
(`right: 283px`; Summary measured 263px wide, flush right).

### Time Type navigation

The picker is asynchronous and hierarchical. The observed path is:

`Project Plan Tasks → project → phase → final menuitemradio`

The final radio option’s accessible label contains the full path, while the input’s
value remains blank. A successful selection is confirmed by the selected listbox
option and `data-automation-id="promptAriaInstruction"`, which reports the selected
path.

Measured live on 2026-11-02:

- Root picker options: approximately 850 ms.
- Project submenu expansion: approximately 460 ms.
- Use polling at 100 ms, a 5-second per-load timeout, an 800 ms settle delay (600 ms after the final selection), and a
  5-second post-OK save-confirmation timeout before moving to the next entry.

**Selection is by search, not drill-down.** Typing a term into the Time Type input and
pressing Enter returns a flat list of final full-path options (`Search Results (N)`,
`Project > Phase > Task`) from the whole hierarchy. The importer searches the Client
part of the workbook Project (text before `:`), then picks the result whose leaf equals
the workbook Task (else a unique strong fuzzy leaf ≥ `MATCH_MIN`; ties broken by Project
similarity; a remaining tie is reported as ambiguous, never guessed). Quirks:

- Exactly one match is auto-selected on Enter (no list); it is kept only if its leaf
  matches the Task, otherwise cleared.
- The result list is virtualized (`activeListContainer`, ~6 rows in the DOM); scroll it.
- Selection shows as chip `data-automation-id="selectedItem"`; clear it with
  `data-automation-id="DELETE_charm"` (full pointer sequence, ~140 ms) before re-searching.
- Typing must use the native `HTMLInputElement.prototype` value setter + `InputEvent`,
  then `KeyboardEvent` keydown/keypress/keyup Enter.
- Timings: `searchSettleMs` 700 ms before Enter, `searchTimeoutMs` 4 s for results.

If a mapping is missing or cannot be resolved, use the exact fallback
`Unassigned > Unassigned Time > Unassigned` and report how many entries used it.
Do not use that fallback for a missing Workday field, picker timeout, or other DOM
failure.

The popup preference **Default to Unassigned, Fill Time/Notes Only** (MVP path, default
off): when on, no project/task matching occurs. Every entry's Time Type is
`Unassigned → Unassigned Time → Unassigned`, and only the workbook's hours and
comments are entered. The review modal shows Project/Task as read-only Unassigned.
This is the user's explicit choice, so it is not counted as a mapping fallback.

The review flow remains one modal and opens immediately after workbook parsing,
matching OpenAir's responsive Review Data behavior. Do not open a blank Enter Time
dialog or pre-scan the Workday hierarchy before review. After confirmation, resolve
each row against the live hierarchy while opening its entry form. A workbook value that
is not a unique live match defaults to `Unassigned → Unassigned Time → Unassigned`; it
is never used as a Workday selection.

## Known Workday constraints (measured live 2026-11-02)

These are properties of Workday, not bugs to code around. Design against them.

1. **Time Type options are not available up front.** No Time Type data loads with the
   page (133 requests observed, none carrying it). Each picker level is fetched from
   Workday's server only when that level is opened: opening the form is one POST to
   `/connorgp/button/...htmld`; opening the picker and each submenu level is one POST to
   `/connorgp/prompt/<session-scoped id>/<n>.htmld`. The list is built per user on the
   server, so it reflects that user's permissions and cannot be hard-coded or pre-scanned.
   Do not call these endpoints directly: the ids are tied to the session and open form,
   and the response format was not inspected. Interact only through the page UI.
2. **Every level is a ~0.5–0.9 s async render, and the picker is briefly empty** (~30 ms
   after a click) before the next level appears. An empty or changing list is not a
   completed transition; require a non-empty, changed, stable list.
3. **The form re-renders ~0.5 s after the Time Type selection is confirmed.** Hours and
   Comment are replaced by NEW elements and Hours resets to `0`. Enter Hours/Comment only
   after the field elements stop being replaced (~1 s stable), re-find them, enter, and
   verify before `OK`. Entering them earlier loses the values and shows
   "The field Hours is required and must have a value".
4. **Workday appears to create the entry when a Time Type is chosen.** Discarding the form
   afterwards can still leave a 1-hour entry on the calendar. Do not "probe" Time Types
   in a real form; avoid cancel-and-retry flows.
5. **A leftover Enter Time tile blocks every other day.** After any Cancel/Discard/close
   (even of a blank form) the tile stays on that date. While it exists, clicking any
   other day's separator does nothing, and clicking the tile reopens ITS date. Only saving
   on that date or refreshing the page clears it. The importer must detect this, stop
   once, and tell the user to refresh; it must never click through to a different date.
6. **Cancel on an edited form shows "Discard Changes?"** (a second `role="dialog"` with
   `Discard` / `Continue`) and keeps the form open until answered.
7. **Clicking blank/required fields (e.g. Hours) while Time Type is empty flags them as
   errors immediately.** Do not use "click Hours to close the picker". Searching (see
   Time Type navigation) avoids needing to close or back out of the picker; use
   `DELETE_charm` to clear a wrong selection.
8. **Plain `HTMLElement.click()` is unreliable; coordinates go stale.** Use the full
   pointer/mouse sequence, and for picker options require that the hit target is inside
   the intended option, since the list re-renders under the pointer.
9. **Projects shown depend on the user.** Many workbook projects will not exist in the
   live picker. A search with no results, or no matching Task, falls back to Unassigned
   (counted and reported in the audit log). Do not fuzzy-match aggressively.

### MVP decision

Because of constraints 1–5, the supported MVP is the popup preference **Default to
Unassigned, Fill Time/Notes Only**: Time Type is always
`Project Plan Tasks → Unassigned → Unassigned Time → Unassigned`; no project matching is
attempted. Search-based Project/Task matching (the default-off path) is best-effort:
the picker search is the only matching mechanism, and Unassigned is searched the same
way. Its result must still be reviewed by the user in Workday before saving.

## Week and date mapping

Like the OpenAir importer, the importer fills **whichever Workday week is open**. Each workbook
Sunday–Saturday column maps by position to the date Workday renders for that day (read from
the visible `dayCell-*` labels, never the system date). The worksheet name is **not** used to
choose the week: `filterEntriesToWeek(entries, pageWeek, null)` is called with no sheet name, so
a sheet named for another week is not blocked. (An earlier version dated entries from the sheet
name and refused to run when it differed from the open week; that block was removed at the
user's request. Trade-off: Workday saves each entry on OK, so the user is responsible for having
the right week open. The review modal shows the sheet name for reference.) A week that crosses
a month boundary maps all seven rendered dates, and a notice states the range. The only
"nothing to do" error is a worksheet with no hours or comments.

## User confirmation and safety

- The extension review modal is the confirmation boundary before writing entries.
- Workday modal `OK` is clicked only after the user confirms the review.
- The extension never clicks Workday’s final submit/save action automatically.
- Cancel and failure paths must leave the page without silently submitting data.

## Findings and troubleshooting (measured live 2026-11-02)

- **Panel missing after clicking This Week / Last Week / Select Week = the content script was
  never injected.** Diagnosed in a controlled tab: after the SPA transition the URL, title
  ("Enter Time - Workday"), `dayCell-10-*` and `nonTimedDaySeparator_*` were all correct, yet
  neither `#oai-panel` nor `#oai-theme-style` existed. The cause was Chrome running an older
  manifest, so nothing was injected on the landing page and nothing noticed the later SPA
  route change. Chrome re-reads `manifest.json` only when the unpacked extension is reloaded at
  `chrome://extensions` (a page refresh is not enough), and **a reload that hits a manifest
  error keeps the previous manifest active** — that is exactly what happened when
  `web_accessible_resources.matches` was given a `/connorgp/*` path ("Invalid match pattern").
  Diagnose with the extension's **Details → Site access** list (it must show the current
  patterns) and the card's **Errors** button.
- **Panel missing on Last Week even though the script was injected:** the date-label ids are
  month/day based (see DOM contract), so `dayCell-10-1…7` lookups only worked for weeks
  starting on the 1st. Fixed by reading the visible labels in order.
- **Quick injection check** (DevTools console on any `/connorgp/` page):
  `!!document.getElementById('oai-theme-style')` is `true` when the content script is running,
  independent of whether the panel is shown. (The content script runs in an isolated world, so
  `window` globals such as `WTE_DATES` are not visible from the page console.)
- **Search results can lie outside the visible list area.** The result list is virtualized and
  clipped by its scroller; an option can be in the DOM but below the visible area (observed
  `y≈804` with the scroller ending earlier). Dispatching pointer events to such an option's
  element is silently ignored, so Workday never selects it and the importer reports
  "did not confirm Time Type". `selectTimeTypeResult` therefore scrolls the option into view
  (`scrollIntoView({block:'center'})`), re-finds it, and clicks only when
  `elementFromPoint` at its centre is inside the option (the hit is `.promptOption`). Never
  dispatch to the radio element itself as a fallback.
- **The first click after a fresh load can be ignored** on the Time landing page while Workday
  is still wiring the worklet; a second click works. Not an extension issue.
- **Complete modal reporting.** Unassigned fallbacks are listed as a table
  (`Day | Expected | Actual | Notes`, e.g. `Fleetio > Issue Analysis | Unassigned | Unassigned
  fallback; Project "Fleetio" was not found in Workday.`) above the failure Audit Log. Entries
  that could not be entered at all remain in the Audit Log.

## Verification checklist

Before handoff, run:

- `node --check content.js`
- `node --check lib/workday-dates.js`
- JSON validation for `manifest.json`
- `node tests/parsing.test.js`

Manually verify the panel on This Week, Last Week and Select Week (and its absence on the landing page), Sunday–Saturday date mapping onto the open week (including a sheet for a different week and a dual-month week), Time Type search/selection, hours/comments, and review cancellation.

## Grab data, saved catalog and scan modal (added 2026-11-05)

**Status: verified live (2026-11-05, v2 calendar).** Two consecutive runs saved 8 Projects / 56 Tasks with no warnings, closed the
form, and left the calendar unchanged. Not verified on the legacy layout. Details: `docs/GRAB_DATA_CLAUDE.md`.

- **Panel button row:** `Grab data` (lucide `database-search`) on the left, `Download template` (lucide `file-type-corner`) filling the rest,
  both fixed at 32px tall with an 8px gap. `#oai-grab-btn` calls `runGrabData()`. Under Grab data, a small "prev data grab **mm/dd/yy**" note
  (bold date) shows once data exists. The header icon is lucide `calendars`.
- **Scan (`scanProjectPlans`)**: requires the calendar and no open dialog; opens **Saturday's** Enter Time
  form (`openWorkdayEntry(6, …)`), opens the Time Type picker, clicks `Project Plan Tasks`, then walks
  depth-first: submenu `menuitem` → click → recurse → click `multiSelectHeader` (back) → next. Leaves
  (`menuitemradio`) are recorded and **never clicked** (selecting a Time Type creates a real entry).
  Each level waits for a non-empty, changed, stable list; the virtualized list is scrolled to harvest.
  The picker/back-out/cancel run in a `finally`-style path so a failure still closes the blank form.
  Legacy layout may leave a stale Enter Time tile after cancel; the status tells the user to refresh.
- **Storage:** `chrome.storage.local` key `wte_catalog` = `{ scannedAt, projects:[{ name, tasks:[{ path, label }] }] }`
  (Project = first path segment, Task label = remaining `Phase > Task`). It holds only the user's Workday
  Project/Task names, **not workbook contents**, so it does not violate the no-persistence rule. Re-running
  Grab data replaces it. The popup **Data** widget's "View saved Workday data" button slides a second view over the main one (header and footer
  stay): Back button, "data sourced as of **mm/dd/yy**" plus local time (hh:mm am/pm and timezone name), a filter box, stacked Expand all / Collapse all,
  "N projects · M tasks", and one bordered card per project (collapsed by default, "N tasks ⌄" toggle, phases as sub-headings, `#` restarts per project).
- **Scan modal:** shown only during Grab data (not on Continue): completion-modal styling, random gif
  (`rollGif`) with "this gif had a N% chance of appearing!", progress bar + ETA, Cancel. The Continue →
  Step 1 flow is unchanged and uses the saved catalog if present.
- **Step 1 with a catalog:** Project and Task are dropdowns of saved values. `bestCatalogMatch` picks the
  task whose leaf (or `Phase > Task`) scores ≥ `MATCH_MIN`, Project similarity as tie-break; ties or no
  match → `- undefined -` (blank). Blank is entered as the Unassigned fallback at fill time and reported
  in the Complete table. Without a catalog the old free-text inputs remain. `pickTimeTypeResult` tries the
  exact `Project > Phase > Task` path before leaf matching.
- **Panel z-index is 10** so Workday's Enter Time dialog renders above it. Workday's dialog z-index was
  not measured; if the panel still overlaps, raise Workday's value into the comparison before changing it.
- **Surprise button and popup toggle removed.** Gifs appear only in the Grab data progress box (`gifs.js`; 12 gifs including `cat` at 5%;
  chances sum to 100; the Mad gif was removed). No reward text.
- Popup: that preference row (with its warning icon + instant tooltip "Warning this is a poor user experience") is now hidden, see below.
- **Scan box (replaces the scan overlay):** a panel-sized fixed box 12px left of the panel (`right: 615px`),
  NOT a full-screen overlay. The overlay made `elementFromPoint` land on the extension, so the
  scan's "Could not open Project Plan Tasks" hit-test failed. `clickPickerItem` now also ignores hits inside
  extension UI and rejects only a *different* picker item. The gif is rolled and preloaded when the panel
  is created. ETA = projects × 14 s × 1.25 buffer + 10 s fixed (measured ≈13 s/project), switched to the measured pace after 2
  projects; shown as minutes, then "under 1 minute", then ticking seconds at ≤15 s, then "Almost done…".

### Picker measurements for Grab data (live 2026-11-05, v2 calendar)
- Root: `Most Recently Used`, `Project Plan Tasks` (both `menuitem`; no back header). Project Plan Tasks → projects
  (8 for this user, e.g. `Cerebras - NetSuite Optimization - Other - DS`) → phases (`Conversion 01`) → tasks
  (`menuitemradio`, label = full path `Project > Phase > Task`).
- Events dispatched to the `role=menuitem` element are ignored; dispatching to the inner `promptOption`
  (the `elementFromPoint` hit) works. `activateWorkdayControl` already does this.
- Back = click the `multiSelectHeader` (hit = `promptTitle`). **Its label is the parent level's name; at the project list it reads
  "Project Plan Tasks", so a second click leaves for the root.** The old scan re-clicked back when it compared the list
  to an exact signature (virtualization changes it), which backed out to the root and failed every later project.
  `pickerBack` now clicks once and accepts the parent when all visible items belong to that level's listed labels.

- **Complete modal (2026-11-05):** only the success message (and a cancel note). A **See Logs** button (left of Close, as in the OpenAir
  reference) opens a separate Logs modal holding the failure callout, the Unassigned Fallback table and the Audit Log. The button is hidden when
  there are no failures and no fallbacks.
- **Grab data diagnosis (live):** the scan completes ~88% then the run saved 2 of 8 projects; the other 6 reported "did not load". A hand-ported
  copy of the click + wait logic loads every project fine in isolation, so the failure depends on state built up during the walk. Warnings now
  append `[header; visible items; last click target]` to pinpoint it. Re-run Grab data after reloading the extension and read the status text.

- **Grab data details, fixes and rules:** see `docs/GRAB_DATA_CLAUDE.md`.

- **Popup preferences (2026-11-05):** "Default to Unassigned, Fill Time/Notes Only" is **hidden** (row has `hidden`, code kept) because it is a poor user
  experience in Workday. `popup.js` resets `oai_fill_time_notes_only` to `false` on load so a saved ON cannot apply invisibly. The remaining toggle
  is **"Auto-match projects and tasks"** (`oai_auto_default`, default ON, no longer indented). Below it, **Fallback 1 = Open Code Pending** and
  **Fallback 2 = Unassigned** are read-only (disabled-looking) display rows only; the fill code still falls back to Unassigned alone and does not
  try Open Code Pending yet.

## Current state summary (2026-11-05)

- **Panel:** header (calendars icon + title + hide button), dropzone, Grab data / Download template row, status line. **Hide panel** slides the panel
  down and off-screen; a corner button (flipped square-chevron) restores it. Hidden state is in memory only. The panel is `z-index: 10` so
  Workday dialogs sit above it. Fully-green success status (Grab data) clears itself after 7 s; warnings/errors stay.
- **Step 1 Review Data:** with saved data, one custom **Project > Task** dropdown per row spanning both columns (closed control shows 2 lines then
  an ellipsis; the list shows full paths; `- undefined -` = blank). Best match via `bestCatalogMatch`. The primary button is **Fill calendar**.
- **Complete modal:** success message + "thank you for using the extension"; **See Logs** (only when there are failures or Unassigned fallbacks)
  opens a Logs modal with the failure callout, the Unassigned Fallback table and the Audit Log.
- **Picker focus rule:** never `.focus()` a picker option, the picker back header or `DELETE_charm` while the Time Type input is empty. Moving focus off
  the empty input makes Workday show "The field Time Type is required" (reproduced live). `activateWorkdayControl` skips focus for those targets.
  Not yet confirmed that this was the only source of that error in a full import.
- **Popup:** Resources, Appearance, Preferences (Auto-match projects and tasks, default ON; Default 1 = Open Code Pending and Default 2 = Unassigned
  rows with remembered switches `oai_default1_on` / `oai_default2_on`, **not used by the fill code yet**), Data. Greys are darkened per theme;
  one shared control border (`--ctl-border`) is used by the Back button, Expand/Collapse buttons, filter box and project cards.
- **Open work:** wire Default 1/2 into the fill fallback order; verify Grab data and the new Step 1 dropdown on the legacy calendar; confirm the
  Time Type error is gone in a full import; the faster "read the picker's JSON response" idea needs a sample response first (the ids are
  session-bound, so do not call the endpoints directly).

- **Default 1 / Default 2 rule (2026-11-05):** at least one of the two switches must stay on. Turning off the last active one is refused (the switch
  snaps back on with a small shake); a stored both-off state is repaired on load. Intended behavior once wired: with *Auto-match projects and tasks*
  off, every Project > Task dropdown value resolves to an active default (Default 1 = Open Code Pending, else Default 2 = Unassigned), because Workday
  rejects an entry with no Time Type. **Only the switch rule exists today; the fill code and Step 1 dropdowns do not read these yet.**
