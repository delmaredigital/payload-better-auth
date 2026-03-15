import type { AdminViewProps, Locale } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { getVisibleEntities } from '@payloadcms/ui/shared'
import { ApiKeysManagementClient, type OrganizationOption } from '../ApiKeysManagementClient.js'
import { getApiKeyPermissionsConfig } from '../../../plugin/index.js'
import { generateCollectionPermissions } from '../../../utils/generatePermissions.js'

type ApiKeysViewProps = AdminViewProps

/**
 * Fetch organizations the current user belongs to.
 * Returns an empty array if the members/organizations collections don't exist.
 */
async function getUserOrganizations(
  payload: AdminViewProps['initPageResult']['req']['payload'],
  userId: string | number
): Promise<OrganizationOption[]> {
  try {
    // Check if members and organizations collections exist
    const collectionSlugs = payload.config.collections.map((c) => c.slug)
    if (!collectionSlugs.includes('members') || !collectionSlugs.includes('organizations')) {
      return []
    }

    // Find all memberships for this user
    const memberships = await payload.find({
      collection: 'members',
      where: { user: { equals: userId } },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })

    if (memberships.docs.length === 0) return []

    // Fetch organization details
    const orgIds = memberships.docs.map((m) => (m as Record<string, unknown>).organization)
    const orgs = await payload.find({
      collection: 'organizations',
      where: { id: { in: orgIds } },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })

    return orgs.docs.map((org) => ({
      id: (org as Record<string, unknown>).id as string | number,
      name: ((org as Record<string, unknown>).name as string) || String((org as Record<string, unknown>).id),
    }))
  } catch {
    // Collections might not exist or have different schemas — return empty
    return []
  }
}

/**
 * API Keys management view for Payload admin panel.
 * Server component that provides the admin layout.
 */
export async function ApiKeysView({
  initPageResult,
  params,
  searchParams,
}: ApiKeysViewProps) {
  const { req } = initPageResult
  const { payload } = req

  // Await params/searchParams for Next.js 15+ compatibility
  const resolvedParams = params ? await params : undefined
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const visibleEntities = getVisibleEntities({ req })

  // Build permission definitions from collections
  const permissionsConfig = getApiKeyPermissionsConfig()
  const permissions = generateCollectionPermissions(
    payload.config.collections,
    permissionsConfig?.excludeCollections
  )

  // Fetch user's organizations if the organization plugin is in use
  const userId = req.user?.id
  const organizations = userId
    ? await getUserOrganizations(payload, userId)
    : []

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={req.locale as Locale | undefined}
      params={resolvedParams}
      payload={payload}
      permissions={initPageResult.permissions}
      searchParams={resolvedSearchParams}
      user={req.user ?? undefined}
      visibleEntities={visibleEntities}
    >
      <ApiKeysManagementClient
        permissions={permissions}
        organizations={organizations}
      />
    </DefaultTemplate>
  )
}

export default ApiKeysView
