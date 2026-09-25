import type { Organization } from '#/sdk/modules/organization/types'
import { cn } from '#/shared/utils/shadcn.utils'

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'OR'

  return trimmed
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function OrganizationLogo({
  organization,
  className
}: {
  organization: Pick<Organization, 'name' | 'logo'>
  className?: string
}) {
  if (organization.logo) {
    return (
      <img
        src={organization.logo}
        alt={organization.name}
        className={cn('size-10 shrink-0 rounded-lg object-cover', className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground',
        className
      )}
    >
      {getInitials(organization.name)}
    </div>
  )
}
