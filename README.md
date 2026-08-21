# dsh-peak-valley

A small DeepSeek Harness web plugin that shows two pills in the session header for official DeepSeek sessions:

1. **DeepSeek API balance** — fetched from the official `https://api.deepseek.com/user/balance` endpoint using your stored `DEEPSEEK_API_KEY`.
2. **Peak/valley pricing status** — whether DeepSeek API is currently in peak or off-peak (valley) pricing hours.

Pricing hours (Beijing time):

- Peak: 09:00–12:00, 14:00–18:00
- Valley: all other times (half price)

## Install

```bash
dsh plugin --profile web add ./dsh-peak-valley
```

Then restart `dsh web`.

## Behavior

- Shows only for official DeepSeek sessions (`provider: deepseek-official`).
- Balance is fetched every 5 minutes by default and can be refreshed manually from the pill.
- Peak/valley status is computed locally in the browser and refreshes every 30 seconds.
- No third-party network calls. The only outbound request is to the official DeepSeek balance endpoint.
