import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'

export const Route = createFileRoute('/auth')({
  ssr: false,
  beforeLoad: () => {
    const auth = useAuth.getState().auth

    if (auth?.session) {
      throw redirect({
        to: '/dashboard',
        replace: true
      })
    }
  },
  component: Outlet
})
