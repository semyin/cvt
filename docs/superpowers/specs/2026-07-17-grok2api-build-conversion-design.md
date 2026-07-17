# Grok2API Build 转换设计

## 目标

在保留现有 `CPA -> sub2api` 和 `sub2api -> CPA` 功能的基础上，为 `cvt` 增加第三种转换方向：

```text
CPA xAI / sub2api Grok -> Grok2API Build
```

转换全程在浏览器本地完成，不连接 Grok2API 管理接口，也不上传账号凭证。输出同时支持可直接批量导入的合并 JSON，以及每账号一个 JSON 的拆分 ZIP。

## 范围

- 支持 CPA `type/provider = xai` OAuth 账号。
- 支持 sub2api `platform = grok` 且 `type = oauth` 的账号。
- 支持单个 JSON、数组、NDJSON、连续 JSON、多文件和 CPA/sub2api 混合输入。
- 输出 Grok2API Build 原生导入格式。
- 保留现有页面、转换方向和下载行为。
- 更新自动化测试与 README。

## 非目标

- 不直接调用 Grok2API 管理 API。
- 不处理 Grok Web SSO 账号。
- 不把其他平台账号转换为 Grok Build。
- 不携带或生成代理配置。
- 不主动合并重复账号；Grok2API 导入端按账号身份负责幂等更新。

## 页面交互

现有方向切换区增加第三个标签：

```text
CPA / sub2api -> Grok2API Build
```

选择该方向后：

- 输入标题改为“输入 CPA xAI / sub2api Grok JSON”。
- 输入提示说明支持两种来源混合粘贴或上传。
- 输出标题改为“Grok2API Build 导入包”。
- 主下载按钮生成 `grok2api-build-import.json`。
- 拆分下载按钮生成 `grok2api-build-auth-files.zip`。
- 示例数据同时包含一个 CPA xAI 账号和一个 sub2api Grok 账号。
- 预览区显示账号名称、识别出的来源格式、过期时间和自动续期状态。

原有两个方向的文案、输入识别和下载文件保持不变。

## 输入识别

Build 模式先展开通用 JSON 容器，再逐条识别账号来源。

### CPA xAI

满足以下任一条件时按 CPA 账号处理：

- 顶层 `type` 为 `xai`。
- 顶层 `provider` 或 `Provider` 为 `xai`。
- 账号位于现有 `auths` 数组内，展开后满足上述条件。

兼容现有 CPA 的顶层字段和 `metadata` 包装形式，也兼容 `token` 内嵌令牌字段。

### sub2api Grok

满足以下条件时按 sub2api 账号处理：

- 账号对象的 `platform` 为 `grok`。
- `type` 为空或为 `oauth`。

支持以下包装形式：

- `sub2api-data` 或 `sub2api-bundle` DataPayload。
- `{ "data": { ... } }` 导入接口包装。
- 顶层 `accounts` 数组。
- 单个 account 对象。

DataPayload 继续使用现有类型、版本、`accounts` 和 `proxies` 校验规则。

### 无法识别的记录

非 xAI/Grok 记录不会终止整批转换，而是进入跳过列表并显示来源文件和具体原因。

## 输出格式

合并输出使用 Grok2API 原生批量格式：

```json
{
  "accounts": [
    {
      "provider": "grok_build",
      "name": "user@example.com",
      "client_id": "b1a00492-073a-47ea-816f-4c329264a828",
      "access_token": "access-token",
      "refresh_token": "refresh-token",
      "id_token": "id-token",
      "token_type": "Bearer",
      "scope": "openid profile email offline_access grok-cli:access api:access",
      "expires_at": "2026-07-17T12:00:00Z",
      "email": "user@example.com",
      "user_id": "xai-user-id"
    }
  ]
}
```

拆分 ZIP 中的每个文件保存一个不带 `accounts` 包装的账号对象。Grok2API 的 `/api/admin/v1/accounts/import` 同时接受单账号对象和批量包装格式。

## 字段映射

| Grok2API 字段 | CPA xAI 来源 | sub2api Grok 来源 | 规则 |
| --- | --- | --- | --- |
| `provider` | 固定值 | 固定值 | 始终写入 `grok_build` |
| `name` | `email`、`sub`、`label/name` | account `name`、credentials `email/sub` | 使用首个非空值 |
| `client_id` | `client_id` 或 token `client_id` | credentials `client_id` | 缺失时使用 xAI 默认 Client ID |
| `access_token` | 顶层或 token 内字段 | credentials 字段 | 可选，但必须和 `refresh_token` 至少存在一个 |
| `refresh_token` | 顶层或 token 内字段 | credentials 字段 | 缺失时保留账号并提示无法自动续期 |
| `id_token` | `id_token` | credentials `id_token` | 可选 |
| `token_type` | 顶层或 token `token_type` | credentials `token_type` | 缺失时写入 `Bearer`；非 Bearer 时跳过 |
| `scope` | 顶层或 token `scope` | credentials `scope` | 可选；缺失时不强制写入 |
| `expires_at` | `expires_at/expired/expiry/expires` | credentials 对应字段 | 仅写入合法 RFC3339 时间 |
| `expires_in` | `expires_in` | credentials `expires_in` | 没有合法 `expires_at` 时保留合法正整数 |
| `email` | `email` | credentials `email` 或 account `name` | 可选 |
| `user_id` | `sub/subject/user_id/principal_id` | credentials `sub/subject/user_id/principal_id` | 可选 |
| `team_id` | `team_id` | credentials `team_id` | 可选 |

`scope`、`id_token`、`email`、`user_id` 和 `team_id` 不作为导入成功的硬性条件。输出中不写空字符串字段。

## 校验与错误处理

每条账号独立转换，错误按记录隔离：

- 缺少 `access_token` 和 `refresh_token`：跳过。
- `token_type` 非空且不是 `Bearer`：跳过。
- `expires_at` 合法：转换为标准 ISO/RFC3339 字符串后写入。
- `expires_at` 无效：忽略该字段并产生警告，不跳过账号。
- `expires_in` 小于零或不是有限整数：忽略并产生警告。
- 缺少 `refresh_token`：账号仍输出，但标记“不可自动续期”。
- sub2api `type` 不是 `oauth`：跳过。
- 非 Grok 平台：跳过。
- 输入 JSON 解析失败：沿用现有解析错误展示，不影响其他文件。

转换结果只有在至少生成一个有效账号时才启用下载按钮。

## 代码结构

继续保持项目的单文件页面结构，不进行无关重构。新增职责清晰的转换单元：

- `expandGrok2APIBuildEntries(entries)`：展开 CPA/sub2api 容器并保留来源信息。
- `detectGrok2APISource(entry)`：判断记录是 CPA xAI、sub2api Grok 或不支持记录。
- `convertCPAToGrok2APIBuild(entry)`：把 CPA xAI 凭证规范化为 Build 账号。
- `convertSubToGrok2APIBuild(entry)`：把 sub2api Grok 凭证规范化为 Build 账号。
- `normalizeGrok2APIBuildCredential(candidate)`：统一校验令牌、身份、过期时间和可选字段。
- `buildGrok2APIBuild(entries)`：汇总账号、预览、警告、跳过记录和下载文件。
- `grok2APIBuildFileName(account, fallback)`：生成稳定且无冲突的拆分文件名。

现有 `buildSub2API`、`buildCPA`、`convertCPARecord` 和 `convertSubAccount` 行为保持不变。

## 测试策略

使用现有 Node `node:test` 测试框架，先编写失败测试，再实现功能。覆盖以下行为：

1. CPA xAI OAuth 转换为 Grok2API Build 批量账号。
2. sub2api Grok OAuth 转换为相同目标格式。
3. CPA 与 sub2api 混合输入同时生成账号。
4. 完整 DataPayload 和 `{data: ...}` 包装正确展开。
5. 非 Grok 账号被跳过，其他账号继续转换。
6. 仅有 `refresh_token` 的账号仍可导入并标记可续期。
7. 同时缺少两种令牌的账号被跳过。
8. 缺少 `refresh_token` 时输出账号并产生警告。
9. 非 Bearer `token_type` 被跳过。
10. 无效 `expires_at` 被移除并产生警告。
11. 合并输出使用 `{accounts:[...]}`，文件名正确。
12. 拆分输出每文件一个账号对象，文件名唯一。
13. 原有 CPA/sub2api 回归测试全部继续通过。

## 文档

README 增加：

- 第三种转换方向。
- 支持的 CPA/sub2api Grok 输入形式。
- Grok2API Build 合并和拆分输出说明。
- `refresh_token` 对自动续期的重要性。
- 本地处理和不连接管理 API 的安全边界。

## 验收标准

- 页面可以在第三个方向中同时读取 CPA xAI 和 sub2api Grok 文件。
- 生成的合并 JSON 可被当前 Grok2API Build 导入接口接受。
- 拆分 ZIP 中的单账号 JSON 可逐个导入。
- 无效账号有明确原因，不影响有效账号输出。
- 页面不发送包含凭证的网络请求。
- 现有两个方向无行为回归。
- `npm test` 全部通过。
