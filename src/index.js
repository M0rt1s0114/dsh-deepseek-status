/**
 * dsh-peak-valley host half.
 *
 * Provides one small HTTP route that resolves the official DeepSeek API key
 * from DSH credentials and calls the official balance endpoint. The client
 * half renders both a balance pill and a peak/valley pricing pill.
 *
 * Security notes:
 * - The API key is used only in the Authorization header of the official
 *   balance request; it is never written to logs or returned to the client.
 * - The route response contains only balance data, never the key.
 * - The only outbound request is to https://api.deepseek.com/user/balance.
 * - Uses Node's built-in fetch, so no shell/curl is involved on any platform.
 */
export const name = 'dsh-peak-valley'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const ROUTE_PATH = '/plugins/dsh-peak-valley/balance'
const WEB_SERVER_KEYS = ['webServer', 'httpServer']

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
  }

  const respond = async (res) => {
    const balance = await fetchBalance(ctx, resolved)
    const body = JSON.stringify({ ...balance, intervalMs: resolved.refreshIntervalMs })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  let webRegistered = false
  const registerRoute = () => {
    if (webRegistered) return
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])
    if (webServer === undefined) return
    webRegistered = true
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (_req, res) => respond(res),
    }), 'dsh-peak-valley: balance route')
  }

  registerRoute()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name)) registerRoute()
  })
}
