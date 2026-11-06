# Grab data — how it works, what worked, what didn't

Scope: the panel's **Grab data** button (`runGrabData` → `scanProjectPlans` in `content.js`). It reads the user's
Workday Time Type hierarchy (`Project Plan Tasks → Project → Phase → Task`) once and saves it so Step 1 can offer a
dropdown of real values. Read the main `CLAUDE.md` first; this file only covers the scan.

## Result
Live run 2026-11-05 (v2 calendar, Browser with the real session): **8 Projects, 56 Tasks, no warnings**, form closed, calendar
still at 0 entries / 0 total. Before the fixes below it saved 2 of 8.

## How it works
1. Requires the Enter Time calendar and **no open dialog** (otherwise it stops with a message).
2. Opens **Saturday's** blank Enter Time form (`openWorkdayEntry(6, week.dates[6])`).
3. Clicks the Time Type input, waits for the picker, clicks `Project Plan Tasks`.
4. `walkPickerLevel` goes depth first. For each level it lists every item (scrolling the virtualized list), then for each
   submenu: click in → wait for a new, stable list → recurse → click back → verify it is back on the parent level.
   `menuitemradio` leaves are only recorded. **Nothing is ever selected** (selecting a Time Type makes Workday create an entry).
5. Closes the picker (back out, Escape) and cancels the blank form, answering "Discard Changes?" only if it appears.
6. Saves `chrome.storage.local.wte_catalog = { scannedAt, projects: [{ name, tasks: [{ path, label }] }] }`.
   Project = first segment of the path, Task label = the rest (`Phase > Task`). Re-running replaces it.
7. UI: panel-sized progress box left of the panel (gif, odds, estimate, Cancel). Popup → "View saved Workday data" lists
   the paths. Step 1 uses them for the combined Project > Task dropdown.

## Picker facts (measured live)
- Root: `Most Recently Used`, `Project Plan Tasks` (`menuitem`, no back header).
- Project list = `menuitem` per project; a phase level; then `menuitemradio` tasks whose label is the full path
  `Project > Phase > Task`.
- Several projects have a single phase with the same name (e.g. `Conversion 01`), and one project's phase is named like the
  project itself (`Administration`). **Never identify a level by one label.**
- Only ~6–8 rows are in the DOM at once; the list scroller is the nearest scrollable ancestor of the items.
- Events dispatched to the `role=menuitem` element are **ignored**. Dispatch the full pointer/mouse sequence to the inner
  `[data-automation-id="promptOption"]` (what `elementFromPoint` returns).
- Back = the visible `[data-automation-id="multiSelectHeader"]` (hit = `promptTitle`). Its text is the *parent* level's name.
- Level transition: header changes in ~100 ms, the list is empty for a moment, then fills in ~0.5–0.9 s.

## What failed, and why (in order found)
1. **"Could not open Project Plan Tasks"** — the first scan UI was a full-screen overlay. The pre-click hit test saw the overlay,
   not the picker. Fix: no overlay; a small fixed box.
2. **Back clicked twice → scan fell out to the root and every later project failed.** At the project list the header reads
   "Project Plan Tasks"; a second click leaves the picker level. The first version compared the list to an exact signature after
   back; virtualization changed the signature, so it clicked again. Fix: click back **once**, accept the parent when every
   visible item belongs to that level's listed labels and it is not the child we just left; retry only if nothing changed.
3. **Failed from project 3 on ("did not load"), saved 2 of 8.** The diagnostic text in the warning showed the last click hit
   `... (extension UI)`: the scan box floated over the lower picker rows, so clicks on those rows landed on the extension.
   A hand-copied version of the click logic worked in isolation, which is what pointed at "state that depends on position".
   Fixes: `elementsFromPoint` → use the topmost **page** element under the extension UI and dispatch to it (`activateWorkdayControl`
   takes a forced target); the scan box is `pointer-events: none` (Cancel button excepted).
4. **Progress and estimate stalled** — only successful projects counted as done. Failed ones now count; ETA starts at a guess
   (~9 s/project) and switches to the measured pace after two projects.
5. **"Extension context invalidated"** — only seen when the extension was reloaded during a run. Not a scan bug.

## Rules for changing this code
- Do not select anything in the picker and do not call Workday's `/prompt/` endpoints directly.
- Do not click the back header unless you have confirmed the level did not change; never twice in a row.
- Hit-test through the extension UI; never let extension UI be the click target.
- Keep the diagnostic suffix on warnings (`[header; visible items; last click target]`); it found bug 3.
- A failed scan must still close the blank form, and must not overwrite the saved catalog with partial data.
- Test live: reload the extension at `chrome://extensions`, refresh Workday, click Grab data, confirm the saved count, no warnings,
  no dialog left open, and the calendar still at 0 entries.
- Legacy calendar: a cancelled blank form may leave a stale tile that blocks other days; the status tells the user to refresh.
  Not verified live on the legacy layout.
