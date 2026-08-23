# Release copy — prepared, not applied

Exact metadata/copy staged for the future publication step (docs/NEXT.md
Step 3). Nothing here has been applied externally: no npm publish, no GitHub
description/topics change, no tag or release, no awesome-list PR. Apply only
after explicit user approval of external publication.

## GitHub repository description

> DSH plugin that auto-continues a native continuable subagent once when it ends with explicit max-tokens termination — then stops. No loops, no timers, official seams only.

## GitHub topics

`dsh-plugin`, `dsh`, `cordis`, `subagent`, `max-tokens`, `watchdog`

## npm metadata (already in package.json)

- name/version: `dsh-subagent-watchdog@0.1.0`
- description: "DSH plugin: safe auto-continue-once recovery for native continuable subagents that end with explicit max-tokens termination. No timers, no polling, no private APIs."
- keywords: `dsh`, `dsh-plugin`, `cordis`, `subagent`, `max-tokens`, `auto-continue`, `watchdog`

## Awesome-list one-liner (user-visible benefit)

> Automatically continues a DSH subagent exactly once when it dies mid-task from hitting its token limit — then gets out of the way.

## Verified install command (for the eventual npm artifact)

```sh
dsh plugin --profile <profile> add dsh-subagent-watchdog
```

Verified locally on `dsh` 0.1.1-rc.2 via the identical tarball path
(`dsh plugin --profile headless add ./dsh-subagent-watchdog-0.1.0.tgz`);
see docs/NEXT.md "Release candidate" for the full check record.
