export const routes = {
  getSession: '/auth/get-session',
  signInEmail: '/auth/sign-in/email',
  signUpEmail: '/auth/sign-up/email',
  signOutEmail: '/auth/sign-out',
  requestPasswordReset: '/auth/request-password-reset',
  resetPassword: '/auth/reset-password',
  sendVerificationEmail: '/auth/send-verification-email'
} as const
