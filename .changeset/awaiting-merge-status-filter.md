---
"@stoneforge/smithy-web": patch
---

feat(smithy-web): add merge-status filter to the Awaiting Merge kanban column

The Awaiting Merge column previously offered Priority, Assignee, and Tag filters but no way to narrow to tasks at a specific stage of the merge pipeline. Operators reviewing what needs human attention had to scan all tasks visually, mixing in-flight `testing` / `merging` items with truly review-ready `awaiting_approval` ones.

Adds a "Merge status" dropdown scoped to the `awaiting_merge` column (other columns don't carry this metadata yet) with all nine `MergeStatus` values: pending, testing, merging, awaiting_approval (review), conflict, test_failed, failed, merged, not_applicable. The filter persists in localStorage alongside the existing column preferences.
