# 客户端配置依据

本项目的快速配置模板以各客户端官方文档或官方源码为准，不从 CC Switch
复制配置结构。CC Switch 仅作为桌面交互设计参考。

| 客户端 | 官方依据 | 本项目写入位置 |
| --- | --- | --- |
| codex | [OpenAI Codex config reference](https://developers.openai.com/codex/config-reference/) 和 [官方源码](https://github.com/openai/codex) | `~/.codex/config.toml` + `~/.codex/auth.json` |
| codex (WebSocket) | [OpenAI Codex 官方源码中的 provider capability](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json) | 同上，额外启用 `supports_websockets = true` |
| OpenCode | [OpenCode config](https://opencode.ai/docs/config/) | `~/.config/opencode/opencode.json` |

## Codex 模板约束

- `model_provider` 与 `[model_providers.<id>]` 使用模型协议供应商标识，默认是
  `OpenAI`，而不是站点名 `AIHub`。
- AIHub 使用 OpenAI-compatible Responses API，因此 `wire_api = "responses"`，
  `base_url = "https://aihub.top/v1"`。
- API Key 只写入 `~/.codex/auth.json` 的 `OPENAI_API_KEY` 字段，不再写入
  `config.toml`，也不生成 `catalog` 文件。
- `requires_openai_auth = false`，避免把 AIHub 当成 OpenAI 官方登录。
- `codex (WebSocket)` 只额外设置官方 schema 中的 `supports_websockets = true`。

OpenCode 模板使用官方示例中的 `provider.openai.options`、完整模型限制、
`store = false` 和推理 variants；API Key 直接放在 `opencode.json`，也可以由
OpenCode 的 `/connect` 命令重新配置。

配置字段可能随客户端版本变化。应用会持续读取本机实际文件，并将其作为
“本机当前配置”展示，不会因为内置模板存在而覆盖本机配置。当前配置工作区只
展示上述三个客户端入口。
