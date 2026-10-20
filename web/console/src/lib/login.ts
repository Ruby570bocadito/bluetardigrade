// The sign-in pages (app/login/route.ts, app/cuenta/*) and the helpers
// their routes share: password, second step, enrollment with its QR
// code, recovery codes, the account's two-step settings and password
// changes (forced after an administrator's reset, or the operator's own). They
// are plain server-rendered HTML with inline styles and no script: the
// console bundle under /_next stays behind the access gate until the
// operator has signed in, and nothing on these pages runs code.

import { groupSecret } from './totp'

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
export function redirectTo(path: string, headers: Record<string, string> = {}, cookies: string[] = []): Response {
  return withCookies(new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store', ...headers } }), cookies)
}

export function htmlResponse(html: string, cookies: string[] = [], status = 200): Response {
  return withCookies(new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }), cookies)
}

function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append('set-cookie', c)
  return res
}

const MESSAGES: Record<string, string> = {
  credenciales: 'Usuario o contraseña incorrectos. Tras varios fallos seguidos la cuenta se bloquea unos minutos.',
  origen: 'La petición no salió de esta consola. Vuelve a abrir la página de inicio de sesión.',
  sesion: 'Tu sesión ha terminado. Vuelve a iniciar sesión.',
  codigo: 'Código incorrecto o ya usado. Escribe el que muestra ahora tu app.',
  bloqueada: 'Demasiados códigos incorrectos: la verificación de esta cuenta queda bloqueada 15 minutos.',
  caducado: 'El inicio de sesión ha caducado (5 minutos o 5 códigos incorrectos). Vuelve a escribir tu contraseña.',
  escritura: 'No se pudo guardar el cambio en el fichero de cuentas. Revisa que la consola pueda escribirlo.',
  desactivada: 'Has desactivado la verificación en dos pasos. Vuelve a iniciar sesión.',
  corta: 'La contraseña nueva debe tener al menos 12 caracteres.',
  larga: 'La contraseña nueva es demasiado larga (1024 caracteres como mucho).',
  distintas: 'Las dos contraseñas nuevas no coinciden.',
  igual: 'La contraseña nueva debe ser distinta de la actual.',
  actual: 'La contraseña actual no es correcta.',
}

export function messageFor(key: string | null | undefined): string {
  return key ? MESSAGES[key] ?? '' : ''
}

const STYLE = `
  :root { color-scheme: dark light; --bg: #09090b; --card: #18181b; --line: #27272a; --text: #fafafa; --muted: #a1a1aa; --accent: #e4e4e7; --accent-ink: #18181b; --warn: #fbbf24; }
  @media (prefers-color-scheme: light) { :root { --bg: #f4f4f5; --card: #ffffff; --line: #e4e4e7; --text: #18181b; --muted: #52525b; --accent: #18181b; --accent-ink: #fafafa; --warn: #92400e; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px 24px; }
  main.wide { max-width: 440px; }
  h1 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  h2 { margin: 22px 0 4px; font-size: 14px; font-weight: 600; }
  p { margin: 8px 0; }
  p.sub, .note { color: var(--muted); font-size: 13px; }
  p.sub { margin: 0 0 20px; }
  label { display: block; margin: 14px 0 6px; font-size: 12px; color: var(--muted); }
  input { width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
  input.code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 16px; letter-spacing: .08em; }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button, a.button { display: block; width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; }
  button.quiet { margin-top: 12px; background: transparent; color: var(--text); border: 1px solid var(--line); font-weight: 500; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  a { color: inherit; }
  .msg { margin: 0 0 4px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--warn); color: var(--warn); font-size: 13px; }
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; font-weight: 600; letter-spacing: .02em; }
  .qr { display: flex; justify-content: center; margin: 14px 0 6px; }
  .qr svg { width: 196px; height: 196px; border-radius: 8px; }
  code.secret { display: block; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); font: 14px/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .06em; word-break: break-all; user-select: all; }
  ol.codes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 12px 0; padding-left: 22px; font: 14px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace; user-select: all; }
  .back { display: block; margin-top: 16px; font-size: 12px; color: var(--muted); text-align: center; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 22px 0 0; }
`

function shell(title: string, body: string, wide = false): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · bluetardigrade</title>
<style>${STYLE}</style>
</head>
<body>
<main${wide ? ' class="wide"' : ''}>
  <div class="brand" aria-hidden="true">bluetardigrade</div>
${body}
</main>
</body>
</html>
`
}

function alert(message: string): string {
  return message ? `  <p class="msg" role="alert">${escapeHtml(message)}</p>\n` : ''
}

export function loginPage(opts: { mode: LoginMode; next: string; error?: string | null; locked?: string }): string {
  const message = opts.locked || messageFor(opts.error)
  const userLabel = opts.mode === 'users' ? 'Usuario' : 'Tu nombre (queda en la auditoría)'
  const passLabel = opts.mode === 'users' ? 'Contraseña' : 'Token de acceso de la consola'
  const disabled = opts.locked ? ' disabled' : ''
  return shell('Iniciar sesión', `  <h1>Iniciar sesión</h1>
  <p class="sub">Consola SOC. La sesión se cierra sola tras un rato sin actividad.</p>
${alert(message)}  <form method="post" action="/api/console/login">
    <input type="hidden" name="next" value="${escapeHtml(opts.next)}">
    <label for="user">${userLabel}</label>
    <input id="user" name="user" autocomplete="username" maxlength="64"${opts.mode === 'users' ? ' required autofocus' : ''}${disabled}>
    <label for="password">${passLabel}</label>
    <input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required${opts.mode === 'token' ? ' autofocus' : ''}${disabled}>
    <button type="submit"${disabled}>Entrar</button>
  </form>`)
}

// codeField: a 6-digit app code or a recovery code (letters and a dash),
// so no numeric keyboard; one-time-code lets the phone offer the code.
function codeField(label: string, id = 'code'): string {
  return `    <label for="${id}">${label}</label>
    <input id="${id}" name="code" class="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" maxlength="32" required autofocus>`
}

export function codePage(opts: { user: string; next: string; error?: string | null }): string {
  return shell('Verificación en dos pasos', `  <h1>Verificación en dos pasos</h1>
  <p class="sub">${escapeHtml(opts.user)}: escribe el código de 6 cifras de tu app de autenticación.</p>
${alert(messageFor(opts.error))}  <form method="post" action="/api/console/login">
    <input type="hidden" name="step" value="code">
    <input type="hidden" name="next" value="${escapeHtml(opts.next)}">
${codeField('Código')}
    <button type="submit">Verificar</button>
  </form>
  <p class="note">¿Sin el móvil? Escribe uno de tus códigos de recuperación en el mismo campo; cada uno sirve una vez.</p>
  <a class="back" href="/login?next=${encodeURIComponent(opts.next)}">Empezar de nuevo</a>`)
}

// enrollBody: the QR code (drawn on the server, lib/qr.ts), the same
// secret typed out, and the code that proves the app holds it.
function enrollBody(opts: { secret: string; qr: string | null; error?: string | null; action: string; hidden: string; intro: string }): string {
  return `${alert(messageFor(opts.error))}  <p>${opts.intro}</p>
  <p>1. En tu app de autenticación (Microsoft o Google Authenticator, Aegis, 1Password, Bitwarden…) añade una cuenta escaneando este código:</p>
${opts.qr ? `  <div class="qr">${opts.qr}</div>\n` : ''}  <p>¿No puedes escanearlo? Escribe esta clave en la app (tipo «basada en tiempo»):</p>
  <code class="secret">${escapeHtml(groupSecret(opts.secret))}</code>
  <form method="post" action="${opts.action}">
${opts.hidden}
${codeField('2. Escribe el código de 6 cifras que muestra la app')}
    <button type="submit">Activar</button>
  </form>`
}

export function enrollPage(opts: { user: string; roleLabel: string; secret: string; qr: string | null; next: string; error?: string | null }): string {
  const hidden = `    <input type="hidden" name="step" value="enroll">
    <input type="hidden" name="next" value="${escapeHtml(opts.next)}">`
  return shell('Activa la verificación en dos pasos', `  <h1>Activa la verificación en dos pasos</h1>
  <p class="sub">${escapeHtml(opts.user)} · ${escapeHtml(opts.roleLabel)}</p>
${enrollBody({ ...opts, action: '/api/console/login', hidden, intro: `Tu rol (${escapeHtml(opts.roleLabel)}) entra con contraseña y un código del móvil. Configúralo una vez para continuar.` })}
  <a class="back" href="/login?next=${encodeURIComponent(opts.next)}">Empezar de nuevo</a>`, true)
}

export function recoveryPage(opts: { codes: string[]; next: string; first: boolean }): string {
  return shell('Códigos de recuperación', `  <h1>${opts.first ? 'Verificación en dos pasos activada' : 'Nuevos códigos de recuperación'}</h1>
  <p class="sub">Guarda estos códigos fuera del móvil (un gestor de contraseñas o en papel). Sirven para entrar si pierdes la app; cada uno, una vez.${opts.first ? '' : ' Los anteriores ya no valen.'}</p>
  <p class="msg" role="status">No se volverán a mostrar.</p>
  <ol class="codes">
${opts.codes.map((c) => `    <li>${escapeHtml(c)}</li>`).join('\n')}
  </ol>
  <a class="button" href="${escapeHtml(opts.next)}">Los he guardado: continuar</a>`, true)
}

// accountMfaPage is the session panel's "Verificación en dos pasos":
// enroll when the account has none, otherwise new recovery codes or
// turning it off, both against a current code.
export function accountMfaPage(opts: {
  user: string
  roleLabel: string
  state: { enrolled: boolean; required: boolean; recoveryLeft: number }
  enroll?: { secret: string; qr: string | null }
  error?: string | null
}): string {
  const head = `  <h1>Verificación en dos pasos</h1>
  <p class="sub">${escapeHtml(opts.user)} · ${escapeHtml(opts.roleLabel)}</p>
`
  if (!opts.state.enrolled && opts.enroll) {
    const hidden = `    <input type="hidden" name="action" value="activar">`
    const intro = opts.state.required
      ? 'Tu rol la exige; si aún entras solo con contraseña, el próximo inicio de sesión te la pedirá igualmente.'
      : 'Al entrar, además de la contraseña, la consola te pedirá un código del móvil.'
    return shell('Verificación en dos pasos', `${head}${enrollBody({ ...opts.enroll, error: opts.error, action: '/api/console/mfa', hidden, intro })}
  <a class="back" href="/">Volver a la consola</a>`, true)
  }
  const left = opts.state.recoveryLeft
  const offNote = opts.state.required
    ? 'Tu rol la exige: al desactivarla se cierra tu sesión y el próximo inicio de sesión te pedirá configurarla otra vez (así se cambia de móvil).'
    : 'Se cierra tu sesión y volverás a entrar solo con la contraseña.'
  return shell('Verificación en dos pasos', `${head}${alert(messageFor(opts.error))}  <p>Activada. Te quedan <strong>${left}</strong> código${left === 1 ? '' : 's'} de recuperación.</p>
  <h2>Nuevos códigos de recuperación</h2>
  <p class="note">Sustituye todos los anteriores.</p>
  <form method="post" action="/api/console/mfa">
    <input type="hidden" name="action" value="recuperacion">
${codeField('Código actual de la app o de recuperación', 'code-new')}
    <button type="submit">Generar códigos nuevos</button>
  </form>
  <hr>
  <h2>Desactivar</h2>
  <p class="note">${offNote}</p>
  <form method="post" action="/api/console/mfa">
    <input type="hidden" name="action" value="desactivar">
    <label for="code-off">Código actual de la app o de recuperación</label>
    <input id="code-off" name="code" class="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" maxlength="32" required>
    <button type="submit" class="quiet">Desactivar la verificación en dos pasos</button>
  </form>
  <a class="back" href="/">Volver a la consola</a>`, true)
}

// passwordPage: "forced" is the step of a sign-in after an administrator
// reset the password (no current password: the temporary one was just
// typed); "self" is a signed-in operator changing their own.
export function passwordPage(opts: { user: string; mode: 'forced' | 'self'; next?: string; error?: string | null }): string {
  const forced = opts.mode === 'forced'
  const fields = `${forced ? `    <input type="hidden" name="step" value="password">
    <input type="hidden" name="next" value="${escapeHtml(opts.next ?? '/')}">
` : `    <label for="current">Contraseña actual</label>
    <input id="current" name="current" type="password" autocomplete="current-password" maxlength="1024" required autofocus>
`}    <label for="new_password">Contraseña nueva (12 caracteres o más)</label>
    <input id="new_password" name="new_password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required${forced ? ' autofocus' : ''}>
    <label for="repeat">Repite la contraseña nueva</label>
    <input id="repeat" name="repeat" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required>`
  return shell(forced ? 'Elige tu contraseña' : 'Cambiar contraseña', `  <h1>${forced ? 'Elige tu contraseña' : 'Cambiar contraseña'}</h1>
  <p class="sub">${escapeHtml(opts.user)}${forced ? ': entraste con una contraseña temporal de un administrador. Elige la tuya para continuar; nadie más la conocerá.' : ''}</p>
${alert(messageFor(opts.error))}  <form method="post" action="${forced ? '/api/console/login' : '/api/console/password'}">
${fields}
    <button type="submit">${forced ? 'Guardar y entrar' : 'Cambiar contraseña'}</button>
  </form>
  ${forced ? `<a class="back" href="/login?next=${encodeURIComponent(opts.next ?? '/')}">Empezar de nuevo</a>` : '<a class="back" href="/">Volver a la consola</a>'}`)
}

export function passwordChangedPage(): string {
  return shell('Contraseña cambiada', `  <h1>Contraseña cambiada</h1>
  <p class="sub">Tus otras sesiones abiertas se han cerrado. Esta sigue abierta.</p>
  <a class="button" href="/">Volver a la consola</a>`)
}

// unavailablePage: the account pages without accounts (shared token or
// loopback): there is nobody to attach a password or a second step to.
export function unavailablePage(what: 'dos-pasos' | 'contrasena'): string {
  const title = what === 'dos-pasos' ? 'Verificación en dos pasos' : 'Cambiar contraseña'
  const text = what === 'dos-pasos'
    ? 'Solo las cuentas de la consola (CONSOLE_USERS_FILE) la tienen. Con el token compartido o sin cuentas no hay a quién asociarla.'
    : 'Solo las cuentas de la consola (CONSOLE_USERS_FILE) tienen contraseña propia. Con el token compartido o sin cuentas no hay ninguna que cambiar.'
  return shell(title, `  <h1>${title}</h1>
  <p class="sub">${text}</p>
  <a class="button" href="/">Volver a la consola</a>`)
}
