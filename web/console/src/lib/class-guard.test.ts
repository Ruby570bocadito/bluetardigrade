// Regression guard for corrupted Tailwind arbitrary classes. Origin:
// a display channel of one audit environment once mangled
// `grid-cols-[minmax(` into `grid-cols-inmax(` while showing source
// lines, fabricating a phantom defect — the blobs were always
// canonical (retracted with byte-level evidence in the 2026-10-01 acta
// of 02-B). The
// shape is still a real corruption class for merges and hand edits,
// and Tailwind v4's lenient bare-value recovery would compile it
// silently, so the guard pins the canonical form and proves the tree
// stays clean — without anyone trusting a display again.
//
// The guard can fail by construction: the fixture below reproduces the
// corrupted shape (built by concatenation so this file itself never
// carries the literal), and the tree scan must stay clean.
//
//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CORRUPTED_CLASS = /(?:grid|flex)-cols-[A-Za-z0-9:_-]*inmax\(/

function corruptedSample(): string {
  // Assembled, never literal: the scan below excludes *.test.ts, but
  // the concatenation keeps the sample out of every grep of the tree.
  return 'md:grid-' + 'cols-' + 'inmax(0,1fr)_auto]'
}

function canonicalSamples(): string[] {
  return [
    'md:grid-cols-[minmax(0,1fr)_auto]',
    'xl:grid-cols-[minmax(0,1fr)_380px]',
    'grid-cols-[auto_minmax(0,3fr)_minmax(0,2fr)_auto_auto]',
    'lg:grid-cols-[290px_minmax(0,1fr)]',
    'grid-cols-3',
  ]
}

describe('class guard (corrupted arbitrary grid templates)', () => {
  test('the guard detects the corrupted shape (falsability)', () => {
    expect(CORRUPTED_CLASS.test(corruptedSample())).toBe(true)
    expect(CORRUPTED_CLASS.test('xl:grid-' + 'cols-' + 'inmax(0,1fr)_380px]')).toBe(true)
  })

  test('the guard ignores canonical arbitrary templates', () => {
    for (const sample of canonicalSamples()) {
      expect(CORRUPTED_CLASS.test(sample)).toBe(false)
    }
  })

  test('the tree carries zero corrupted arbitrary classes', () => {
    // import.meta.dir is src/lib; the scan root is src itself.
    const root = join(import.meta.dir, '..')
    const offenders: string[] = []

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (!/\.(tsx|ts)$/.test(path) || /\.test\.tsx?$/.test(path)) continue
        const source = readFileSync(path, 'utf8')
        const lines = source.split('\n')
        lines.forEach((line, index) => {
          if (CORRUPTED_CLASS.test(line)) offenders.push(`${path}:${index + 1}`)
        })
      }
    }

    walk(root)
    expect(offenders).toEqual([])
  })
})
