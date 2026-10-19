# Mac Claude revisions — 2026-10-19

Four consecutive Claude revisions are preserved as separate commits and tags. This is source archival; application package version remains 1.8.1/build16, and existing installer assets are unchanged.

| Revision | Tag | Scope |
| --- | --- | --- |
| 1 | `mac-claude-ui-round1-20261018` | Workspace, theme and task-card redesign |
| 2 | `mac-claude-ui-round2-20261019` | Timetable, appearance and agent refinements |
| 3 | `mac-claude-ui-round3-20261019` | Study-pane chrome, compact execution status and background course-material search |

## Recovery and validation

Revisions 1–2 were previously cloud-download verified. Revision 3 is reconstructed from the verified revision-2 snapshot and historical source writes/text patches at the next user-request boundary (2026-10-19 08:32:41 Asia/Shanghai); ten source files match the recorded file-history backups byte for byte. Its synthetic theme-preview images are regenerated using the recovered source, not claimed to be original historical screenshot bytes. Revision 4 is copied from the current Claude Mac working project, including the follow-up change to local credential persistence.

Local validation passed: revision 3 has 221 Node/DOM tests, revision 4 has 230, and each has 58 browser-module/resource checks. A hidden-WebKit theme gallery refreshes revision-3 previews. GitHub CI validates the latest uploaded source separately. These checks do not claim all live course formats or physical input devices were retested.

Only Mac source and revision documentation are updated. Other clients, existing tags and previously uploaded installers remain unchanged. Actual API keys, account state, notes, recordings, signing material, build outputs and installed dependencies are excluded. Existing local service configuration files remain on the user's computer. Check out a revision tag to recover that source; the earlier 1.8.1 release installers do not contain these changes.
