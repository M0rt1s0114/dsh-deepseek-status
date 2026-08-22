# dsh-deepseek-status

> GitHub: https://github.com/M0rt1s0114/dsh-deepseek-status

A small DeepSeek Harness web plugin that shows three pills in the session header for official DeepSeek sessions:

一个用于 DeepSeek Harness 的小插件，在官方 DeepSeek 会话头部显示三个胶囊：

1. **DeepSeek API balance / 余额** — fetched from the official `https://api.deepseek.com/user/balance` endpoint using your stored `DEEPSEEK_API_KEY`.
   — 使用你本地保存的 `DEEPSEEK_API_KEY` 请求官方余额接口。
2. **Top-up link / 充值入口** — a capsule button linking to `https://platform.deepseek.com/usage` for checking usage and recharging.
   — 一个胶囊按钮，点击跳转到 DeepSeek 平台用量页查看用量并充值。
3. **Peak/valley pricing status / 峰谷定价状态** — whether DeepSeek API is currently in peak or off-peak (valley) pricing hours.
   — 实时显示当前是 DeepSeek API 高峰时段还是空闲半价时段。

Pricing hours (Beijing time) / 峰谷时段（北京时间）：

- Peak / 高峰：09:00–12:00, 14:00–18:00
- Valley / 空闲：all other times (half price) / 其余时段（半价）

## Install / 安装

From GitHub / 从 GitHub 安装：

```bash
dsh plugin --profile web add github:M0rt1s0114/dsh-deepseek-status
```

Or from a local checkout / 或从本地目录安装：

```bash
dsh plugin --profile web add ./dsh-deepseek-status
```

Then restart `dsh web` / 然后重启 `dsh web`。

## Behavior / 行为

- Shows only for official DeepSeek sessions (`provider: deepseek-official`).
  仅在官方 DeepSeek 会话中显示（`provider: deepseek-official`）。
- Balance is fetched every 5 minutes by default and can be refreshed manually from the pill.
  余额默认每 5 分钟自动刷新，也可以点击胶囊内的刷新按钮手动刷新。
- The top-up capsule opens `https://platform.deepseek.com/usage` in a new tab.
  充值胶囊会在新标签页打开 `https://platform.deepseek.com/usage`。
- Peak/valley status is computed locally in the browser, refreshes every second, and shows an HH:MM:SS countdown to the end of the current pricing period.
  峰谷状态在浏览器本地计算，每秒刷新，并以 HH:MM:SS 显示当前计费时段剩余时间。
- No third-party network calls. The only outbound request is to the official DeepSeek balance endpoint.
  没有第三方网络请求；唯一对外请求是 DeepSeek 官方余额接口。

## Security / Audit / 安全与审计

This plugin reads your `DEEPSEEK_API_KEY` locally from DSH credentials and sends it only to `https://api.deepseek.com/user/balance`. It does not collect telemetry, does not call any third-party service, and does not upload your key.

本插件会在本地读取 DSH 凭据中的 `DEEPSEEK_API_KEY`，并且只将其发送到 `https://api.deepseek.com/user/balance`。它不收集遥测数据、不调用任何第三方服务、不上传你的密钥。

**We encourage you to audit the code before using it. / 我们鼓励你在使用前审计本插件代码。**

## Acknowledgements / 致谢

The balance API integration approach was inspired by / referenced from:

余额 API 集成方式参考了以下项目：

- [`@freespace8/dsh-deepseek-balance`](https://www.npmjs.com/package/@freespace8/dsh-deepseek-balance)
- [freespace8/dsh-plugins](https://github.com/freespace8/dsh-plugins)

We implemented our own version with a different, simpler host-side request path (Node built-in `fetch` instead of shell/curl). Thanks to the original project for the useful reference.

我们在此基础上重新实现了自己的版本，并改用更简单、跨平台的 Node 原生 `fetch` 请求方式（不再依赖 shell/curl）。感谢原项目提供了有价值的参考。

## License / 许可证

MIT
