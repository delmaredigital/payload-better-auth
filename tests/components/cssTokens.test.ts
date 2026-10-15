import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Payload 4 retired the `--theme-*`, `--base`, `--style-radius-*` variables. An
// undefined custom property fails silently in the browser (the declaration is
// dropped), so this checks every `var(--…)` the components use against the CSS
// that the installed @payloadcms/ui ships.

const require = createRequire(import.meta.url)

function filesUnder(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(full, ext)
    return ext.test(entry.name) ? [full] : []
  })
}

function payloadDefinedProperties(): Set<string> {
  const uiDist = dirname(require.resolve('@payloadcms/ui'))
  const root = uiDist.slice(0, uiDist.lastIndexOf('/dist') + '/dist'.length)
  const defined = new Set<string>()
  for (const file of filesUnder(root, /\.css$/)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) {
      defined.add(match[1])
    }
  }
  return defined
}

describe('admin component CSS variables', () => {
  it('only references custom properties that @payloadcms/ui defines', () => {
    const defined = payloadDefinedProperties()
    expect(defined.has('--color-text')).toBe(true)

    const componentsDir = join(dirname(new URL(import.meta.url).pathname), '../../src/components')
    const undefinedRefs: string[] = []
    for (const file of filesUnder(componentsDir, /\.tsx?$/)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/var\((--[\w-]+)/g)) {
        if (!defined.has(match[1])) undefinedRefs.push(`${file.slice(componentsDir.length + 1)}: ${match[1]}`)
      }
    }
    expect(undefinedRefs).toEqual([])
  })
})
