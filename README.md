# Workday Time Entry Importer

A Manifest V3 Chrome extension that fills Workday's **Enter Time** calendar from a weekly Excel
timesheet. Drop an `.xlsx` on the panel, review it, and the extension enters each day's Time Type,
Hours and Comment for you. It is the Workday adaptation of the OpenAir Timesheet Importer.

Everything runs locally in the browser: no server, no remote code, no telemetry. Workbook contents are
never stored.

## How to use

1. Open **Enter Time** in Workday (This Week, Last Week or Select Week). The importer panel appears
   bottom-right once the calendar is showing. It is hidden on every other Workday page.
2. *(Once, and whenever your projects change)* click **Grab data** on the panel. The extension reads your
   Project Plan Tasks list (about 1-2 minutes) and saves your Projects and Tasks.
3. Drag your `.xlsx` onto the panel, or click it to browse. Pick the worksheet.
4. **Step 1: Review Data.** Each row has one **Project > Task** dropdown listing your saved Projects and
   Tasks, pre-selected with the best match. Rows with no match show `- undefined -`.
5. Click **Fill calendar**. The extension opens each day, picks the Time Type, enters Hours and Comment,
   and clicks the entry dialog's `OK`.
6. Review the Complete modal. **See Logs** appears only if something needs attention (entries that failed,
   or entries that fell back to Unassigned).
7. Check the calendar and submit it with Workday's own **Submit**. The extension never submits for you.

The extension fills **whichever week is open**: each Sunday-Saturday column maps by position to the date Workday
shows for that day. The worksheet name is not used to choose the week, so make sure the right week is open.

### Workbook format

Columns: `Project`, `Task`, then Sunday-Saturday hour/comment pairs. The older `Client : Engagement`
and `Project Task` headings are still accepted. Use **Download template** on the panel, or the popup, for a template.

## The panel

- **Grab data** (database-search icon) scans your Time Type hierarchy and saves it. A small
  "prev data grab mm/dd/yy" note shows when it last ran. A progress box with a gif, the gif's odds and a
  time estimate appears to the left of the panel while it runs.
- **Download template** downloads the workbook template.
- **Hide panel** (top-right of the panel header) slides the panel off-screen; a small button at its corner
  brings it back.

## The popup (toolbar icon)

- **Resources**: download the example and the template.
- **Appearance**: color theme and Light / Dark / Cool mode (applies to the popup, panel and modals).
- **Preferences**: *Auto-match projects and tasks* (on by default), and Default 1 (Open Code Pending) /
  Default 2 (Unassigned). The Default switches are remembered but not used by the fill step yet.
- **Data**: **View saved Workday data** slides in your saved Projects and Tasks, grouped by project (collapsed
  by default), with a filter box, Expand all / Collapse all, counts, and when the data was sourced.

## What Grab data does (and does not do)

Workday builds the Time Type list per user and only loads each level when it is opened, so it cannot be read
from the page up front. Grab data opens a blank Enter Time form on Saturday, opens the Time Type picker,
walks `Project Plan Tasks -> project -> phase -> task` through the page UI, and cancels the blank form.
It **never selects** a Time Type (selecting one makes Workday create a real entry). The result is saved in
`chrome.storage.local` as Project / Task names only. Details, measurements and the bugs found while building
it are in [`docs/GRAB_DATA_CLAUDE.md`](docs/GRAB_DATA_CLAUDE.md).

## Calendars

Workday rolled out a new Enter Time calendar on 2026-11-05. Both layouts are supported; the dialog is the
same in both. See [`CLAUDE.md`](CLAUDE.md) for the DOM contract for each.

## Safety

- The review modal is the confirmation step; nothing is written before you click **Fill calendar**.
- The extension clicks the entry dialog's `OK`, never Workday's final submit.
- Cancel and failure paths leave the page without submitting anything.
- Entries Workday saves on `OK` cannot be undone by the extension, so check the open week first.

## Local development

1. Open `chrome://extensions` and turn on Developer mode.
2. **Load unpacked** and choose this folder.
3. After any change, click **Reload** on the extension card **and refresh the Workday tab**. A page refresh alone
   does not reload the extension, and a reload that hits a manifest error keeps the previous manifest.

Checks before handing off:

```text
node --check content.js
node --check lib/workday-dates.js
node --check popup/popup.js
node tests/parsing.test.js
```

Also validate `manifest.json` as JSON. `web_accessible_resources.matches` must stay origin-only
(`https://wd12.myworkday.com/*`).

## Project layout

```text
manifest.json          MV3 manifest
content.js / .css      panel, review/complete modals, Workday automation, Grab data
gifs.js                gif registry for the Grab data progress box (chances sum to 100)
lib/workday-dates.js   pure date helpers (unit tested)
lib/xlsx.full.min.js   SheetJS, vendored
popup/                 toolbar popup (HTML, CSS, JS)
features/appearance/   theme and mode picker shared by the popup
docs/                  Grab data notes, Time Type analysis, screenshots
tests/                 date/parsing tests
```

The OpenAir repository is a reference only and is not modified.
