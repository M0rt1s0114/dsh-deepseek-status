// dsh-deepseek-status client half (no-build bundle).
//
// Renders three pills in the DSH session header for official DeepSeek sessions:
//   1. DeepSeek API balance (fetched from our own local route)
//   2. A top-up link to the DeepSeek platform usage page
//   3. DeepSeek peak/valley pricing status (computed locally, Beijing time)
//
// Pricing hours (Beijing time):
//   peak:   09:00-12:00, 14:00-18:00
//   valley: all other times (half price)
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-status',
  factory: (require) => {
    const React = require('react')

    const OFFICIAL_PROVIDER = 'deepseek-official'
    const SLOT_KEY = 'conversation.session.header.utilities'
    const BALANCE_ROUTE = '/plugins/dsh-deepseek-status/balance'
    const STYLE_ID = 'dsh-deepseek-status-style'
    const DEFAULT_INTERVAL_MS = 300000
    const PRICING_REFRESH_MS = 30000

    const css = [
      '.dsh-ds-status { display: inline-flex; align-items: center; gap: 8px; }',
      '.dsh-ds-pill { display: inline-flex; align-items: center; gap: 4px; height: 24px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
      '.dsh-ds-pill:hover { border-color: var(--dsw-alias-border-l2); }',
      '.dsh-ds-balance { padding: 0 6px 0 10px; }',
      '.dsh-ds-balance-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }',
      '.dsh-ds-balance-loading .dsh-ds-balance-dot { background: var(--dsw-alias-state-warn-primary); }',
      '.dsh-ds-balance-error .dsh-ds-balance-dot { background: var(--dsw-alias-state-error-primary); }',
      '.dsh-ds-text { font-size: 12px; line-height: 20px; }',
      '.dsh-ds-value { color: var(--dsw-alias-label-primary); font-weight: 500; }',
      '.dsh-ds-topup { padding: 0 10px; text-decoration: none; color: var(--dsw-alias-label-primary); }',
      '.dsh-ds-topup:hover { border-color: var(--dsw-alias-state-info-primary, #0090ff); color: var(--dsw-alias-state-info-primary, #0090ff); }',
      '.dsh-ds-topup svg { flex: none; }',
      '.dsh-ds-refresh { display: inline-flex; align-items: center; justify-content: center; height: 14px; padding: 0 2px; border: none; border-left: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
      '.dsh-ds-refresh:hover { color: var(--dsw-alias-label-primary); }',
      '.dsh-ds-refresh-spin { animation: dsh-ds-spin 0.6s ease; }',
      '.dsh-ds-refresh-loading svg { animation: dsh-ds-spin 1s linear infinite; }',
      '@keyframes dsh-ds-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      '.dsh-pv-pill { padding: 0 10px; }',
      '.dsh-pv-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }',
      '.dsh-pv-peak .dsh-pv-dot { background: var(--dsw-alias-state-error-primary, #e5484d); }',
      '.dsh-pv-valley .dsh-pv-dot { background: var(--dsw-alias-state-success-primary, #30a46c); }',
      '.dsh-pv-text { color: var(--dsw-alias-label-primary); font-weight: 500; }',
      '.dsh-pv-time { font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); }',
    ].join('\n')

    // Beijing is UTC+8 with no DST; using UTC getters on shifted time is exact.
    function beijingParts(ts) {
      const shifted = new Date(ts + 8 * 60 * 60 * 1000)
      return {
        h: shifted.getUTCHours(),
        m: shifted.getUTCMinutes(),
        text: String(shifted.getUTCHours()).padStart(2, '0') + ':' + String(shifted.getUTCMinutes()).padStart(2, '0'),
      }
    }

    function isPeak(h, m) {
      const t = h * 60 + m
      return (t >= 9 * 60 && t < 12 * 60) || (t >= 14 * 60 && t < 18 * 60)
    }

    function nextBoundaryMinute(h, m) {
      const current = h * 60 + m
      const boundaries = [9 * 60, 12 * 60, 14 * 60, 18 * 60]
      const next = boundaries.find((b) => b > current)
      return next === undefined ? 9 * 60 + 24 * 60 : next
    }

    function formatMinute(minute) {
      const m = ((minute % (24 * 60)) + 24 * 60) % (24 * 60)
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    }

    // Tracks whether the current session is using official DeepSeek.
    function useOfficialProvider(ctx, sessionId) {
      const modelDirectories = ctx.get('modelDirectories')
      const [provider, setProvider] = React.useState('unknown')

      React.useEffect(() => {
        if (modelDirectories === undefined) {
          setProvider('unknown')
          return
        }
        let directory
        try {
          directory = modelDirectories.directoryFor(sessionId)
        } catch (err) {
          setProvider('unknown')
          return
        }
        const read = () => {
          const current = directory.store.getSnapshot().current
          setProvider(current === null || current === undefined ? 'unknown' : current.provider)
        }
        read()
        void directory.load().catch(() => undefined)
        const stop = directory.store.subscribe(read)
        return () => { stop() }
      }, [sessionId])

      return provider === OFFICIAL_PROVIDER
    }

    function BalancePill({ ctx, eligible }) {
      const [state, setState] = React.useState({
        status: 'loading',
        refreshing: false,
        last: undefined,
        error: '',
        elapsedMs: 0,
        intervalMs: DEFAULT_INTERVAL_MS,
      })
      const [tick, setTick] = React.useState(0)

      const refresh = React.useCallback(() => {
        setState((prev) => ({ ...prev, refreshing: true, error: '' }))
        const t0 = performance.now()
        fetch(BALANCE_ROUTE, { cache: 'no-store' })
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then((r) => {
            const elapsed = Math.round(performance.now() - t0)
            const d = (r === null || typeof r !== 'object') ? {} : r
            setState((prev) => {
              const intervalMs = Number(d.intervalMs) > 0 ? Number(d.intervalMs) : prev.intervalMs
              if (d.ok === true) {
                return {
                  status: 'ok',
                  refreshing: false,
                  last: {
                    total: String(d.total || ''),
                    granted: String(d.granted || ''),
                    toppedUp: String(d.toppedUp || ''),
                  },
                  error: '',
                  elapsedMs: Number(d.elapsedMs) || elapsed,
                  intervalMs,
                }
              }
              return {
                ...prev,
                status: prev.last === undefined ? 'error' : 'ok',
                refreshing: false,
                error: String(d.error || 'unknown error'),
                elapsedMs: Number(d.elapsedMs) || elapsed,
                intervalMs,
              }
            })
          })
          .catch((err) => {
            setState((prev) => ({
              ...prev,
              status: prev.last === undefined ? 'error' : 'ok',
              refreshing: false,
              error: String((err && err.message) || err || 'unknown error'),
            }))
          })
      }, [])

      React.useEffect(() => {
        if (!eligible) return
        refresh()
      }, [eligible, tick, refresh])

      React.useEffect(() => {
        if (!eligible) return
        let timer = 0
        const schedule = () => {
          timer = window.setTimeout(() => {
            setTick((t) => t + 1)
            schedule()
          }, state.intervalMs)
        }
        schedule()
        return () => { window.clearTimeout(timer) }
      }, [eligible, state.intervalMs])

      if (!eligible) return null
      const { last, refreshing, status, error, elapsedMs } = state
      const failed = status === 'error'

      let chip
      let title
      if (last !== undefined) {
        const amount = last.total ? '¥' + last.total : ''
        chip = React.createElement('span', { className: 'dsh-ds-text' },
          'DeepSeek 余额 ',
          React.createElement('span', { className: 'dsh-ds-value' }, amount),
        )
        if (refreshing) title = '正在刷新余额…'
        else if (error !== '') title = error + ' · 点击刷新按钮重试'
        else title = '赠送 ' + last.granted + ' · 充值 ' + last.toppedUp + ' · 上次刷新 ' + elapsedMs + 'ms'
      } else if (status === 'loading') {
        chip = React.createElement('span', { className: 'dsh-ds-text' }, '余额 …')
        title = '正在获取 DeepSeek 余额…'
      } else {
        chip = React.createElement('span', { className: 'dsh-ds-text' }, '余额获取失败')
        title = error + ' · 点击刷新按钮重试'
      }

      const cls = 'dsh-ds-pill dsh-ds-balance'
        + ((last === undefined && refreshing) ? ' dsh-ds-balance-loading' : '')
        + (failed ? ' dsh-ds-balance-error' : '')
      const spinCls = tick > 0 ? ' dsh-ds-refresh-spin' : ''
      const onClick = () => { setTick((t) => t + 1) }

      return React.createElement('span', { className: cls, title },
        React.createElement('span', { className: 'dsh-ds-balance-dot' }),
        chip,
        React.createElement('button',
          {
            type: 'button',
            className: 'dsh-ds-refresh' + (refreshing ? ' dsh-ds-refresh-loading' : ''),
            title: '刷新余额',
            'aria-label': '刷新余额',
            onClick,
          },
          React.createElement('svg',
            {
              key: tick,
              className: spinCls.trim(),
              viewBox: '0 0 24 24',
              width: 14,
              height: 14,
              fill: 'currentColor',
              'aria-hidden': true,
            },
            React.createElement('path', { d: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-8 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z' }),
          ),
        ),
      )
    }

    function TopUpLinkPill() {
      return React.createElement(
        'a',
        {
          className: 'dsh-ds-pill dsh-ds-topup',
          href: 'https://platform.deepseek.com/usage',
          target: '_blank',
          rel: 'noreferrer',
          title: '前往 DeepSeek 平台查看用量并充值',
        },
        React.createElement('svg',
          {
            viewBox: '0 0 24 24',
            width: 12,
            height: 12,
            fill: 'currentColor',
            'aria-hidden': true,
          },
          React.createElement('path', { d: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z' }),
        ),
        React.createElement('span', { className: 'dsh-ds-text' }, '充值'),
      )
    }

    function PeakValleyPill({ now }) {
      const b = beijingParts(now)
      const peak = isPeak(b.h, b.m)
      const nextMinute = nextBoundaryMinute(b.h, b.m)
      const nextText = formatMinute(nextMinute)
      const title = peak
        ? `DeepSeek 高峰时段 · 北京时间 ${b.text} · ${nextText} 后进入空闲半价`
        : `DeepSeek 空闲时段（半价）· 北京时间 ${b.text} · ${nextText} 后进入高峰`

      return React.createElement(
        'span',
        {
          className: 'dsh-ds-pill dsh-pv-pill ' + (peak ? 'dsh-pv-peak' : 'dsh-pv-valley'),
          title,
        },
        React.createElement('span', { className: 'dsh-pv-dot' }),
        React.createElement('span', { className: 'dsh-ds-text dsh-pv-text' }, peak ? 'DeepSeek 峰' : 'DeepSeek 谷'),
        React.createElement('span', { className: 'dsh-pv-time' }, b.text),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const ensureStyle = () => {
          if (document.getElementById(STYLE_ID)) return () => {}
          const el = document.createElement('style')
          el.id = STYLE_ID
          el.setAttribute('data-plugin', 'dsh-deepseek-status')
          el.textContent = css
          document.head.appendChild(el)
          return () => { el.remove() }
        }
        ctx.effect(ensureStyle, 'dsh-deepseek-status: styles')

        const slots = ctx.get('slots')
        if (slots === undefined) return

        slots.inject(SLOT_KEY, () => slots.register(
          {
            name: SLOT_KEY,
            id: 'dsh-deepseek-status',
            order: -1,
            label: 'DeepSeek balance & pricing',
          },
          function DeepSeekStatusChip(props) {
            const sessionId = props.sessionId
            const eligible = useOfficialProvider(ctx, sessionId)
            const [now, setNow] = React.useState(() => Date.now())

            React.useEffect(() => {
              const timer = window.setInterval(() => setNow(Date.now()), PRICING_REFRESH_MS)
              return () => { window.clearInterval(timer) }
            }, [])

            if (!eligible) return null

            return React.createElement(
              'span',
              { className: 'dsh-ds-status' },
              React.createElement(BalancePill, { ctx, eligible }),
              React.createElement(TopUpLinkPill),
              React.createElement(PeakValleyPill, { now }),
            )
          },
        ))
      },
    }
  },
})
