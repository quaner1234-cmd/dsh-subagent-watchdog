# NEXT — v0.1 implementation plan

Preconditions: read [DSH-SEAMS.md](DSH-SEAMS.md) first; it fixes the verified seams and
the vocabulary used below. Do not start until its §6 open items are closed.

## 0. Close the open items (blocking)

Run on the `cordis` preset via the `cordis-plugin-development` workflow, before any
`cordis_define`:

1. Confirm listener visibility for a root-mounted dynamic plugin on
   `subagent/start|end` (scope-carrier composition).
2. Decide the notice source kind: reuse `subagent-settled` vs a dedicated
   merge-extensible kind; confirm how unknown kinds render in the UI.
3. Check whether `dsh-llm-retry` is mounted in production host compositions.
4. Verify cold-resume ordering: `subagent/start` must fire before the resumed turn's
   events reach `session/event`, or the child-id filter misses terminal records.

## 1. Author the plugin (dynamic first)

One host-plane dynamic Cordis plugin (`cordis_define` → approval → `cordis_run`):

- Listeners registered inside `apply(ctx)` only: `subagent/start`, `subagent/end`,
  `session/event` (filtered to `turn/end` for known child session ids).
- State: run records keyed by `runId`; scalars extracted from payloads only — never
  stringify live runtime objects.

## 2. Detection

High-confidence table (from DSH-SEAMS §5): `max-tokens`, `error` (+ folded
`LlmFailure.code/status/message`), infrastructure rejection (`subagent/end` with
`stopReason:'error'` from a rejected result promise), `refusal`. Everything else,
including unknown future variants: silent.

## 3. Parent notification

- Mirror the runtime's own delivery pattern: `parent.followup` when idle, `steer`
  when running. One short user-role message, `[watchdog]`-tagged, ≤4096 bytes:
  what ended, the structured failure facts when present, and the official next
  action (`send_message` to continue a continuable child; parent-side re-delegation
  for one-shot children).
- Continuable children: stay silent unless adding facts the automatic settlement
  notice does not already carry (i.e., the structured error code).

## 4. Package for distribution

Promote the validated dynamic plugin into an installable composition row package;
document installation in the README.

## Acceptance criteria

- A spawned child that terminates on max-tokens produces exactly one watchdog notice
  to the parent naming `max-tokens`.
- A child whose model request fails terminally produces one notice carrying the
  provider-neutral `LlmFailure.code`.
- Normal completions, clean aborts, and unknown stop reasons produce no notices.
- The plugin adds no tools, no UI, no persistence, and never calls
  `followup`/`interrupt`/`start` on any child.

## Explicitly out of scope (v0.1)

Auto-retry, auto-interrupt, auto-re-delegation, dashboards, team management, DAGs,
stuck heuristics, custom orchestration.
