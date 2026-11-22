#!/usr/bin/env node
/**
 * Fails when the three places that must carry the same package name drift apart.
 *
 * DSH's client-modules layer rejects a browser bundle whose lazy factory
 * registers under an id other than the package name:
 *
 *   <url>: loaded without registering "dsh-deferred-ask" via __ModuleLoader__.load
 *
 * The failure is silent in the shell — the plugin's Host half still reports
 * `fiberPhase: active` while nothing renders — so it has to be caught before
 * the tarball ships. `cordis.patch.yml` has the same trap on the Host side.
 *
 * Runs from `prepublishOnly`, so a broken bundle cannot be published.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = pkg.name
if (typeof name !== 'string' || name === '') {
  problems.push('package.json has no "name"')
}

const client = readFileSync(join(root, 'client.js'), 'utf8')
const loadCalls = [...client.matchAll(/__ModuleLoader__\.load\(\{\s*\n\s*id:\s*(['"`])([^'"`]*)\1/g)]
if (loadCalls.length !== 1) {
  problems.push(`client.js must call __ModuleLoader__.load({ id, factory }) exactly once, found ${loadCalls.length}`)
}
for (const [, , id] of loadCalls) {
  if (id !== name) problems.push(`client.js registers id "${id}" but the package is named "${name}"`)
}

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const patchNames = [...patch.matchAll(/^\s*name:\s*(\S+)\s*$/gm)].map((match) => match[1])
if (patchNames.length === 0) {
  problems.push('cordis.patch.yml declares no `name`')
}
for (const declared of patchNames) {
  if (declared !== name) problems.push(`cordis.patch.yml inserts "${declared}" but the package is named "${name}"`)
}

if (problems.length > 0) {
  console.error('[check-bundle-names] refusing to publish:')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('[check-bundle-names] DSH loads a client bundle under the package name; see PUBLISHING.md.')
  process.exit(1)
}

console.log(`[check-bundle-names] ok: client id, bundle patch name and package name all read "${name}"`)
