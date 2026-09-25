import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type {
  AuthResponse,
  RequestPasswordResetRequest,
  ResetPasswordRequest,
  SendVerificationEmailRequest,
  Session,
  SignInEmailRequest,
  SignUpEmailRequest,
  StatusResponse,
  User
} from './types'

export function authClient(http: HttpClient) {
  return {
    async getSession() {
      const data = await http.get<{ user: User; session: Session } | null>(
        routes.getSession
      )
      return data ?? null
    },
    signIn: {
      async email(request: SignInEmailRequest) {
        return await http.post<AuthResponse, SignInEmailRequest>(
          routes.signInEmail,
          {
            body: request
          }
        )
      }
    },
    signUp: {
      /** Registra un nuevo usuario con correo y contraseña. */
      async email(request: SignUpEmailRequest) {
        return await http.post<AuthResponse, SignUpEmailRequest>(
          routes.signUpEmail,
          {
            body: request
          }
        )
      }
    },
    /** Cierra la sesión del usuario. */
    async signOut() {
      return await http.post<{ success: boolean }>(routes.signOutEmail)
    },
    /** Solicita el correo de restablecimiento de contraseña. */
    async requestPasswordReset(request: RequestPasswordResetRequest) {
      return await http.post<StatusResponse, RequestPasswordResetRequest>(
        routes.requestPasswordReset,
        { body: request }
      )
    },
    /** Establece una nueva contraseña usando el token del correo. */
    async resetPassword(request: ResetPasswordRequest) {
      return await http.post<StatusResponse, ResetPasswordRequest>(
        routes.resetPassword,
        { body: request }
      )
    },
    /** Reenvía el correo de verificación de cuenta. */
    async sendVerificationEmail(request: SendVerificationEmailRequest) {
      return await http.post<StatusResponse, SendVerificationEmailRequest>(
        routes.sendVerificationEmail,
        { body: request }
      )
    }
  }
}
