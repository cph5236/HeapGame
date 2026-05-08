#!/usr/bin/env node
// Usage: node scripts/bump-version.js [patch|minor|major]
//   or:  npm run bump [patch|minor|major]
// Defaults to "patch" if no argument is given.
//
// Updates: package.json version, android/app/build.gradle versionCode + versionName.

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const bumpType = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error(`Unknown bump type: "${bumpType}". Use patch, minor, or major.`)
  process.exit(1)
}

// --- package.json ---
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const oldVersion = pkg.version

const [major, minor, patch] = oldVersion.split('.').map(Number)
let newVersion
if (bumpType === 'major') newVersion = `${major + 1}.0.0`
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`
else newVersion = `${major}.${minor}.${patch + 1}`

pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

// --- build.gradle ---
const gradlePath = join(root, 'android', 'app', 'build.gradle')
let gradle = readFileSync(gradlePath, 'utf8')

const oldVersionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1])
if (isNaN(oldVersionCode)) {
  console.error('Could not parse versionCode from build.gradle')
  process.exit(1)
}
const newVersionCode = oldVersionCode + 1

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${newVersionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${newVersion}"`)

writeFileSync(gradlePath, gradle, 'utf8')

console.log(`Bumped ${bumpType}: ${oldVersion} → ${newVersion}`)
console.log(`  package.json  version: ${newVersion}`)
console.log(`  build.gradle  versionCode: ${oldVersionCode} → ${newVersionCode}`)
console.log(`  build.gradle  versionName: "${newVersion}"`)
