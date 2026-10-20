// The sign-in page (app/login/route.ts) and the helpers its routes share.
// The page is plain server-rendered HTML with inline styles and no
// script: the console bundle under /_next stays behind the access gate
// until the operator has signed in, and nothing on this page runs code.

export type LoginMode = 'users' | 'token'

const MAX_NEXT = 512

// safeNext keeps the post-login redirect inside the console: a path
// starting with a single "/", without control characters, backslashes
// or a scheme-relative "//". Anything else falls back to the console
// root, so a crafted link cannot bounce a fresh session to another site.
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_NEXT) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return '/'
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/api/console/log')) return '/'
  return raw
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

// redirectTo answers with a relative Location: the browser resolves it
// against the address it used, so no Host header ever shapes the target.
export function redirectTo(path: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store', ...headers } })
}

const ERRORS: Record<string, string> = {
  credenciales: 'Usuario o contraseña incorrectos. Tras varios fallos seguidos la cuenta se bloquea unos minutos.',
  origen: 'La petición no salió de esta consola. Vuelve a abrir la página de inicio de sesión.',
  sesion: 'Tu sesión ha terminado. Vuelve a iniciar sesión.',
}

export function loginPage(opts: { mode: LoginMode; next: string; error?: string | null; locked?: string }): string {
  const message = opts.locked || (opts.error ? ERRORS[opts.error] : '')
  const userLabel = opts.mode === 'users' ? 'Usuario' : 'Tu nombre (queda en la auditoría)'
  const passLabel = opts.mode === 'users' ? 'Contraseña' : 'Token de acceso de la consola'
  const disabled = opts.locked ? ' disabled' : ''
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Iniciar sesión · bluetardigrade</title>
<style>
  :root { color-scheme: dark light; --bg: #09090b; --card: #18181b; --line: #27272a; --text: #fafafa; --muted: #a1a1aa; --accent: #e4e4e7; --accent-ink: #18181b; --warn: #fbbf24; }
  @media (prefers-color-scheme: light) { :root { --bg: #f4f4f5; --card: #ffffff; --line: #e4e4e7; --text: #18181b; --muted: #52525b; --accent: #18181b; --accent-ink: #fafafa; --warn: #92400e; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px 24px; }
  h1 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  p.sub { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  label { display: block; margin: 14px 0 6px; font-size: 12px; color: var(--muted); }
  input { width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .msg { margin: 0 0 4px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--warn); color: var(--warn); font-size: 13px; }
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; font-weight: 600; letter-spacing: .02em; }
</style>
</head>
<body>
<main>
  <div class="brand" aria-hidden="true">bluetardigrade</div>
  <h1>Iniciar sesión</h1>
  <p class="sub">Consola SOC. La sesión se cierra sola tras un rato sin actividad.</p>
  ${message ? `<p class="msg" role="alert">${escapeHtml(message)}</p>` : ''}
  <form method="post" action="/api/console/login">
    <input type="hidden" name="next" value="${escapeHtml(opts.next)}">
    <label for="user">${userLabel}</label>
    <input id="user" name="user" autocomplete="username" maxlength="64"${opts.mode === 'users' ? ' required autofocus' : ''}${disabled}>
    <label for="password">${passLabel}</label>
    <input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required${opts.mode === 'token' ? ' autofocus' : ''}${disabled}>
    <button type="submit"${disabled}>Entrar</button>
  </form>
</main>
</body>
</html>
`
}
