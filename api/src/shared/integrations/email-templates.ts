const colors = {
  background: '#f2f7f3',
  ink: '#27332d',
  muted: '#68756d',
  border: '#dce8df',
  primaryDark: '#2f8448',
  white: '#ffffff'
} as const

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

interface EmailLayoutOptions {
  preheader: string
  eyebrow?: string
  title: string
  content: string
  action?: { label: string; url: string }
}

function emailLayout({
  preheader,
  eyebrow,
  title,
  content,
  action
}: EmailLayoutOptions): string {
  const actionHtml = action
    ? `<p style="margin:28px 0 8px;text-align:center">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:${colors.primaryDark};border-radius:8px;color:${colors.white};font-size:15px;font-weight:700;line-height:20px;padding:13px 22px;text-decoration:none">${escapeHtml(action.label)}</a>
      </p>
      <p style="color:${colors.muted};font-size:12px;line-height:18px;margin:14px 0 0;word-break:break-all">Or copy this link:<br>${escapeHtml(action.url)}</p>`
    : ''

  return `<!doctype html>
<html lang="en">
  <body style="background:${colors.background};color:${colors.ink};font-family:'Figtree','Trebuchet MS',Arial,sans-serif;margin:0;padding:32px 16px">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;max-width:600px;width:100%">
      <tr><td style="padding:0 8px 20px"><span style="color:${colors.ink};font-size:20px;font-weight:800;letter-spacing:-.3px">liro<span style="color:${colors.primaryDark}">.</span></span></td></tr>
      <tr><td style="background:${colors.white};border:1px solid ${colors.border};border-radius:12px;padding:40px 36px;box-shadow:0 8px 24px rgba(39,51,45,.06)">
        ${eyebrow ? `<p style="color:${colors.primaryDark};font-size:12px;font-weight:800;letter-spacing:1.2px;margin:0 0 12px;text-transform:uppercase">${escapeHtml(eyebrow)}</p>` : ''}
        <h1 style="color:${colors.ink};font-size:28px;line-height:34px;margin:0 0 18px">${escapeHtml(title)}</h1>
        ${content}
        ${actionHtml}
      </td></tr>
      <tr><td style="color:${colors.muted};font-size:12px;line-height:18px;padding:20px 8px 0">This message was sent by Liro. If you did not expect it, you can safely ignore it.</td></tr>
    </table>
  </body>
</html>`
}

export function actionEmail(options: {
  preheader: string
  title: string
  message: string
  actionLabel: string
  actionUrl: string
}): string {
  return emailLayout({
    preheader: options.preheader,
    eyebrow: 'Liro account',
    title: options.title,
    content: `<p style="color:${colors.muted};font-size:16px;line-height:25px;margin:0">${escapeHtml(options.message)}</p>`,
    action: { label: options.actionLabel, url: options.actionUrl }
  })
}

export function decisionEmail(options: {
  eventLabel: string
  template: string
  decision: string
  confidence: string
  runUrl: string
}): string {
  return emailLayout({
    preheader: `${options.eventLabel} in ${options.template}`,
    eyebrow: 'Decision activity',
    title: options.eventLabel,
    content: `<p style="color:${colors.muted};font-size:16px;line-height:25px;margin:0 0 24px">A new update is available for <strong style="color:${colors.ink}">${escapeHtml(options.template)}</strong>.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid ${colors.border};border-radius:8px;width:100%">
          <tr><td style="border-bottom:1px solid ${colors.border};color:${colors.muted};font-size:13px;padding:13px 16px">Decision</td><td style="border-bottom:1px solid ${colors.border};color:${colors.ink};font-size:15px;font-weight:700;padding:13px 16px;text-align:right">${escapeHtml(options.decision)}</td></tr>
          <tr><td style="color:${colors.muted};font-size:13px;padding:13px 16px">Confidence</td><td style="color:${colors.ink};font-size:15px;font-weight:700;padding:13px 16px;text-align:right">${escapeHtml(options.confidence)}</td></tr>
        </table>`,
    action: { label: 'View run', url: options.runUrl }
  })
}

export function alertEmail(options: {
  metric: string
  scope: string
  value: string
  threshold: string
  windowMinutes: number
}): string {
  return emailLayout({
    preheader: `Alert triggered for ${options.scope}`,
    eyebrow: 'Liro alert',
    title: 'An alert was triggered',
    content: `<p style="color:${colors.muted};font-size:16px;line-height:25px;margin:0 0 24px"><strong style="color:${colors.ink}">${escapeHtml(options.metric)}</strong> crossed its threshold for ${escapeHtml(options.scope)}.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid ${colors.border};border-radius:8px;width:100%">
          <tr><td style="border-bottom:1px solid ${colors.border};color:${colors.muted};font-size:13px;padding:13px 16px">Value</td><td style="border-bottom:1px solid ${colors.border};color:${colors.ink};font-size:15px;font-weight:700;padding:13px 16px;text-align:right">${escapeHtml(options.value)}</td></tr>
          <tr><td style="border-bottom:1px solid ${colors.border};color:${colors.muted};font-size:13px;padding:13px 16px">Threshold</td><td style="border-bottom:1px solid ${colors.border};color:${colors.ink};font-size:15px;font-weight:700;padding:13px 16px;text-align:right">${escapeHtml(options.threshold)}</td></tr>
          <tr><td style="color:${colors.muted};font-size:13px;padding:13px 16px">Window</td><td style="color:${colors.ink};font-size:15px;font-weight:700;padding:13px 16px;text-align:right">${options.windowMinutes} minutes</td></tr>
        </table>`
  })
}
