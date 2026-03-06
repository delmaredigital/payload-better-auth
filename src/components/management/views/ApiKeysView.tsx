import type { AdminViewProps, Locale } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { getVisibleEntities } from '@payloadcms/ui/shared'
import { ApiKeysManagementClient } from '../ApiKeysManagementClient.js'
import { getApiKeyPermissionsConfig } from '../../../plugin/index.js'
import { generateCollectionPermissions } from '../../../utils/generatePermissions.js'

type ApiKeysViewProps = AdminViewProps

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
      <ApiKeysManagementClient permissions={permissions} />
    </DefaultTemplate>
  )
}

export default ApiKeysView
