export type User = {
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
  id: string
}

export type Session = {
  id: string
  token: string
  userId: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  updatedAt: Date
  activeOrganizationId?: string | null
}

export type SignInEmailRequest = {
  email: string
  password: string
}

export type SignUpEmailRequest = {
  name: string
  email: string
  password: string
  /** URL a la que redirigir tras verificar el correo desde el enlace. */
  callbackURL?: string
}

export type AuthResponse = {
  redirect?: boolean
  token?: string | null
  url?: string | null
  user: User
}

export type RequestPasswordResetRequest = {
  email: string
  /** URL del frontend donde el usuario elegirá la nueva contraseña. */
  redirectTo: string
}

export type ResetPasswordRequest = {
  token: string
  newPassword: string
}

export type SendVerificationEmailRequest = {
  email: string
  callbackURL?: string
}

export type StatusResponse = {
  status: boolean
}
