# DemoStatus

What the demo did at the table: Ran live, Partly ran, Not shown live or Didn't run. A fact the judge taps, never a rating; Table talk can only suggest it.

- **Provide:** `value` + `onChange(status)` or `defaultValue` (`ran_live` `partly_ran` `not_shown` `did_not_run`), `suggested` (from Table talk), `disabled` + `lockedReason`, `label`.
- An APG radiogroup (one tab stop; arrows, Home and End move and select). Every option has the same neutral styling: there is no order or colour scale.
- A suggestion shows a **Suggested** tag on its option and a hint line; nothing is selected until the judge taps, and the tap always wins.
- Feeds the DEMO row of `RecallBlock`, so every project has one, recorded or not. Never shown to teams or admins.
