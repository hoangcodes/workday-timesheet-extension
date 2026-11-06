# Chrome Web Store submission pack: Workday Time Entry Importer 1.0.0

Upload file: `workday-time-entry-importer-1.0.0.zip` (this folder). Screenshots: `docs/store/01`-`06` PNG files (1280x800); raw captures are in `docs/screenshots/`. The store accepts at most 5, so drop one.

## Store listing

**Name:** Workday Time Entry Importer

**Summary (max 132 characters):**
Drag and drop your weekly Excel timesheet into Workday Enter Time, review it, then fill the calendar.

**Description:**
Workday Time Entry Importer fills your Workday Enter Time calendar from an Excel timesheet.

How it works
1. Open Enter Time in Workday (This Week, Last Week or Select Week).
2. Drag your .xlsx timesheet onto the panel, or click it to browse. Pick the worksheet if the file has several.
3. Review the Project > Task, hours and comments in one table. Anything not matched in Workday defaults to Unassigned.
4. Click Fill calendar. The extension enters each entry into the open week. You review the calendar and submit it yourself.

Features
- Grab data: saves your own Workday project and task list in the browser so entries can be matched to real Workday tasks.
- Review before anything is written, and a log of what was entered.
- Download a template and an example workbook.
- Light, Dark and Cool themes with five accent colours.

Privacy
Everything runs in your browser. The extension has no server, sends nothing anywhere and collects no analytics. Workbook contents are never stored. It never clicks Workday's submit button.

Works only on the Connor Group Workday tenant (wd12.myworkday.com/connorgp).

## Privacy practices tab

**Single purpose:** Fill the Workday Enter Time calendar from a weekly Excel timesheet the user provides.

**Permission justifications**
- `activeTab`: lets the popup read the current tab and send the colour theme to it when the user opens the popup.
- `storage`: saves the user's theme and preferences, and the list of their own Workday projects and tasks (from "Grab data") so entries can be matched. No workbook contents are stored.
- Host permission `https://wd12.myworkday.com/connorgp/*`: the importer panel and the form filling run only on the firm's Workday Enter Time pages.

**Remote code:** No, I am not using remote code. (See the open issue about the surprise GIFs: they load as remote images, not code.)

**Data use:** the extension handles website content (Workday project and task names) and the user's file locally. Nothing leaves the browser. Tick no collection categories only if you agree this reading is accurate; the project/task names are kept in local browser storage.

**Privacy policy URL:** required by the dashboard when any user data is handled. Not yet written.

**Test instructions:** reviewers cannot sign in to the firm's Workday. Say so, attach `example.xlsx`, and describe the flow. The extension shows nothing outside that tenant.

## Open items before submitting
1. Icons are still the OpenAir upload-box icon, identical to the OpenAir extension. The popup header shows the Workday logo from `assets/workday-icon.png`.
2. The GIFs in `gifs.js` are remote images of third-party characters (Pikachu, Hello Kitty, Totoro, Yoshi and others) from emoji.gg.
3. Max 5 screenshots; the Step 1 screenshot still shows "- undefined -".
4. Choose the visibility: private to your domain or group, or unlisted.
5. Promo tiles (440x280 small, 1400x560 marquee) are optional.
