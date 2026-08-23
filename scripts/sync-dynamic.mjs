#!/usr/bin/env node
/**
 * Regenerate plugin/watchdog.host.js from lib/index.js.
 *
 * The dynamic Cordis package (`cordis_define` → `code.host`) must be a plain
 * JavaScript *function body*: no `import`/`export`, ending in the plugin
 * object. This script mechanically derives that body from the packaged ESM
 * module so the two artifacts cannot drift apart; the test suite runs every
 * scenario against both forms.
 *
 * Usage: node scripts/sync-dynamic.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'index.js'), 'utf8')

const header = `/**
 * GENERATED FILE — do not edit by hand; run \`node scripts/sync-dynamic.mjs\`.
 * Source of truth: ../lib/index.js (behavioral equivalence is test-enforced).
 *
 * dsh-subagent-watchdog — dynamic Cordis host plugin body for \`cordis_define\`.
 * Paste as the \`code.host\` field (plain JavaScript function body returning the
 * plugin object). See docs/DSH-SEAMS.md for the verified runtime seams and
 * docs/NEXT.md for the v0.1 behavior contract.
 */
`

let body = source
	.replace(/^export const name = /m, 'const name = ')
	.replace(/^export const inject = /m, 'const inject = ')
	.replace(/^export function apply\(/m, 'function apply(')
	.replace(/^export default \{ name, inject, apply \}\n?/m, '')

if (/^export /m.test(body)) {
	throw new Error('unhandled export statement found; extend scripts/sync-dynamic.mjs')
}

writeFileSync(
	join(root, 'plugin', 'watchdog.host.js'),
	`${header}${body}\nreturn { name, inject, apply }\n`,
)
console.log('plugin/watchdog.host.js regenerated from lib/index.js')
