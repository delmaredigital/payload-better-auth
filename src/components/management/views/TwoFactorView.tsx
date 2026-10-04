import type { AdminViewProps, Locale } from 'payload'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import { getVisibleEntities } from '@payloadcms/ui/shared'
import { TwoFactorManagementClient } from '../TwoFactorManagementClient.js'

type TwoFactorViewProps = AdminViewProps

/**
 * Two-factor management view for Payload admin panel.
 * Server component that provides the admin layout.
 */
export async function TwoFactorView({
  initPageResult,
  params,
  searchParams,
}: TwoFactorViewProps) {
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
      <TwoFactorManagementClient />
    </DefaultTemplate>
  )
}

export default TwoFactorView
