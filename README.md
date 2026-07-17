# cvt

CPA / sub2api / Grok2API Build 账号凭证格式转换工具。项目是一个纯静态 Web 页面，部署在 Cloudflare Workers Assets 上，所有解析和生成都在浏览器本地完成。

当前转换规则按以下源码基线同步：

- CLIProxyAPI `411d7d41`（2026-07-14）
- sub2api `da85cc7e`（2026-07-14）

在线地址：

```text
https://cvt.okcode.cc.cd
```

仓库地址：

```text
https://github.com/semyin/cvt
```

## 功能

- `CLIProxyAPI auth JSON -> sub2api DataPayload`
- `sub2api DataPayload -> CLIProxyAPI auth JSON`
- `CPA xAI / sub2api Grok -> Grok2API Build JSON`
- 支持粘贴单个 JSON、数组、NDJSON、连续多个 JSON 对象
- 支持选择多个 `.json` 文件
- CPA 转 sub2api 可下载汇总 JSON，也可下载按账号拆分的 ZIP
- sub2api 转 CPA 会下载 ZIP，每个账号一个 CLIProxyAPI 原生 auth JSON
- Grok2API Build 转换可下载合并 JSON，也可下载每账号一个 JSON 的拆分 ZIP
- 支持 `codex <-> openai`、`claude <-> anthropic`、`antigravity <-> antigravity`、`xai <-> grok`
- 兼容旧 CPA `gemini` / `gemini-cli` 文件向 sub2api 单向迁移

## 转换规则

### CPA -> sub2api

输出文件是 sub2api 前端导入弹窗可读取的 `sub2api-data` v1 DataPayload：

```json
{
  "type": "sub2api-data",
  "version": 1,
  "exported_at": "2026-07-14T00:00:00.000Z",
  "proxies": [],
  "accounts": []
}
```

账号只转换凭证相关字段。`disabled=true` 的 CPA 账号会被跳过。

为了保持和 sub2api 默认 OAuth 新建账号一致，CPA 转出的普通账号会写入：

```json
{
  "concurrency": 10,
  "priority": 1,
  "rate_multiplier": 1,
  "auto_pause_on_expired": true
}
```

Grok OAuth 按最新 sub2api 新建表单使用 `concurrency: 1`，其余默认字段不变。

不会写入：

- `notes`
- `proxy_key`
- `group_ids`
- `load_factor`
- 账号级 `expires_at`

注意：token 的 `credentials.expires_at` 会保留；这里不写的是 sub2api 账号本身的过期时间。

这是一个公开使用的转换页面，因此两个方向都不会携带或还原代理配置。输入中的 `proxy_url`、`proxy_key`、代理用户名和密码会被主动丢弃。

### sub2api -> CPA

CPA 当前按“每账号一个 auth JSON”管理，不是一个 JSON 文件包含多个账号的导入格式。因此反向转换会生成 ZIP，解压后可得到多个 CPA auth JSON 文件。

CLIProxyAPI 最新源码已移除内置 Gemini auth 文件加载，`type: "gemini"` 会被直接忽略。因此反向转换遇到 sub2api Gemini 账号时会明确跳过，不生成无效的 CPA 文件；旧 CPA Gemini 文件仍可正向迁移到 sub2api。

支持从以下输入中读取账号：

- `sub2api-data` DataPayload
- `{ "data": { ... } }` 导入接口包装格式
- `accounts` 数组
- 单个 account 对象

带 `type` / `version` 的 DataPayload 会按 sub2api 当前规则校验：支持 `sub2api-data`、兼容 `sub2api-bundle`，版本为 `1`，并要求同时提供 `proxies` 和 `accounts` 数组。

### CPA / sub2api -> Grok2API Build

第三种转换方向只读取 Grok OAuth 凭证：

- CPA 输入要求 `type`、`provider` 或 `Provider` 为 `xai`
- sub2api 输入要求 `platform: "grok"`，且 `type` 为空或为 `oauth`
- 支持完整 `sub2api-data`、`{ "data": { ... } }` 包装、`accounts` 数组和单账号对象
- CPA 与 sub2api 文件可以混合粘贴或多选上传
- 非 Grok 账号会跳过，不影响其他有效账号

合并下载文件名为 `grok2api-build-import.json`，格式可直接用于 Grok2API Build 导入：

```json
{
  "accounts": [
    {
      "provider": "grok_build",
      "name": "user@example.com",
      "client_id": "b1a00492-073a-47ea-816f-4c329264a828",
      "access_token": "access-token",
      "refresh_token": "refresh-token",
      "token_type": "Bearer",
      "expires_at": "2099-01-01T00:00:00.000Z",
      "email": "user@example.com",
      "user_id": "xai-user-id"
    }
  ]
}
```

拆分下载文件名为 `grok2api-build-auth-files.zip`，其中每个 JSON 文件保存一个账号对象。`access_token` 与 `refresh_token` 至少需要一个；缺少 `refresh_token` 时仍会生成账号，但访问令牌过期后无法自动续期。

`expires_at` 仅在符合 RFC3339 时写入，无效值会忽略并显示警告。转换不会连接 Grok2API 管理接口，也不会上传令牌。

## 本地开发

安装依赖：

```powershell
npm install
```

启动本地 Worker：

```powershell
npm run dev
```

运行转换回归测试：

```powershell
npm test
```

部署到 Cloudflare Workers：

```powershell
npm run deploy
```

当前 Worker 名称在 `wrangler.jsonc` 中配置为：

```json
{
  "name": "cvt"
}
```

## 项目结构

```text
.
├─ public/
│  └─ index.html      # 转换页面和全部前端逻辑
├─ tests/
│  └─ converter.test.mjs # 凭证格式回归测试
├─ package.json       # Wrangler 命令
├─ wrangler.jsonc     # Cloudflare Workers Assets 配置
└─ README.md
```

## 安全说明

页面不需要后端 API，不会上传账号凭证。输入的 access token、refresh token、id token 等敏感信息只在当前浏览器内解析和生成下载文件。

仍建议只在可信设备和可信浏览器环境中使用，并避免把生成文件提交到公开仓库或聊天窗口。
