/**
 * Generate permission definitions from Payload collections for the admin UI.
 */

import type { CollectionConfig } from 'payload'
import type { PermissionDefinition, ApiKeyPermissionsConfig } from '../types/apiKey.js'

/** Default collections to exclude from permissions UI */
const DEFAULT_EXCLUDED_COLLECTIONS = [
  'sessions',
  'verifications',
  'accounts',
  'twoFactors',
  'apiKeys',
  'api-keys',
]

/**
 * Convert slug to human-readable label.
 * e.g., 'blog-posts' -> 'Blog Posts'
 */
function slugToLabel(slug: string): string {
  return slug
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

/**
 * Generate permission definitions from Payload collections.
 * Returns a list of collections with their available actions (read/write)
 * for display in the API key management UI.
 */
export function generateCollectionPermissions(
  collections: CollectionConfig[],
  excludeCollections: string[] = DEFAULT_EXCLUDED_COLLECTIONS
): PermissionDefinition[] {
  return collections
    .filter((c) => !excludeCollections.includes(c.slug))
    .map((c) => ({
      slug: c.slug,
      label:
        (typeof c.labels?.plural === 'string' ? c.labels.plural : null) ??
        slugToLabel(c.slug) + 's',
      actions: ['read', 'write'],
    }))
}
