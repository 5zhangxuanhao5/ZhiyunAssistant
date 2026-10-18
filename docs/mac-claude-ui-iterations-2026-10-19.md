# Mac Claude UI iterations — 2026-10-19

Two consecutive UI revisions are preserved as separate commits and tags. The application package version remains 1.8.1/build16 because this upload archives source, not a new signed application release.

## First pass

Tag: `mac-claude-ui-round1-20261018`. Source was reconstructed from the 2026-10-18 local edit history at the boundary immediately before the second user request (23:33:53 Asia/Shanghai). Seven source files match the recorded next-message backups byte for byte. Historical source writes/text patches restore the remaining changes. Theme previews were regenerated from this recovered source with synthetic fixtures; they are refreshed previews, not claimed to be the original historical screenshot bytes.

The first pass replaces layered CSS, reorganises classroom/study controls, redesigns the floating agent into task cards with live step status and collapsed completion summaries, and unifies native toolbar symbols/window surfaces. It retains 20 themes. Local validation: 205 Node/DOM tests and 58 browser-module/resource checks passed; all 20 themes passed the real hidden-WebKit gallery.

## Scope and recovery

Only Mac source and this revision record were updated. Other clients, existing release tags and previously uploaded 1.8.1 installer assets remain unchanged. No handoff-package API keys, account state, notes, recordings, signing material, build output or installed dependencies were uploaded. Check out either tag to recover that revision. The latest source is on main; the old 1.8.1 release installers do not contain these UI passes.
