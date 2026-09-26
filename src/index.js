/**
 * dsh-deepseek-status host half.
 *
 * Provides two small HTTP routes:
 *   - /plugins/dsh-deepseek-status/balance          official API-key balance
 *   - /plugins/dsh-deepseek-status/account-balance  DeepSeek account (signed-in) balance
 *
 * The client half renders the balance pill, a top-up link, and a peak/valley
 * pricing pill. Sessions whose model provider is `deepseek-official` use the
 * API-key route; `deepseek-account` sessions use the account route, which reads
 * the already-signed-in account through the host `deepseekAccount` service
 * (no API key is involved, and no credential is returned to the client).
 *
 * Security notes:
 * - The API key is used only in the Authorization header of the official
 *   balance request; it is never written to logs or returned to the client.
 * - Route responses contain only balance data, never credentials or tokens.
 * - The only outbound requests are: the official balance endpoint (API-key
 *   path), and whatever the account platform service itself performs.
 * - Uses Node's built-in fetch, so no shell/curl is involved on any platform.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-deepseek-status'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const ROUTE_PATH = '/plugins/dsh-deepseek-status/balance'
const ACCOUNT_ROUTE_PATH = '/plugins/dsh-deepseek-status/account-balance'
const WEB_SERVER_KEYS = ['webServer', 'httpServer']

/**
 * Resolve the running DSH client version for `AccountClientMetadata`.
 *
 * The account platform sends it as the `x-client-version` header.
 *
 * NOTE: `DSH_PROFILE_DIR` / `DSH_HOME` are injected per *shell execution* by
 * dsh-shell-env, so they are normally ABSENT from the host process environment.
 * The plugin's own path cannot resolve the DSH packages either (it is a linked
 * path outside the profile). Resolution therefore walks several bases and falls
 * back to well-known install locations, and reports what it tried on failure.
 */
let cachedClientVersion
let cachedVersionAttempts
const CLIENT_VERSION_PACKAGES = ['@deepseek-ai/dsh-web-frontend', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh']

/** Candidate `package.json` paths that can be read directly. */
function versionPathCandidates() {
  const paths = []
  const push = (value) => { if (typeof value === 'string' && value !== '') paths.push(value) }
  const home = process.env.DSH_HOME
  if (home) {
    push(join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    push(join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'package.json'))
  }
  const resources = process.resourcesPath
  if (typeof resources === 'string' && resources !== '') {
    // The host process runs inside Electron, whose fs can read asar paths.
    push(join(resources, 'app.asar', 'package.json'))
    push(join(resources, 'app.asar', 'dsh', 'package.json'))
    push(join(resources, 'app.asar.unpacked', 'package.json'))
  }
  const appdata = process.env.APPDATA
  if (appdata) push(join(appdata, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return paths
}

/** Candidate bases for module resolution. */
function versionRequireBases() {
  const bases = []
  const push = (value) => { if (typeof value === 'string' && value !== '') bases.push(value) }
  if (process.env.DSH_PROFILE_DIR) push(join(process.env.DSH_PROFILE_DIR, 'package.json'))
  push(process.argv[1])
  push(import.meta.url)
  return bases
}

/** Read a version string out of one manifest path; '' when unreadable. */
function readVersionAt(path) {
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const version = manifest === null || typeof manifest !== 'object' ? undefined : manifest.version
    return typeof version === 'string' && version !== '' ? version : ''
  } catch {
    return ''
  }
}

function resolveClientVersion(override) {
  if (typeof override === 'string' && override !== '') return override
  if (cachedClientVersion !== undefined) return cachedClientVersion

  const attempts = []
  cachedClientVersion = ''

  for (const path of versionPathCandidates()) {
    attempts.push(path)
    const version = readVersionAt(path)
    if (version !== '') {
      cachedClientVersion = version
      cachedVersionAttempts = attempts
      return cachedClientVersion
    }
  }

  for (const base of versionRequireBases()) {
    let require_
    try {
      require_ = createRequire(base)
    } catch {
      continue
    }
    for (const pkg of CLIENT_VERSION_PACKAGES) {
      try {
        const resolved = require_.resolve(`${pkg}/package.json`)
        attempts.push(resolved)
        const version = readVersionAt(resolved)
        if (version !== '') {
          cachedClientVersion = version
          cachedVersionAttempts = attempts
          return cachedClientVersion
        }
      } catch {
        attempts.push(`${pkg} from ${base}`)
      }
    }
  }

  cachedVersionAttempts = attempts
  return cachedClientVersion
}

/** Coerce a wallet balance string into a finite number for the pill formatter. */
function walletAmount(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Kill binary floating-point noise from wallet summation (money keeps 2 decimals). */
function roundMoney(value) {
  return Math.round(value * 100) / 100
}

/** Sum wallet balances of one currency. */
function sumWallets(wallets, currency) {
  let total = 0
  for (const wallet of wallets) {
    if (currency !== undefined && String(wallet.currency) !== currency) continue
    total += walletAmount(wallet.balance)
  }
  return roundMoney(total)
}

/**
 * Read the signed-in DeepSeek account balance through the host account service.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} locale - wire locale reported by the client.
 * @param {number} timezoneOffsetSeconds - client timezone offset in seconds.
 * @param {string} clientVersionOverride - explicit `clientVersion` config value, if any.
 */
async function fetchAccountBalance(ctx, locale, timezoneOffsetSeconds, clientVersionOverride) {
  const t0 = Date.now()
  const elapsed = () => Date.now() - t0

  const account = ctx.get('deepseekAccount')
  if (account === undefined) {
    return { ok: false, error: 'deepseekAccount service is not mounted', elapsedMs: elapsed() }
  }

  const version = resolveClientVersion(clientVersionOverride)
  if (version === '') {
    const tried = Array.isArray(cachedVersionAttempts) && cachedVersionAttempts.length > 0
      ? cachedVersionAttempts.slice(0, 6).join(' | ')
      : '(no candidate bases)'
    return {
      ok: false,
      error: `cannot resolve the DSH client version; set the plugin's clientVersion config; tried: ${tried}`,
      elapsedMs: elapsed(),
    }
  }

  let balance
  try {
    balance = await account.getBalance({ version, locale, timezoneOffsetSeconds })
  } catch (err) {
    const message = String((err && err.message) || err)
    return { ok: false, error: `account balance request failed: ${message}`, elapsedMs: elapsed() }
  }

  if (balance === null || balance === undefined) {
    return { ok: false, error: 'not signed in to a DeepSeek account', elapsedMs: elapsed() }
  }
  if (balance.status !== 'ready') {
    return {
      ok: false,
      error: balance.status === 'failed' ? 'account balance is unavailable' : `account balance status: ${String(balance.status)}`,
      elapsedMs: elapsed(),
    }
  }

  const wallets = Array.isArray(balance.value) ? balance.value : []
  const bonusWallets = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
  if (wallets.length === 0) {
    return { ok: false, error: 'account returned no wallet', elapsedMs: elapsed() }
  }

  const primary = wallets[0]
  const currency = String(primary.currency === undefined || primary.currency === null ? '' : primary.currency)
  const total = sumWallets(wallets, currency)
  const bonus = sumWallets(bonusWallets, currency)

  return {
    ok: true,
    kind: 'account',
    isAvailable: true,
    currency,
    total: String(total),
    granted: String(bonus),
    toppedUp: '',
    wallets: wallets.map((w) => ({ currency: String(w.walletType ?? w.currency ?? ''), amount: walletAmount(w.balance) })),
    bonusWallets: bonusWallets.map((w) => ({ currency: String(w.walletType ?? w.currency ?? ''), amount: walletAmount(w.balance) })),
    elapsedMs: elapsed(),
  }
}

/**
 * Fetch one official DeepSeek balance snapshot.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
async function fetchBalance(ctx, config) {
  const t0 = Date.now()
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    return { ok: false, error: 'credentials service is not mounted', elapsedMs: Date.now() - t0 }
  }

  let apiKey = ''
  try {
    const resolved = await credentials.resolve(config.apiKeyEnv)
    apiKey = resolved === undefined ? '' : resolved.value
  } catch (err) {
    return { ok: false, error: `failed to resolve ${config.apiKeyEnv}`, elapsedMs: Date.now() - t0 }
  }
  if (apiKey === '') {
    return { ok: false, error: `${config.apiKeyEnv} is not configured`, elapsedMs: Date.now() - t0 }
  }

  let response
  try {
    response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (err) {
    return { ok: false, error: `balance request failed: ${String((err && err.message) || err)}`, elapsedMs: Date.now() - t0 }
  }

  let text = ''
  try {
    text = await response.text()
  } catch (err) {
    return { ok: false, error: 'failed to read balance response', elapsedMs: Date.now() - t0 }
  }

  let data = null
  try {
    data = JSON.parse(text)
  } catch (err) {
    data = null
  }
  if (!response.ok) {
    const msg = (data !== null && typeof data === 'object' && data.error !== undefined && data.error !== null)
      ? (typeof data.error === 'object' && data.error.message !== undefined ? String(data.error.message) : String(data.error))
      : `HTTP ${response.status}`
    return { ok: false, error: msg, elapsedMs: Date.now() - t0 }
  }
  if (data === null || typeof data !== 'object') {
    return { ok: false, error: 'unexpected balance response', elapsedMs: Date.now() - t0 }
  }
  if (data.error !== undefined && data.error !== null) {
    const msg = (typeof data.error === 'object' && data.error !== null && data.error.message !== undefined)
      ? String(data.error.message)
      : String(data.error)
    return { ok: false, error: msg, elapsedMs: Date.now() - t0 }
  }

  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
  if (infos.length === 0) {
    return { ok: false, error: 'balance_infos is empty', elapsedMs: Date.now() - t0 }
  }

  const info = infos[0]
  const pick = (value) => String(value === undefined || value === null ? '' : value)
  return {
    ok: true,
    isAvailable: data.is_available === true,
    currency: pick(info.currency),
    total: pick(info.total_balance),
    granted: pick(info.granted_balance),
    toppedUp: pick(info.topped_up_balance),
    elapsedMs: Date.now() - t0,
  }
}

export function apply(ctx, config = {}) {
  const resolved = {
    apiKeyEnv: config.apiKeyEnv ?? 'DEEPSEEK_API_KEY',
    refreshIntervalMs: config.refreshIntervalMs ?? 300000,
    order: config.order ?? -1,
    timeoutMs: config.timeoutMs ?? config.shellTimeoutMs ?? 8000,
    defaultLocale: config.defaultLocale ?? 'zh_CN',
    clientVersion: config.clientVersion ?? '',
  }

  const send = (res, payload) => {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify({ ...payload, intervalMs: resolved.refreshIntervalMs }))
  }

  const respondBalance = async (res) => {
    send(res, await fetchBalance(ctx, resolved))
  }

  const respondAccountBalance = async (req, res) => {
    let locale = resolved.defaultLocale
    let timezoneOffsetSeconds = -(new Date().getTimezoneOffset() * 60)
    try {
      const url = new URL(req.url ?? ACCOUNT_ROUTE_PATH, 'http://127.0.0.1')
      const localeParam = url.searchParams.get('locale')
      const tzParam = url.searchParams.get('tz')
      if (localeParam !== null && localeParam !== '') locale = localeParam
      if (tzParam !== null && Number.isFinite(Number(tzParam))) timezoneOffsetSeconds = Number(tzParam)
    } catch {
      // fall back to defaults
    }
    send(res, await fetchAccountBalance(ctx, locale, timezoneOffsetSeconds, resolved.clientVersion))
  }

  let webRegistered = false
  const registerRoutes = () => {
    if (webRegistered) return
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])
    if (webServer === undefined) return
    webRegistered = true
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (_req, res) => respondBalance(res),
    }), 'dsh-deepseek-status: balance route')
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: ACCOUNT_ROUTE_PATH,
      handler: async (req, res) => respondAccountBalance(req, res),
    }), 'dsh-deepseek-status: account balance route')
  }

  registerRoutes()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name)) registerRoutes()
  })
}
