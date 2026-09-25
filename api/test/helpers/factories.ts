import { eq } from 'drizzle-orm'
import { users } from '#modules/auth/auth.schemas'
import { API_KEY_CONFIGS, type ApiKeyMode, auth } from '#modules/auth/config'
import { db } from '#shared/db/config'

/**
 * Test data builders. Every test creates its own users and organizations with
 * unique emails/slugs, so tests never need to truncate tables and can't see
 * each other's data — which also exercises tenant isolation for free.
 */

const unique = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const TEST_PASSWORD = 'correct-horse-battery-staple'

export interface TestUser {
  id: string
  email: string
  name: string
  /** `cookie` header value for an authenticated session. */
  cookie: string
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')
}

/** A user with a verified email and a signed-in session. */
export async function createUser(
  options: { name?: string } = {}
): Promise<TestUser> {
  const id = unique()
  const email = `test_${id}@liro.test`
  const name = options.name ?? `Test ${id}`

  const signUp = await auth.api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name }
  })
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, signUp.user.id))

  const signIn = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    asResponse: true
  })
  if (!signIn.ok)
    throw new Error(`Sign-in failed for ${email}: ${signIn.status}`)

  return { id: signUp.user.id, email, name, cookie: cookieHeader(signIn) }
}

export interface TestOrg {
  id: string
  slug: string
  owner: TestUser
}

/** An organization owned by `owner` (a new user by default), active on the owner's session. */
export async function createOrg(owner?: TestUser): Promise<TestOrg> {
  const user = owner ?? (await createUser())
  const slug = `test-${unique()}`

  const organization = await auth.api.createOrganization({
    body: { name: `test_${slug}`, slug },
    headers: new Headers({ cookie: user.cookie })
  })
  if (!organization) throw new Error('createOrganization returned nothing')

  await setActiveOrganization(user, organization.id)
  return { id: organization.id, slug, owner: user }
}

export async function setActiveOrganization(
  user: TestUser,
  organizationId: string | null
) {
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: new Headers({ cookie: user.cookie })
  })
}

/** A new user added to `org` with `role`, with that org active on their session. */
export async function addMember(
  org: TestOrg,
  role: 'owner' | 'admin' | 'member'
): Promise<TestUser> {
  const user = await createUser()
  await auth.api.addMember({
    body: { userId: user.id, organizationId: org.id, role }
  })
  await setActiveOrganization(user, org.id)
  return user
}

export async function removeMember(org: TestOrg, user: TestUser) {
  await auth.api.removeMember({
    body: { memberIdOrEmail: user.email, organizationId: org.id },
    headers: new Headers({ cookie: org.owner.cookie })
  })
}

export async function createApiKey(
  org: TestOrg,
  mode: ApiKeyMode = 'live'
): Promise<{ id: string; key: string }> {
  const created = await auth.api.createApiKey({
    body: {
      configId: API_KEY_CONFIGS[mode].configId,
      organizationId: org.id,
      userId: org.owner.id,
      name: `test ${mode}`
    }
  })
  return { id: created.id, key: created.key }
}
