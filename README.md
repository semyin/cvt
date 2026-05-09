# cvt

CPA / sub2api 账号凭证格式转换工具。项目是一个纯静态 Web 页面，部署在 Cloudflare Workers Assets 上，所有解析和生成都在浏览器本地完成。

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
- 支持粘贴单个 JSON、数组、NDJSON、连续多个 JSON 对象
- 支持选择多个 `.json` 文件
- CPA 转 sub2api 可下载汇总 JSON，也可下载按账号拆分的 ZIP
- sub2api 转 CPA 会下载 ZIP，每个账号一个 CLIProxyAPI 原生 auth JSON

## 转换规则

### CPA -> sub2api

输出文件是 sub2api 前端导入弹窗可读取的 `sub2api-data` v1 DataPayload：

```json
{
  "type": "sub2api-data",
  "version": 1,
  "exported_at": "2026-05-09T00:00:00.000Z",
  "proxies": [],
  "accounts": []
}
```

账号只转换凭证相关字段。`disabled=true` 的 CPA 账号会被跳过。

为了保持和 sub2api 默认 OAuth 新建账号一致，CPA 转出的每个 sub2api 账号会写入：

```json
{
  "concurrency": 10,
  "priority": 1,
  "rate_multiplier": 1,
  "auto_pause_on_expired": true
}
```

不会写入：

- `notes`
- `proxy_key`
- `group_ids`
- `load_factor`
- 账号级 `expires_at`

注意：token 的 `credentials.expires_at` 会保留；这里不写的是 sub2api 账号本身的过期时间。

### sub2api -> CPA

CPA 当前按“每账号一个 auth JSON”管理，不是一个 JSON 文件包含多个账号的导入格式。因此反向转换会生成 ZIP，解压后可得到多个 CPA auth JSON 文件。

支持从以下输入中读取账号：

- `sub2api-data` DataPayload
- `{ "data": { ... } }` 导入接口包装格式
- `accounts` 数组
- 单个 account 对象

## 本地开发

安装依赖：

```powershell
npm install
```

启动本地 Worker：

```powershell
npm run dev
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
├─ package.json       # Wrangler 命令
├─ wrangler.jsonc     # Cloudflare Workers Assets 配置
└─ README.md
```

仓库外的 `../cpa-sub2api-converter.html` 是同内容的本地静态 HTML 备份，修改页面时建议同步更新。

## 安全说明

页面不需要后端 API，不会上传账号凭证。输入的 access token、refresh token、id token 等敏感信息只在当前浏览器内解析和生成下载文件。

仍建议只在可信设备和可信浏览器环境中使用，并避免把生成文件提交到公开仓库或聊天窗口。
