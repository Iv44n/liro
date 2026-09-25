import { useMembers } from '#/features/organization/hooks/use-members'
import { Checkbox } from '#/shared/components/ui/checkbox'
import { FieldLabel } from '#/shared/components/ui/field'
import { Skeleton } from '#/shared/components/ui/skeleton'

/**
 * Picks recipients among the organization's members (the API only accepts
 * verified emails of current members; an invalid pick surfaces as a 422 on
 * submit, listing which ones).
 */
export function EmailRecipientsPicker({
  value,
  onChange,
  disabled
}: {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const membersQuery = useMembers()

  if (membersQuery.isPending) return <Skeleton className="h-24 w-full" />

  const members = membersQuery.data?.members ?? []
  if (members.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No hay miembros con correo en la organización.
      </p>
    )
  }

  return (
    <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border p-2">
      {members.map(member => {
        const email = member.user?.email
        if (!email) return null
        const checked = value.includes(email)
        return (
          <FieldLabel
            key={member.id}
            className="flex items-center gap-2 rounded-lg p-1.5 text-sm font-normal has-disabled:opacity-50 hover:bg-muted/50"
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={next =>
                onChange(
                  next
                    ? [...value, email]
                    : value.filter(item => item !== email)
                )
              }
            />
            <span className="min-w-0 flex-1 truncate">
              {member.user?.name || email}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {email}
            </span>
          </FieldLabel>
        )
      })}
    </div>
  )
}
