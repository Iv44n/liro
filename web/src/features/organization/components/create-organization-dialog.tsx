import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '#/shared/components/ui/dialog'
import { CreateOrganizationForm } from './create-organization-form'

export function CreateOrganizationDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="rounded-md" />}>
        <PlusIcon />
        Nueva organización
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Crear organización</DialogTitle>
        </DialogHeader>
        <CreateOrganizationForm onCancel={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
