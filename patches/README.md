# Paseo activity grouping prototype

`paseo-0.11.0-activity-groups.patch` targets Paseo tag `v0.11.0`, commit `22488d4502cd0c8a4ee4619af991762f071b60a7`.

This is a local client-source adapter for the `tietiezhi` installation, not a new public SDK API. It only activates when that installation registers `compact-activity-group` version 1. Other plugins and native plan/subagent/worktree controls remain on their original rendering path. An unpatched client ignores the extra renderer and retains individual activity rows.

The adapter groups adjacent compact tool/reasoning rows in `createStreamPresentation`, before layout wrappers and virtualization are constructed. The group keeps the first source ID and the latest timestamp/cursor, matching native tool-group host identity. Original source events are not modified or persisted differently. Prose and canonical turn changes end groups. Groups spanning retained history and the streaming head stay hosted in history.

## Local verification

Source copy: `/tmp/paseo-activity-layout-EKZWIj`, branch `prototype/activity-groups`.

- Existing `packages/app/src/plugins/timeline/projection.test.ts`: 13 tests passed, including the actual presentation pipeline, disabled adapter, live-to-history transitions, stable IDs and source preservation.
- Changed host files: formatter and lint passed.
- Scoped host TypeScript check for the grouping/projection modules passed. Full app typecheck/build was **not** run; the source copy only has isolated validation dependencies.
- Plugin typecheck passed.
- `PASEO_ACTIVITY_SOURCE=/tmp/paseo-activity-layout-EKZWIj node tests/browser/run-activity-group.mjs` passed desktop/mobile checks: 50 activities produce one group frame, all details expand, live failure updates preserve expansion, and there is no accumulated source-row spacing.
- Browser preview uses the actual patched presentation pipeline but a fixture viewport/frame shell, **not** the installed Paseo App. Screenshots: `.artifacts/ui/grouped-activities-1100.png` and `grouped-activities-390.png`.

Apply the patch only in a clean source checkout with `git apply --check` first. The `client/activity-group.tsx` renderer and `shared/activity.ts` schema in this plugin must accompany a test client build.

## Deployment status

No installed App bundle, daemon config, credentials or conversation history was modified. Do not patch `/Applications/Paseo.app` in place. Next validation requires a separately built test client and real streaming, history pagination, reading-anchor, virtualized scrolling, native footer and teardown checks before any replacement of the installed App.
