# dsh-peak-valley

> GitHub: https://github.com/M0rt1s0114/dsh-peak-valley

A small DeepSeek Harness web plugin that shows three pills in the session header for official DeepSeek sessions:

1. **DeepSeek API balance** — fetched from the official `https://api.deepseek.com/user/balance` endpoint using your stored `DEEPSEEK_API_KEY`.
2. **Top-up link** — a capsule button linking to `https://platform.deepseek.com/usage` for checking usage and recharging.
3. **Peak/valley pricing status** — whether DeepSeek API is currently in peak or off-peak (valley) pricing hours.

Pricing hours (Beijing time):

- Peak: 09:00–12:00, 14:00–18:00
- Valley: all other times (half price)

## Install

From GitHub:

```bash
dsh plugin --profile web add github:M0rt1s0114/dsh-peak-valley
```

Or from a local checkout:

```bash
dsh plugin --profile web add ./dsh-peak-valley
```

Then restart `dsh web`.

## Behavior

- Shows only for official DeepSeek sessions (`provider: deepseek-official`).
- Balance is fetched every 5 minutes by default and can be refreshed manually from the pill.
- The top-up capsule opens `https://platform.deepseek.com/usage` in a new tab.
- Peak/valley status is computed locally in the browser and refreshes every 30 seconds.
- No third-party network calls. The only outbound request is to the official DeepSeek balance endpoint.
