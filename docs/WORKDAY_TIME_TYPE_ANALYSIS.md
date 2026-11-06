# Workday Time Type Analysis

Observed on the live page:

`https://wd12.myworkday.com/connorgp/d/task/2997$4767.htmld`

Date: 2026-11-02

## Control contract

The Enter Time modal contains:

- `input[data-uxi-widget-type="selectinput"]` — Time Type search/multiselect.
- `input[data-automation-id="numericInput"]` — Hours.
- `textarea` — Comment.
- `OK` — commits the individual Workday entry modal.

The Hours field is a controlled GWT input. In the live example, setting `1` alone
left `aria-invalid="true"`; entering `1.0` and blurring changed it to
`aria-invalid="false"` and Workday normalized the display to `1`. The adapter formats
whole hours as `N.0`, dispatches input/change, and blurs before clicking `OK`.

The Time Type search input’s `value` remains blank after selection. The reliable
success signal is:

- a selected option in the Time Type listbox; and
- `data-automation-id="promptAriaInstruction"` containing `1 item selected` and the
  selected full path.

## Observed navigation

### DOM facts that control the implementation

The Time Type field is not a native `<select>` and it does not contain the project
catalog as descendants. It is a controlled input:

```text
dialog
└── input[data-uxi-widget-type="selectinput"]
```

When that input is opened, Workday renders the picker in a document-level portal,
outside the Enter Time dialog. The portal exposes:

```text
root picker: [role="menuitem"]
  aria-label="Submenu Most Recently Used"
  aria-label="Submenu Project Plan Tasks"

project/phase branches: [role="menuitem"]
  aria-label="Submenu <visible branch>"

final task choices: [role="menuitemradio"]
  visible text: <project> > <phase> > <task>
  accessible text may append: Related Actions
```

The input’s value is not a valid selection signal. Queries must be document-global,
visibility-filtered, and based on these roles/labels. Generated Workday CSS classes
and coordinates are not part of the contract.

The adapter always selects `Project Plan Tasks` first. It never selects or traverses
`Most Recently Used`, even when a workbook value resembles a recent item. Project
matching happens only against the visible project menu under `Project Plan Tasks`.
If the workbook project is a shortened label shared by multiple visible branches,
the adapter probes those live branches using the workbook task as a tie-breaker. It
reopens the same still-blank date form between candidates; it never submits a
candidate merely because its project text was similar.

The live picker exposed this hierarchy:

```text
Project Plan Tasks
└── Cerebras - NetSuite Optimization - Other - DS
    └── Conversion 01
        ├── Cerebras - NetSuite Optimization - Other - DS > Conversion 01 > Partner Oversight (Partners Only)
        └── Cerebras - NetSuite Optimization - Other - DS > Conversion 01 > PMO
```

The same live project label family also exposed a second branch:

```text
Cerebras - NetSuite Optimization - System Administration
└── Conversion 01
    ├── Phase 3 - Inventory & Manufacturing
    ├── Phase 3 - NS Admin
    ├── Phase 3 - NS Admin - FAM
    └── Phase 3 - NS Admin - Integrations
```

Therefore `Cerebras : NetSuite Optimization` alone is not a sufficient Workday
selection. `PMO` resolves to the `Other - DS` branch, while `Phase 3 - NS Admin`
resolves to `System Administration`. If the task does not identify one branch, the
adapter uses the verified Unassigned fallback instead of guessing.

The first two levels use `role="menuitem"` and accessible names beginning with
`Submenu`. The final level uses `role="menuitemradio"`; its accessible label ends in
`Related Actions`, while its visible text is the full project/phase/task path.

The `Conversion XX` level is an intermediate submenu, not the final project code.
After selecting a project, the adapter waits for and clicks the single visible
Conversion branch, waits for the next render, and then matches the final radio. A
workbook task may remain simply `PMO`; it does not need to include `Project Plan
Tasks`. An explicit `Conversion 01 > PMO` value is also supported when a user needs
to identify a particular Conversion branch.

## Timing measurements

| Operation | Live observation | Adapter behavior |
|---|---:|---|
| Open root Time Type options | ~851 ms | Wait 800 ms after the input click, then poll every 100 ms, timeout 5 s |
| Expand `Project Plan Tasks` | ~463 ms | Wait 800 ms, then poll |
| Expand a project/phase submenu | asynchronous; observed under 1 s | Wait 800 ms, then poll |
| Select final radio option | ~901–1,026 ms including Workday refresh | Wait 600 ms, then verify selection state |

These are not treated as fixed sleeps alone. The adapter waits for visible menu
options and uses the delays only as a race-avoidance buffer. If a project has one
phase, it advances automatically. If multiple phases exist and the workbook task does
not identify one, the user must enter `Phase > Task` in the review modal; the adapter
does not guess.

## Form re-render after Time Type selection (measured 2026-11-02)

About 0.5 s after the Time Type selection is confirmed, Workday re-renders the Enter
Time form. The Hours input and Comment textarea are replaced by **new elements**, any
value typed earlier is lost, and Hours resets to `0` (`Error: The field Hours is
required and must have a value`). Workday also appears to create the entry as soon as a
Time Type is chosen: a discarded form can still leave a 1-hour entry on the calendar.

Therefore the adapter must (1) wait until the Hours/Comment element identities stop
changing for 1 s (`waitForFormStable`), (2) re-find the fields, (3) enter Hours and
Comment, (4) re-read the live fields and verify the values and the Time Type selection
(`fillWorkdayEntryFields`), and only then (5) press `OK`. Never press `OK` on unverified
values. In the live check the form settled ~1.4 s after confirmation, and `OK` closed it
in under 0.8 s.

## Safe implementation sequence

1. Open the selected Workday day through `nonTimedDaySeparator_0` … `_6`.
2. Confirm `calendarAppointmentEnterTime` and the modal date match the workbook’s
   exact `YYYY-MM-DD` date.
3. Click the Time Type input and wait for visible root menu options.
4. Select `Project Plan Tasks`.
5. Match the live Workday project using the workbook Project value; the workbook
   string is only a lookup key and is never submitted as Workday Time Type. If the
   project match is tied, probe each matching branch with the workbook Task.
6. Follow the intermediate Conversion/phase submenu. If it is the only visible
   branch, advance through it; otherwise use an explicit `Conversion XX > Task` or
   `Phase > Task` path.
7. Match the final `menuitemradio` by its leaf text/full path and click it.
8. Verify `promptAriaInstruction` and the selected listbox option.
9. Set Hours and Comment, blur the controlled fields, then click the modal `OK`.

Never infer success from the input’s text value, generated CSS classes, or a fixed
coordinate. Never submit Workday’s final page action automatically.

## Verified fallback

The live picker also exposes this stable fallback path:

`Project Plan Tasks → Unassigned → Unassigned Time → Unassigned`

If a workbook Project/Task mapping is missing, unmatched, or ambiguous, the adapter
clicks the blank Hours control outside Time Type using a full pointer sequence,
waits for the document-level picker portal to close, reopens Time Type on that same
still-blank form, and explicitly opens `Project Plan Tasks` before selecting that
exact path. No Hours, Comment, or `OK` action occurs before the fallback. This avoids
relying on synthetic Escape events to reset the portal. Picker loading failures,
missing DOM controls, and date mismatches do not trigger the fallback; they remain
errors. The completion modal reports the number of entries that used it.

When the popup preference `Auto-match Workday fields` is turned off, the adapter
selects this same Unassigned path immediately for each entry. Workday still requires
a Time Type for a new entry, so the disabled-auto-match behavior is deterministic
and valid rather than leaving a required field blank.

## Discovering a user’s project codes

Workday does not expose the full user-specific code catalog in the initial calendar
DOM. The adapter must open a fresh Enter Time modal, wait until the Time Type input
is visibly actionable, open it, and then inventory the asynchronously rendered
`menuitem`/`menuitemradio` nodes. On the live account, `Project Plan Tasks` exposed:

The open picker is rendered as a separate Workday portal/dialog rather than as a
descendant of the Enter Time dialog. This is why a DOM query scoped only to the
entry dialog will not find project codes; picker queries must be document-global and
visibility-filtered.

- Administration
- Bitterroot Bio - NS and Operational BPO (FAST) - DA - Operational Accounting
- Bitterroot Bio - NS and Operational BPO (FAST) - RB - ERP Implementation - Tier 3
- Cerebras - NetSuite Optimization - Other - DS
- Cerebras - NetSuite Optimization - System Administration
- Practice Development
- Unassigned

`Most Recently Used` is a separate lazy-loaded branch. These options must be read at
runtime because they reflect the user’s Workday permissions and current data, not a
static extension-owned list. The adapter matches accessible labels and full paths,
then refuses ambiguous matches or uses the verified Unassigned fallback for missing
workbook mappings.

## Live Tuesday example

The live DOM was exercised for Tuesday, 11/03/2026 without committing the entry:

1. Click `nonTimedDaySeparator_2`; Workday opened an `Enter Time` dialog dated
   `11/03/2026`.
2. Click `input[data-uxi-widget-type="selectinput"]`; root options appeared after
   roughly 0.9 seconds.
3. Select `Project Plan Tasks`, then `Unassigned`, then `Unassigned Time`; each
   submenu required an asynchronous wait of roughly 0.5–0.7 seconds.
4. Select the final `menuitemradio` labeled
   `Unassigned > Unassigned Time > Unassigned`; Workday confirmed it through the
   selected listbox option and `promptAriaInstruction` after roughly 1 second.
5. Entering Hours as `1` alone left the field invalid. Entering `1.0` and blurring
   cleared the validation while Workday displayed `1`; the adapter now follows this
   sequence. The Comment textarea accepted `Lorem ipsum dolor sit amet.`.
6. `OK` is the commit boundary and was intentionally not clicked during analysis.

After clicking `OK`, Workday closes the modal first, then asynchronously renders the
saved calendar event and emits `Your changes have been saved`. The saved event uses
`data-automation-id="calendarevent"`, `data-automation-appointment-style="saved"`,
and a date-specific `data-automation-startdate` such as `11-3-0-0`. The adapter now
waits up to 5 seconds for the dialog to close and for either a new date-matching
calendar event or a fresh save notification before starting the next workbook entry.
