import type { AdminViewProps, Locale } from 'payload'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import { getVisibleEntities } from '@payloadcms/ui/shared'
import { PasskeysManagementClient } from '../PasskeysManagementClient.js'

type PasskeysViewProps = AdminViewProps

/**
 * Passkeys management view for Payload admin panel.
 * Server component that provides the admin layout.
 */
export async function PasskeysView({
  initPageResult,
  params,
  searchParams,
}: PasskeysViewProps) {
  const { req } = initPageResult
  const { payload } = req

  // Await params/searchParams for Next.js 15+ compatibility
  const resolvedParams = params ? await params : undefined
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const visibleEntities = getVisibleEntities({ req })

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
      <PasskeysManagementClient />
    </DefaultTemplate>
  )
}

export default PasskeysView
