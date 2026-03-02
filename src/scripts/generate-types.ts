/**
 * Type generation script for Better Auth schema.
 *
 * Generates TypeScript types by introspecting Better Auth's schema
 * and diffing plugin additions against the base schema.
 *
 * Run with: pnpm generate:types
 */

import { apiKey } from '@better-auth/api-key'
import { passkey } from '@better-auth/passkey'
import type { DBFieldAttribute } from 'better-auth/db'
import { getSchema } from 'better-auth/db'
import {
  admin,
  anonymous,
  bearer,
  emailOTP,
  genericOAuth,
  jwt,
  magicLink,
  multiSession,
  oidcProvider,
  oneTap,
  oneTimeToken,
  openAPI,
  organization,
  phoneNumber,
  twoFactor,
  username,
} from 'better-auth/plugins'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Schema = Record<string, { fields: Record<string, DBFieldAttribute> }>

// Plugins to include in type generation
// Add new plugins here as they become supported
const plugins = [
  username(),
  admin(),
  apiKey(),
  passkey(),
  bearer(),
  emailOTP({ sendVerificationOTP: async () => {} }),
  magicLink({ sendMagicLink: async () => {} }),
  phoneNumber({ sendOTP: async () => {} }),
  oneTap(),
  anonymous(),
  multiSession(),
  oneTimeToken(),
  oidcProvider({ loginPage: '' }),
  genericOAuth({
    config: [
      {
        providerId: 'generic',
        clientId: 'generic',
        clientSecret: 'generic',
      },
    ],
  }),
  openAPI(),
  organization({
    teams: { enabled: true },
  }),
  jwt(),
  twoFactor(),
]

const betterAuthConfig = {
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: 'string' as const, defaultValue: 'user', input: false },
    },
  },
  plugins,
}

const baseSchema = getSchema({ ...betterAuthConfig, plugins: [] })

/**
 * Map Better Auth field types to TypeScript types
 */
function mapType(t: string): string {
  switch (t) {
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'Date'
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    case 'number[]':
      return 'number[]'
    case 'string[]':
      return 'string[]'
    default:
      return 'unknown'
  }
}

/**
 * Convert string to PascalCase
 */
function pascal(s: string): string {
  return s
    .split(/[-_]/g)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * Find fields added by a plugin compared to base schema
 */
function diff(
  base: Schema,
  target: Schema
): Record<string, Record<string, DBFieldAttribute>> {
  const d: Record<string, Record<string, DBFieldAttribute>> = {}
  for (const [m, { fields }] of Object.entries(target)) {
    const added = Object.entries(fields).filter(
      ([k]) => !(k in (base[m]?.fields ?? {}))
    )
    if (added.length) d[m] = Object.fromEntries(added)
  }
  return d
}

/**
 * Generate TypeScript type definitions
 */
function generate(): string {
  let out = `/**
 * Auto-generated Better Auth types.
 * DO NOT EDIT - Run \`pnpm generate:types\` to regenerate.
 *
 * Generated from Better Auth schema introspection.
 * Contains types for all supported plugins and their field additions.
 */

`

  const pluginAdds: Record<
    string,
    Record<string, Record<string, DBFieldAttribute>>
  > = {}
  const seen = new Set<string>()

  // Diff each plugin's schema against base to find additions
  for (const pl of plugins) {
    const id = (pl as { id?: string }).id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const adds = diff(
      baseSchema,
      getSchema({ ...betterAuthConfig, plugins: [pl] })
    )
    for (const [m, f] of Object.entries(adds)) {
      pluginAdds[m] ??= {}
      pluginAdds[m][id] = f
    }
  }

  // Collect all models from base and plugins
  const models = new Set<string>([
    ...Object.keys(baseSchema),
    ...Object.keys(pluginAdds),
  ])

  // Generate types for each model
  for (const model of models) {
    const P = pascal(model)
    const base = baseSchema[model]?.fields ?? {}
    const pluginsForModel = pluginAdds[model] ?? {}
    const pluginIds = Object.keys(pluginsForModel)

    // Base fields type
    if (Object.keys(base).length) {
      out += `export type Base${P}Fields = {\n`
      for (const [k, f] of Object.entries(base)) {
        const fieldName = f.fieldName ?? k
        const optional = f.required ? '' : '?'
        out += `  ${fieldName}${optional}: ${mapType(f.type as string)}\n`
      }
      out += '}\n\n'
    }

    // Plugin fields mapping
    const needPluginMap = pluginIds.length > 1 || Object.keys(base).length
    if (needPluginMap && pluginIds.length) {
      out += `export type ${P}PluginFields = {\n`
      for (const [pid, flds] of Object.entries(pluginsForModel)) {
        out += `  ${JSON.stringify(pid)}: {\n`
        for (const [k, f] of Object.entries(flds)) {
          const fieldName = f.fieldName ?? k
          const optional = f.required ? '' : '?'
          out += `    ${fieldName}${optional}: ${mapType(f.type as string)}\n`
        }
        out += '  }\n'
      }
      out += '}\n\n'
    }

    // Handle single-plugin-only models
    if (!Object.keys(base).length && pluginIds.length === 1) {
      const only = pluginIds[0]
      out += `export type ${P}Fields = {\n`
      for (const [k, f] of Object.entries(pluginsForModel[only])) {
        const fieldName = f.fieldName ?? k
        const optional = f.required ? '' : '?'
        out += `  ${fieldName}${optional}: ${mapType(f.type as string)}\n`
      }
      out += '}\n\n'
      out += `export type ${P} = ${P}Fields\n\n`
      continue
    }

    // Combined type as intersection
    const parts: string[] = []
    if (Object.keys(base).length) parts.push(`Base${P}Fields`)
    if (pluginIds.length) {
      const mapName = needPluginMap ? `${P}PluginFields` : undefined
      parts.push(
        ...pluginIds.map((id) =>
          mapName ? `${mapName}[${JSON.stringify(id)}]` : 'never'
        )
      )
    }
    out += `export type ${P} = ${parts.join(' & ')}\n\n`
  }

  // Plugin ID union type
  const pluginIdUnion = [...seen].map((id) => JSON.stringify(id)).join(' | ')
  out += `/**
 * Union of all supported plugin identifiers.
 */
export type PluginId = ${pluginIdUnion}\n\n`

  // Full schema mapping
  out += `/**
 * Complete schema mapping of all models to their types.
 */
export type BetterAuthFullSchema = {\n`
  for (const model of models) {
    const P = pascal(model)
    out += `  ${JSON.stringify(model)}: ${P}\n`
  }
  out += '}\n\n'

  // Model key union
  out += `/**
 * Union of all model names in the schema.
 */
export type ModelKey = keyof BetterAuthFullSchema\n`

  return out
}

// Generate and write types
const generated = generate()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputFile = path.resolve(__dirname, '../generated-types.ts')

await fs.writeFile(outputFile, generated, 'utf8')
console.log(`Generated types written to ${outputFile}`)
