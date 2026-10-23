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
  dom_credenciales: 'Usuario o contraseña del dominio incorrectos.',
  dom_formato: 'Escribe el usuario como ana, CORP\\ana o ana@corp.example.',
  dom_sin_rol: 'Tu cuenta del dominio no pertenece a ningún grupo con acceso a la consola. Pide acceso a un administrador.',
  dom_mfa_dominio: 'Tu rol exige verificación en dos pasos, que las cuentas del dominio no tienen aquí. Entra con tu cuenta local.',
  dom_bloqueado: 'Demasiados intentos fallidos con cuentas del dominio. Espera un minuto antes de volver a intentarlo.',
  dom_dominio_apagado: 'El inicio de sesión con cuentas del dominio no está activado en el motor (-domain-auth). Entra con tu cuenta local.',
  dom_dominio: 'No se pudo contactar con el controlador de dominio. Inténtalo de nuevo o entra con tu cuenta local.',
  dom_motor: 'El motor no responde. Entra con tu cuenta local o revisa que el motor esté en marcha.',
}

export function messageFor(key: string | null | undefined): string {
  return key ? MESSAGES[key] ?? '' : ''
}

// The sign-in pages share one look: a brand panel (hidden on small
// screens, where the mark sits above the card) and the form card. Dark
// by default, light under prefers-color-scheme; the accent is the
// mark's own blue. No script and no external asset: the pages render
// before the console bundle is reachable.
const STYLE = `
  :root { color-scheme: dark light; --bg: #070b12; --panel: #0b1220; --card: #0f1726; --field: #0a111d; --line: #1e2a3d; --line-strong: #2b3a52; --text: #e8eef7; --muted: #8fa0b8; --faint: #64748b; --accent: #3b82f6; --accent-2: #4dc3ff; --accent-ink: #ffffff; --ring: rgba(77, 195, 255, .45); --warn: #fbbf24; --warn-bg: rgba(251, 191, 36, .08); --danger: #f87171; --danger-bg: rgba(248, 113, 113, .08); --ok: #34d399; }
  @media (prefers-color-scheme: light) { :root { --bg: #eef2f7; --panel: #0b1220; --card: #ffffff; --field: #f8fafc; --line: #dbe3ee; --line-strong: #c3cfdf; --text: #0f172a; --muted: #475569; --faint: #64748b; --accent: #2563eb; --accent-2: #0ea5e9; --ring: rgba(37, 99, 235, .35); --warn: #92400e; --warn-bg: #fffbeb; --danger: #b91c1c; --danger-bg: #fef2f2; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr); background: var(--bg); color: var(--text); font: 14px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
  @media (min-width: 960px) { body { grid-template-columns: minmax(420px, 46%) minmax(0, 1fr); } }

  aside { display: none; position: relative; overflow: hidden; padding: 48px 56px; color: #e8eef7; background: radial-gradient(120% 80% at 0% 0%, rgba(77, 195, 255, .16), transparent 60%), radial-gradient(90% 70% at 100% 100%, rgba(47, 111, 237, .22), transparent 60%), var(--panel); border-right: 1px solid rgba(148, 163, 184, .12); }
  aside::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(rgba(148, 163, 184, .16) 1px, transparent 1px); background-size: 22px 22px; mask-image: linear-gradient(180deg, rgba(0,0,0,.9), rgba(0,0,0,.2)); pointer-events: none; }
  @media (min-width: 960px) { aside { display: flex; flex-direction: column; justify-content: space-between; } }
  aside > * { position: relative; }
  .wordmark { display: flex; align-items: center; gap: 12px; font-weight: 650; font-size: 17px; letter-spacing: .01em; }
  .wordmark small { display: block; font-size: 11px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: #8fa0b8; }
  .pitch h2 { margin: 0 0 12px; font-size: 30px; line-height: 1.2; font-weight: 650; letter-spacing: -.01em; max-width: 15em; }
  .pitch p { margin: 0 0 28px; color: #9fb0c8; max-width: 30em; }
  .pitch ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .pitch li { display: grid; grid-template-columns: 28px 1fr; gap: 12px; align-items: start; color: #c8d4e6; }
  .pitch li strong { display: block; color: #e8eef7; font-weight: 600; }
  .pitch li span { color: #8fa0b8; font-size: 13px; }
  .pitch .ico { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: rgba(77, 195, 255, .1); border: 1px solid rgba(77, 195, 255, .25); color: #4dc3ff; }
  .legal { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 8px; }
  .legal .dot { width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, .15); }

  .stage { display: grid; place-items: center; padding: 32px 16px; min-height: 100vh; }
  main { width: 100%; max-width: 400px; }
  main.wide { max-width: 460px; }
  .mobile-brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 22px; font-weight: 650; font-size: 16px; }
  @media (min-width: 960px) { .mobile-brand { display: none; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 32px 28px 28px; box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 24px 48px -24px rgba(0, 0, 0, .55); }
  @media (prefers-color-scheme: light) { .card { box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 20px 40px -24px rgba(15, 23, 42, .25); } }
  .eyebrow { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--accent-2); }
  @media (prefers-color-scheme: light) { .eyebrow { color: var(--accent); } }
  h1 { margin: 0 0 6px; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.01em; }
  h2 { margin: 24px 0 4px; font-size: 14px; font-weight: 600; }
  p { margin: 8px 0; }
  p.sub, .note { color: var(--muted); font-size: 13px; }
  p.sub { margin: 0 0 22px; }
  label { display: block; margin: 16px 0 6px; font-size: 12.5px; font-weight: 550; color: var(--text); }
  input { width: 100%; height: 42px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--field); color: var(--text); font: inherit; transition: border-color .15s, box-shadow .15s; }
  input::placeholder { color: var(--faint); }
  input:hover:not(:disabled) { border-color: var(--muted); }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
  input:disabled { opacity: .55; cursor: not-allowed; }
  input.code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 17px; letter-spacing: .12em; }
  button:focus-visible, a:focus-visible, .realm input:focus-visible + label { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  button, a.button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 44px; margin-top: 24px; padding: 0 16px; border: 0; border-radius: 10px; background: linear-gradient(180deg, #4f8ff7, #2f6fed); color: var(--accent-ink); font: inherit; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 8px 20px -8px rgba(47, 111, 237, .7); transition: filter .15s, transform .05s; }
  button:hover:not(:disabled), a.button:hover { filter: brightness(1.08); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button.quiet { margin-top: 12px; background: transparent; color: var(--text); border: 1px solid var(--line-strong); font-weight: 500; box-shadow: none; }
  button:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
  a { color: inherit; }
  .msg { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 6px; padding: 11px 13px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); background: var(--warn-bg); color: var(--warn); font-size: 13px; }
  .msg::before { content: "!"; flex: none; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--warn); color: var(--card); }
  .realm { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin: 0 0 4px; border-radius: 11px; background: var(--field); border: 1px solid var(--line); }
  .realm input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .realm label { margin: 0; height: 34px; display: flex; align-items: center; justify-content: center; gap: 7px; border-radius: 8px; font-size: 13px; font-weight: 550; color: var(--muted); cursor: pointer; transition: background .15s, color .15s; }
  .realm label:hover { color: var(--text); }
  .realm input:checked + label { background: color-mix(in srgb, var(--accent) 16%, var(--card)); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
  .realm input:checked + label svg { color: var(--accent-2); }
  @media (prefers-color-scheme: light) { .realm input:checked + label svg { color: var(--accent); } }
  @media (max-width: 420px) { .realm label { font-size: 12.5px; gap: 5px; } .realm label svg { display: none; } }
  .realm input:disabled + label { cursor: not-allowed; opacity: .55; }
  .hint { display: none; margin: 8px 2px 0; font-size: 12px; color: var(--faint); }
  form:has(#realm-local:checked) .hint-local, form:has(#realm-dominio:checked) .hint-dominio { display: block; }
  .meta { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 18px; font-size: 12px; color: var(--faint); }
  .meta svg { flex: none; }
  .qr { display: flex; justify-content: center; margin: 14px 0 6px; }
  .qr svg { width: 196px; height: 196px; border-radius: 10px; background: #fff; padding: 6px; }
  code.secret { display: block; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--field); font: 14px/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .06em; word-break: break-all; user-select: all; }
  ol.codes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 12px 0; padding: 12px 12px 12px 34px; border-radius: 10px; border: 1px solid var(--line); background: var(--field); font: 14px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace; user-select: all; }
  .back { display: block; margin-top: 18px; font-size: 12.5px; color: var(--muted); text-align: center; text-decoration: none; }
  .back:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0 0; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`

// The mark (docs/assets/logo.svg) inlined; each copy carries its own
// gradient ids, since the brand panel's copy is display:none on phones
// and a hidden <defs> paints nothing.
function logo(size: number, id: string): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4dc3ff"/><stop offset="1" stop-color="#2f6fed"/></linearGradient><linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4dc3ff" stop-opacity=".35"/><stop offset="1" stop-color="#2f6fed" stop-opacity=".05"/></linearGradient></defs><circle cx="32" cy="34" r="26" fill="url(#${id}-g)"/><g stroke="url(#${id}-b)" stroke-width="3.4" stroke-linecap="round" fill="none"><path d="M22 30 C17 29 14 26 13 22"/><path d="M21 37 C15 37 11 35 9 32"/><path d="M22 44 C16 45 13 48 12 52"/><path d="M42 30 C47 29 50 26 51 22"/><path d="M43 37 C49 37 53 35 55 32"/><path d="M42 44 C48 45 51 48 52 52"/></g><g fill="url(#${id}-b)"><rect x="20" y="24" width="24" height="22" rx="11"/><rect x="21.5" y="32" width="21" height="1.6" rx=".8" opacity=".28"/><rect x="21.5" y="38" width="21" height="1.6" rx=".8" opacity=".28"/></g><circle cx="32" cy="25.5" r="7.5" fill="url(#${id}-b)"/><circle cx="29" cy="24" r="1.7" fill="#060a10"/><circle cx="35" cy="24" r="1.7" fill="#060a10"/></svg>`
}

const ICON = {
  pulse: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  shield: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  graph: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="M8.3 7.2l7.4 1.2M7 8.4l1.4 7.2M16.5 10.2l-5.6 6"/></svg>',
  lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  domain: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg>',
}

function brandPanel(): string {
  return `<aside>
  <div class="wordmark">${logo(40, 'bt-aside')}<div>bluetardigrade<small>Security Operations</small></div></div>
  <div class="pitch">
    <h2>Detecta, investiga y responde desde un solo sitio.</h2>
    <p>La consola del SOC para tus equipos Windows: telemetría del sensor ETW, reglas mapeadas a MITRE ATT&amp;CK y respuesta auditada.</p>
    <ul>
      <li class="feat"><span class="ico">${ICON.pulse}</span><div><strong>Telemetría en vivo</strong><span>Procesos, red, registro y ficheros de cada equipo.</span></div></li>
      <li class="feat"><span class="ico">${ICON.graph}</span><div><strong>Correlación y riesgo</strong><span>Cadenas de ataque, incidentes y riesgo por equipo.</span></div></li>
      <li class="feat"><span class="ico">${ICON.shield}</span><div><strong>Respuesta con control</strong><span>Acciones cerradas, firmadas y auditadas.</span></div></li>
    </ul>
  </div>
  <div class="legal"><span class="dot" aria-hidden="true"></span>Acceso restringido a personal autorizado. Toda la actividad queda registrada.</div>
</aside>`
}

function shell(title: string, body: string, wide = false): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<title>${escapeHtml(title)} · bluetardigrade</title>
<style>${STYLE}</style>
</head>
<body>
${brandPanel()}
<div class="stage">
<main${wide ? ' class="wide"' : ''}>
  <div class="mobile-brand" aria-hidden="true">${logo(30, 'bt-top')}bluetardigrade</div>
  <div class="card">
${body}
  </div>
  <p class="meta">${ICON.lock}<span>La sesión se cierra sola tras un rato sin actividad</span></p>
</main>
</div>
</body>
</html>
`
}

function alert(message: string): string {
  return message ? `  <p class="msg" role="alert">${escapeHtml(message)}</p>\n` : ''
}

export type LoginRealm = 'local' | 'dominio'

// loginPage: with accounts, and domain sign-in on (lib/domain-auth.ts),
// a two-way switch picks the local account or the domain one; it is a
// pair of radio buttons posted with the form, so it works without
// script. The hints under the fields follow the switch through CSS.
export function loginPage(opts: { mode: LoginMode; next: string; error?: string | null; locked?: string; domain?: boolean; realm?: LoginRealm }): string {
  const message = opts.locked || messageFor(opts.error)
  const users = opts.mode === 'users'
  const domain = users && !!opts.domain
  const realm: LoginRealm = domain && opts.realm === 'dominio' ? 'dominio' : 'local'
  const userLabel = users ? 'Usuario' : 'Tu nombre (queda en la auditoría)'
  const passLabel = users ? 'Contraseña' : 'Token de acceso de la consola'
  const disabled = opts.locked ? ' disabled' : ''
  const switcher = domain
    ? `    <div class="realm" role="radiogroup" aria-label="Tipo de cuenta">
      <input type="radio" id="realm-local" name="realm" value="local"${realm === 'local' ? ' checked' : ''}${disabled}><label for="realm-local">${ICON.user}Cuenta local</label>
      <input type="radio" id="realm-dominio" name="realm" value="dominio"${realm === 'dominio' ? ' checked' : ''}${disabled}><label for="realm-dominio">${ICON.domain}Cuenta del dominio</label>
    </div>
`
    : ''
  // the switch's radios must be siblings of .fields for the hint selectors
  const hints = domain
    ? `      <p class="hint hint-local">Cuenta creada en la consola por un administrador.</p>
      <p class="hint hint-dominio">Tu usuario de Windows: ana, CORP\\ana o ana@corp.example. El rol lo dan tus grupos de Active Directory.</p>
`
    : ''
  return shell('Iniciar sesión', `  <p class="eyebrow">Consola SOC</p>
  <h1>Iniciar sesión</h1>
  <p class="sub">${users ? 'Entra con tu cuenta para acceder a la consola.' : 'Esta consola usa un token de acceso compartido.'}</p>
${alert(message)}  <form method="post" action="/api/console/login">
    <input type="hidden" name="next" value="${escapeHtml(opts.next)}">
${switcher}    <div class="fields">
      <label for="user">${userLabel}</label>
      <input id="user" name="user" autocomplete="username" maxlength="${domain ? 256 : 64}" autocapitalize="none" spellcheck="false"${users ? ' required autofocus' : ''}${disabled}>
${hints}      <label for="password">${passLabel}</label>
      <input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required${opts.mode === 'token' ? ' autofocus' : ''}${disabled}>
    </div>
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
// A domain account has both, but in the directory, not here.
export function unavailablePage(what: 'dos-pasos' | 'contrasena', who: 'none' | 'domain' = 'none'): string {
  const title = what === 'dos-pasos' ? 'Verificación en dos pasos' : 'Cambiar contraseña'
  const text = who === 'domain'
    ? (what === 'dos-pasos'
      ? 'Entraste con tu cuenta del dominio: su verificación la gestiona tu organización en Active Directory, no la consola.'
      : 'Entraste con tu cuenta del dominio: su contraseña se cambia en Windows (Ctrl+Alt+Supr) o con el servicio de tu organización, no en la consola.')
    : what === 'dos-pasos'
      ? 'Solo las cuentas de la consola (CONSOLE_USERS_FILE) la tienen. Con el token compartido o sin cuentas no hay a quién asociarla.'
      : 'Solo las cuentas de la consola (CONSOLE_USERS_FILE) tienen contraseña propia. Con el token compartido o sin cuentas no hay ninguna que cambiar.'
  return shell(title, `  <h1>${title}</h1>
  <p class="sub">${text}</p>
  <a class="button" href="/">Volver a la consola</a>`)
}
