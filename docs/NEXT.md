# NEXT — npm published; GitHub v0.1.0 release explicitly authorized

Status: `dsh-subagent-watchdog@0.1.0` is live on the public npm registry and the public install path has been verified from a fresh isolated DSH profile. Feature development remains stopped.

The user has now explicitly approved the next external-publication step: apply GitHub discovery metadata and create the `v0.1.0` GitHub tag/release. Do **not** submit to `awesome-dsh-plugin` in this step.

## Published npm artifact — fixed reference

The npm registry reports `gitHead = feacda5594a276cbdd9fb2ba8262eaf1585865fb` for `dsh-subagent-watchdog@0.1.0`.

Therefore the GitHub release tag **must point to exactly**:

`feacda5594a276cbdd9fb2ba8262eaf1585865fb`

Do not tag current `main` if it has advanced beyond that commit, and never move/reuse `v0.1.0` to another commit.

## Authorized action — GitHub publication step only

Execute exactly these actions, then STOP:

1. Pull latest `origin/main` and read `AGENTS.md`, `docs/NEXT.md`, `docs/RELEASE-COPY.md`, and the current public `README.md`.
2. Verify npm still exposes `dsh-subagent-watchdog@0.1.0` with `gitHead feacda5594a276cbdd9fb2ba8262eaf1585865fb`. If not, STOP and report.
3. Apply the staged GitHub repository description:
   `DSH plugin that auto-continues a native continuable subagent once when it ends with explicit max-tokens termination — then stops. No loops, no timers, official seams only.`
4. Apply exactly these GitHub topics:
   `dsh-plugin`, `dsh`, `cordis`, `subagent`, `max-tokens`, `watchdog`.
5. Create tag `v0.1.0` pointing **exactly** to `feacda5594a276cbdd9fb2ba8262eaf1585865fb`.
6. Create a concise GitHub Release for `v0.1.0` using the reviewed README/release copy. Keep claims aligned with the evidence calibration in `README.md` and `docs/PROTOCOL-DEVIATION-2026-08-23.md`; do not claim that every acceptance criterion was directly instrumented in the final packaged run.
7. Verify after creation that:
   - repository description is correct;
   - all six topics are present;
   - `v0.1.0` resolves to the exact npm-published `gitHead`;
   - the GitHub Release is public and attached to `v0.1.0`.
8. Record only the GitHub publication evidence in this file, commit and push the documentation update to `main`.
9. **STOP and report.** Do not open or submit any awesome-list PR in this step.

## Hard stop conditions

- npm `gitHead` mismatch => STOP.
- `v0.1.0` already exists but points anywhere other than `feacda5594a276cbdd9fb2ba8262eaf1585865fb` => STOP; do not retag or force-move it.
- GitHub metadata/tag/release mutation failure => STOP and report exact error; do not improvise around permissions or authentication.
- No product-code changes.
- No npm republish/version change.
- No awesome-list submission yet.

## Later — awesome-list, not yet authorized

Current `awesome-dsh-plugin` rules require repository age >= 1 day and >= 10 commits, plus a real working plugin, `dsh.bundle`, accurate description, and `dsh-plugin` topic. This repo was created at `2026-08-23T02:38:54Z`, so the age gate opens at `2026-08-24T02:38:54Z` (10:38:54 UTC+8). Commit-count gate is already satisfied.

After that time, wait for a new explicit user approval before submitting the ecosystem entry.
