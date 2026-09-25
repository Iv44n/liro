import { CopyButton } from '#/features/runs/components/copy-button'

/**
 * How to verify a delivery: Standard Webhooks (`webhook-id`,
 * `webhook-timestamp`, `webhook-signature`) signed `v1,<base64 HMAC-SHA256>`
 * over `"{id}.{timestamp}.{body}"`, keyed by the secret. Shown right after
 * creating an endpoint or revealing its secret.
 */
const SNIPPET = `const crypto = require('node:crypto')

function verify(body, headers, secret) {
  const id = headers['webhook-id']
  const timestamp = headers['webhook-timestamp']
  const signature = headers['webhook-signature'] // "v1,<base64> …"

  const key = Buffer.from(secret.replace('whsec_', ''), 'base64')
  const expected = crypto
    .createHmac('sha256', key)
    .update(\`\${id}.\${timestamp}.\${body}\`)
    .digest('base64')

  return signature
    .split(' ')
    .some(candidate => candidate === \`v1,\${expected}\`)
}`

export function VerifyWebhookSnippet() {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Cómo verificar</p>
        <CopyButton value={SNIPPET} label="Copiar código" />
      </div>
      <p className="text-xs text-muted-foreground">
        Liro firma cada entrega según{' '}
        <a
          href="https://www.standardwebhooks.com/"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Standard Webhooks
        </a>
        : compara <code className="font-mono">webhook-signature</code> con el
        HMAC-SHA256 del cuerpo, usando este secreto.
      </p>
      <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-3 text-xs">
        <code className="font-mono">{SNIPPET}</code>
      </pre>
    </div>
  )
}
