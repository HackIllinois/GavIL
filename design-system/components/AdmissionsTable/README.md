# AdmissionsTable

Paginated applicant table. Admins get row checkboxes, a bulk-assign bar and a reviewer dropdown; staff see a lock on applicants assigned to someone else. Below 600px each row becomes a labelled card.

- **Provide:** `rows` `[{id,name,school,assignee,score,status}]`, `role` (`admin`|`staff`), `me` (current reviewer name), `reviewers`, `total`, `range`, `onAssign(ids, reviewer|null)`, `onOpen(row)`, `hrefFor(row)`, `selected` + `onSelectionChange(ids)` (controlled) or `defaultSelected`, `onPrev`/`onNext`, `emptyTitle`/`emptyBody`/`emptyIcon`.
- The applicant name is the row's keyboard target: a link with `hrefFor`, a button with `onOpen`, plain text otherwise (never a dead `#`). A tap elsewhere on the row is a pointer shortcut to the same action.
- "Select all on this page" acts on the visible page only and shows a mixed state when part of it is selected. Names never wrap; scores are right-aligned tabular numbers.
- Staff rule: staff can act on rows assigned to them or unassigned; others show a lock.
- **Empty:** with no `rows` the table is replaced by an `EmptyState` ("No applicants match"; `emptyTitle`, `emptyBody` and `emptyIcon` change it) and the footer reads "0 of N". Prev and Next stay, so a page past the end can go back.
- Reviewer selects (per row and bulk) render only with `onAssign`; without it the assignee is text. When the bulk bar closes (assigned or cleared) or a page button disables itself, focus lands on the table, never on the page.
- On a phone (600px and under) every control is a 48px target: checkboxes sit in a 48px hit area (`.gv-check-hit`), selects and name buttons are 48px tall. Selects use 16px text so iOS never zooms.
