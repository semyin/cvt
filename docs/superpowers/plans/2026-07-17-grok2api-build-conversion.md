# Grok2API Build Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third local-only conversion mode that accepts CPA xAI and sub2api Grok OAuth credentials and emits Grok2API Build-compatible merged JSON plus split ZIP files, then deploy the updated static Worker.

**Architecture:** Keep the existing single-page architecture and add a separate Build conversion pipeline beside `buildSub2API` and `buildCPA`. Reuse the current token extraction, DataPayload validation, file parsing, preview, and ZIP helpers while isolating Build-specific detection, normalization, validation, and output generation in focused functions.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js `node:test`, Cloudflare Wrangler Assets.

---

### Task 1: Define CPA xAI Build Conversion Behavior

**Files:**
- Modify: `tests/converter.test.mjs`
- Modify: `public/index.html`

- [ ] **Step 1: Expose the wished-for Build converter to tests**

Add these names to the `globalThis.converter` object in `tests/converter.test.mjs`:

```js
buildGrok2APIBuild,
convertCPAToGrok2APIBuild,
normalizeGrok2APIBuildCredential
```

- [ ] **Step 2: Write a failing CPA xAI conversion test**

Add this test:

```js
test('CPA xAI converts to Grok2API Build', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'xai-user.json',
    value: {
      type: 'xai',
      name: 'XAI user',
      client_id: 'client-xai',
      access_token: 'access-xai',
      refresh_token: 'refresh-xai',
      id_token: 'id-xai',
      token_type: 'Bearer',
      scope: 'openid offline_access',
      expired: '2099-01-01T00:00:00Z',
      email: 'xai@example.com',
      sub: 'subject-1'
    }
  }]))

assert.equal(result.accountCount, 1)
assert.equal(result.fileName, 'grok2api-build-import.json')
assert.equal(result.downloadKind, 'json')
assert.equal(result.output.accounts[0].provider, 'grok_build')
assert.equal(result.output.accounts[0].name, 'xai@example.com')
assert.equal(result.output.accounts[0].client_id, 'client-xai')
assert.equal(result.output.accounts[0].access_token, 'access-xai')
assert.equal(result.output.accounts[0].refresh_token, 'refresh-xai')
assert.equal(result.output.accounts[0].id_token, 'id-xai')
assert.equal(result.output.accounts[0].token_type, 'Bearer')
assert.equal(result.output.accounts[0].scope, 'openid offline_access')
assert.equal(result.output.accounts[0].expires_at, '2099-01-01T00:00:00.000Z')
assert.equal(result.output.accounts[0].email, 'xai@example.com')
assert.equal(result.output.accounts[0].user_id, 'subject-1')
assert.equal(result.grok2apiFiles.length, 1)
assert.deepEqual(result.grok2apiFiles[0].data, result.output.accounts[0])
})
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="CPA xAI converts to Grok2API Build"
```

Expected: FAIL because `buildGrok2APIBuild` is not defined.

- [ ] **Step 4: Add minimal Build credential normalization**

In `public/index.html`, add:

```js
function normalizeRFC3339(value) {
  const text = asString(value).trim();
  if (!text) return "";
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeGrok2APIBuildCredential(candidate) {
  const issues = [];
  const accessToken = asString(candidate.access_token).trim();
  const refreshToken = asString(candidate.refresh_token).trim();
  if (!accessToken && !refreshToken) {
    return { skipped: true, reason: "缺少 access_token 和 refresh_token" };
  }
  const rawTokenType = asString(candidate.token_type).trim();
  if (rawTokenType && rawTokenType.toLowerCase() !== "bearer") {
    return { skipped: true, reason: `暂不支持 token_type: ${rawTokenType}` };
  }

  const account = {
    provider: "grok_build",
    name: firstString(candidate, ["name", "email", "user_id"]) || "Grok Build account",
    client_id: firstString(candidate, ["client_id"]) || XAI_DEFAULT_CLIENT_ID,
    token_type: "Bearer"
  };
  if (accessToken) account.access_token = accessToken;
  if (refreshToken) account.refresh_token = refreshToken;
  else issues.push("缺少 refresh_token，访问令牌过期后无法自动续期");

  for (const key of ["id_token", "scope", "email", "user_id", "team_id"]) {
    addKnownCredential(account, candidate, key);
  }
  const expiresAt = normalizeRFC3339(candidate.expires_at);
  if (expiresAt) account.expires_at = expiresAt;
  else if (asString(candidate.expires_at).trim()) issues.push("expires_at 无效，已忽略");
  const expiresIn = asInt(candidate.expires_in, null);
  if (!expiresAt && expiresIn !== null && expiresIn > 0) account.expires_in = expiresIn;
  return { account, issues };
}
```

- [ ] **Step 5: Add minimal CPA mapping and batch builder**

Add the initial CPA-only implementation:

```js
function convertCPAToGrok2APIBuild(entry) {
  const raw = entry.value;
  const meta = materializeCPARecord(raw);
  if (!meta) return { skipped: true, reason: "记录不是 JSON 对象" };
  const provider = providerFromCPA(raw, meta);
  if (provider !== "xai") return { skipped: true, reason: `暂不支持 provider: ${provider || "empty"}` };
  if (boolValue(meta.disabled)) return { skipped: true, reason: "disabled=true 已跳过" };

  const token = nestedToken(meta);
  return normalizeGrok2APIBuildCredential({
    name: firstString(meta, ["email", "sub", "subject", "label", "name"]),
    client_id: firstString(meta, ["client_id"]) || firstString(token, ["client_id"]),
    access_token: extractAccessToken(meta),
    refresh_token: extractRefreshToken(meta),
    id_token: firstString(meta, ["id_token", "idToken"]),
    token_type: firstString(meta, ["token_type"]) || firstString(token, ["token_type"]),
    scope: firstString(meta, ["scope"]) || firstString(token, ["scope"]),
    expires_at: extractExpiresAt(meta),
    expires_in: asInt(meta.expires_in, null),
    email: firstString(meta, ["email", "Email"]),
    user_id: firstString(meta, ["sub", "subject", "user_id", "principal_id"]),
    team_id: firstString(meta, ["team_id"])
  });
}

function grok2APIBuildFileName(account, fallback) {
  const identity = slugifyFilePart(account.email || account.user_id || account.name || fallback || "account");
  return `grok2api-build-${identity}.json`;
}

function buildGrok2APIBuild(entries) {
  const accounts = [];
  const previews = [];
  const issues = [];
  const skipped = [];
  const grok2apiFiles = [];
  const usedNames = new Set();

  for (const entry of entries) {
    const result = convertCPAToGrok2APIBuild(entry);
    if (result.skipped) {
      skipped.push({ source: entry.name, reason: result.reason });
      continue;
    }
    accounts.push(result.account);
    previews.push({
      name: result.account.name,
      platform: "CPA xAI",
      type: "Grok Build",
      expires: result.account.expires_at || "0",
      status: result.account.refresh_token ? "可自动续期" : "不可自动续期"
    });
    for (const issue of result.issues || []) issues.push({ source: entry.name, reason: issue });
  }

  for (const account of accounts) {
    grok2apiFiles.push({
      name: uniqueFileName(grok2APIBuildFileName(account, "account"), usedNames),
      data: account
    });
  }
  const output = { accounts };
  return {
    output,
    outputText: accounts.length ? formatOutput(output) : "",
    fileName: "grok2api-build-import.json",
    downloadKind: "json",
    cpaFiles: [],
    sub2apiFiles: [],
    grok2apiFiles,
    previews,
    issues,
    skipped,
    proxyCount: 0,
    accountCount: accounts.length
  };
}
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- --test-name-pattern="CPA xAI converts to Grok2API Build"
```

Expected: PASS.

### Task 2: Support sub2api Grok and Mixed Input

**Files:**
- Modify: `tests/converter.test.mjs`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing tests for sub2api and mixed input**

Add these tests with complete fixtures:

```js
const sub2apiGrokAccount = {
  name: 'sub@example.com',
  platform: 'grok',
  type: 'oauth',
  credentials: {
    client_id: 'sub-client',
    access_token: 'sub-access',
    refresh_token: 'sub-refresh',
    token_type: 'Bearer',
    expires_at: '2099-02-01T00:00:00Z',
    email: 'sub@example.com',
    sub: 'sub-user'
  }
}

test('sub2api Grok OAuth converts to Grok2API Build', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'sub2api.json',
    value: { type: 'sub2api-data', version: 1, proxies: [], accounts: [sub2apiGrokAccount] }
  }]))
  assert.equal(result.accountCount, 1)
  assert.equal(result.output.accounts[0].client_id, 'sub-client')
  assert.equal(result.output.accounts[0].user_id, 'sub-user')
})

test('mixed CPA and sub2api input produces one merged Build document', () => {
  const result = plain(converter.buildGrok2APIBuild([
    { name: 'cpa.json', value: { type: 'xai', refresh_token: 'cpa-refresh', email: 'cpa@example.com' } },
    { name: 'sub.json', value: sub2apiGrokAccount }
  ]))
  assert.equal(result.accountCount, 2)
  assert.equal(result.output.accounts.length, 2)
})

test('wrapped sub2api data expands before Build conversion', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'wrapped.json',
    value: { data: { type: 'sub2api-data', version: 1, proxies: [], accounts: [sub2apiGrokAccount] } }
  }]))
  assert.equal(result.accountCount, 1)
})
```

The sub2api assertions must cover `credentials.sub -> user_id`, `credentials.client_id`, both tokens, valid expiry, and `result.accountCount`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="sub2api Grok|mixed CPA|wrapped sub2api"
```

Expected: FAIL because Build mode does not expand or convert sub2api records.

- [ ] **Step 3: Implement source expansion and detection**

Add:

```js
function detectGrok2APISource(entry) {
  const raw = entry && entry.value;
  const meta = materializeCPARecord(raw);
  if (providerFromCPA(raw, meta || {}).toLowerCase() === "xai") return "cpa";
  if (raw && typeof raw === "object" && !Array.isArray(raw) &&
      firstString(raw, ["platform"]).toLowerCase() === "grok") return "sub2api";
  return "";
}
```

Add:

```js
function expandGrok2APIBuildEntries(entries) {
  const expanded = [];
  const skipped = [];
  for (const entry of entries) {
    const data = unwrapSub2APIEnvelope(entry.value);
    if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.accounts)) {
      const headerError = validateSub2APIDataHeader(data);
      if (headerError) {
        skipped.push({ source: entry.name, reason: headerError });
        continue;
      }
      data.accounts.forEach((account, index) => {
        expanded.push({ name: `${entry.name}:accounts[${index}]`, value: account });
      });
      continue;
    }
    expanded.push(entry);
  }
  return { entries: expanded, skipped };
}
```

- [ ] **Step 4: Implement sub2api mapping**

Add:

```js
function convertSubToGrok2APIBuild(entry) {
  const account = entry.value;
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return { skipped: true, reason: "记录不是 sub2api account 对象" };
  }
  const platform = firstString(account, ["platform"]).toLowerCase();
  if (platform !== "grok") return { skipped: true, reason: `暂不支持 platform: ${platform || "empty"}` };
  const type = firstString(account, ["type"]).toLowerCase();
  if (type && type !== "oauth") return { skipped: true, reason: `Grok Build 仅支持 OAuth，当前 type=${type}` };
  const credentials = account.credentials && typeof account.credentials === "object" ? account.credentials : {};
  return normalizeGrok2APIBuildCredential({
    name: firstString(account, ["name"]) || firstString(credentials, ["email", "sub"]),
    client_id: firstString(credentials, ["client_id"]),
    access_token: firstString(credentials, ["access_token", "accessToken"]),
    refresh_token: firstString(credentials, ["refresh_token", "refreshToken"]),
    id_token: firstString(credentials, ["id_token", "idToken"]),
    token_type: firstString(credentials, ["token_type"]),
    scope: firstString(credentials, ["scope"]),
    expires_at: firstString(credentials, ["expires_at", "expired", "expiry", "expires"]),
    expires_in: asInt(credentials.expires_in, null),
    email: firstString(credentials, ["email"]) || firstString(account, ["name"]),
    user_id: firstString(credentials, ["sub", "subject", "user_id", "principal_id"]),
    team_id: firstString(credentials, ["team_id"])
  });
}
```

Update `buildGrok2APIBuild` to call `expandGrok2APIBuildEntries`, identify CPA entries with `providerFromCPA(...) === "xai"`, identify sub2api entries with `platform === "grok"`, call the matching converter, and append expansion errors to `skipped`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- --test-name-pattern="sub2api Grok|mixed CPA|wrapped sub2api"
```

Expected: PASS.

### Task 3: Validate Refresh, Expiry, Token Type, and Skips

**Files:**
- Modify: `tests/converter.test.mjs`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing validation tests**

Add these tests:

```js
test('refresh_token-only Build account is emitted', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'refresh-only.json',
    value: { type: 'xai', refresh_token: 'refresh-only', email: 'refresh@example.com' }
  }]))
  assert.equal(result.accountCount, 1)
  assert.equal(result.output.accounts[0].access_token, undefined)
  assert.equal(result.output.accounts[0].refresh_token, 'refresh-only')
  assert.equal(result.previews[0].status, '可自动续期')
})

test('missing both Build tokens is skipped', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'empty.json', value: { type: 'xai', email: 'empty@example.com' }
  }]))
  assert.equal(result.accountCount, 0)
  assert.match(result.skipped[0].reason, /access_token 和 refresh_token/)
})

test('missing refresh token keeps Build account with an issue', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'access-only.json', value: { type: 'xai', access_token: 'access-only' }
  }]))
  assert.equal(result.accountCount, 1)
  assert.match(result.issues[0].reason, /无法自动续期/)
  assert.equal(result.previews[0].status, '不可自动续期')
})

test('non-Bearer Build token type is skipped', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'basic.json', value: { type: 'xai', refresh_token: 'refresh', token_type: 'Basic' }
  }]))
  assert.equal(result.accountCount, 0)
  assert.match(result.skipped[0].reason, /token_type/)
})

test('invalid Build expires_at is omitted with an issue', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'expiry.json', value: { type: 'xai', refresh_token: 'refresh', expired: '0' }
  }]))
  assert.equal(result.output.accounts[0].expires_at, undefined)
  assert.match(result.issues[0].reason, /expires_at 无效/)
})

test('non-Grok records are skipped without blocking valid Build accounts', () => {
  const result = plain(converter.buildGrok2APIBuild([
    { name: 'codex.json', value: { type: 'codex', refresh_token: 'codex-refresh' } },
    { name: 'xai.json', value: { type: 'xai', refresh_token: 'xai-refresh' } }
  ]))
  assert.equal(result.accountCount, 1)
  assert.equal(result.skipped.length, 1)
})

test('Build split filenames remain unique', () => {
  const result = plain(converter.buildGrok2APIBuild([
    { name: 'one.json', value: { type: 'xai', refresh_token: 'one', email: 'same@example.com' } },
    { name: 'two.json', value: { type: 'xai', refresh_token: 'two', email: 'same@example.com' } }
  ]))
  assert.equal(result.grok2apiFiles[0].name, 'grok2api-build-same-example.com.json')
  assert.equal(result.grok2apiFiles[1].name, 'grok2api-build-same-example.com-2.json')
})
```

- [ ] **Step 2: Run validation tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="refresh_token-only|missing both|missing refresh|non-Bearer|invalid expires|non-Grok|split filenames"
```

Expected: At least one assertion fails for each unimplemented edge case.

- [ ] **Step 3: Complete validation and preview metadata**

Update normalization so it:

- accepts refresh-only records;
- omits empty optional fields;
- rejects unsupported token types;
- writes `expires_at` only after successful RFC3339 parsing;
- writes positive `expires_in` only when no valid absolute expiry exists;
- reports record-level issues and skips;
- sets preview `type` to `CPA xAI` or `sub2api Grok`;
- sets preview status to `可自动续期`, `不可自动续期`, or joined warnings.

Keep `grok2APIBuildFileName(account, fallback)` from Task 1 and cover its collision behavior by converting two accounts with the same email and asserting filenames end in `.json` and `-2.json`.

- [ ] **Step 4: Run validation tests and verify GREEN**

Run the same command and expect all matching tests to pass.

### Task 4: Integrate the Third UI Direction

**Files:**
- Modify: `public/index.html`
- Modify: `tests/converter.test.mjs`

- [ ] **Step 1: Write a failing UI contract test**

Replace the test element stub with a tracked `classList` implementation:

```js
const elementStub = () => {
  const classes = new Set()
  return {
    checked: true,
    disabled: false,
    value: '',
    textContent: '',
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)) },
      remove(...names) { names.forEach((name) => classes.delete(name)) },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : force
        if (enabled) classes.add(name)
        else classes.delete(name)
        return enabled
      },
      contains(name) { return classes.has(name) }
    },
    setAttribute() {}
  }
}
```

Expose `setDirection`, then add:

```js
test('Build direction UI is available and updates output state', () => {
  assert.match(html, /id="dirToGrok2APIBuild"/)
  assert.match(html, /CPA \/ sub2api -&gt; Grok2API Build|CPA \/ sub2api -> Grok2API Build/)
  converter.setDirection('to-grok2api-build')
  assert.equal(elements.get('outputTitle').textContent, 'Grok2API Build 导入包')
  assert.equal(elements.get('downloadSplitBtn').classList.contains('hidden'), false)
})
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="Build direction UI"
```

Expected: FAIL because the third tab and direction state are absent.

- [ ] **Step 3: Add the third tab and state wiring**

Add the button:

```html
<button id="dirToGrok2APIBuild" type="button" role="tab" aria-selected="false">CPA / sub2api -> Grok2API Build</button>
```

Add `dirToGrok2APIBuild` to `els`, add `lastGrok2APIFiles: []` to `state`, and dispatch conversion with:

```js
const result = state.direction === "cpa-to-sub"
  ? buildSub2API(collected.entries)
  : state.direction === "sub-to-cpa"
    ? buildCPA(collected.entries)
    : buildGrok2APIBuild(collected.entries);
```

In `renderResult`, save `result.grok2apiFiles || []` and hide the split button only when the direction is `sub-to-cpa`.

In `setDirection`, set selected classes and `aria-selected` on all three buttons. For `to-grok2api-build`, set:

```js
els.inputTitle.textContent = "输入 CPA xAI / sub2api Grok JSON";
els.inputHint.textContent = "支持 CPA xAI、sub2api Grok、DataPayload、数组、NDJSON 和混合多文件。";
els.outputTitle.textContent = "Grok2API Build 导入包";
els.outputHint.textContent = "输出为 Grok2API Build 可直接导入的 accounts JSON。";
els.sourceInput.placeholder = '{"type":"xai","refresh_token":"...","email":"me@example.com"}';
```

Change the split click handler to call `downloadZipFiles(state.lastGrok2APIFiles, "grok2api-build-auth-files.zip")` in Build mode and retain `downloadSplitSub2APIZip()` in CPA-to-sub mode.

- [ ] **Step 4: Add Build sample and explanatory copy**

Define a `grok2apiBuildSample` string containing `cpa-build@example.com` with tokens `cpa-at/cpa-rt` and `sub-build@example.com` with tokens `sub-at/sub-rt`. Update the page summary and capability notes to name the new local-only Build conversion mode.

- [ ] **Step 5: Run the UI test and verify GREEN**

Run the same focused command and expect PASS.

### Task 5: Update Documentation and Run Regression Tests

**Files:**
- Modify: `README.md`
- Test: `tests/converter.test.mjs`

- [ ] **Step 1: Update README functionality and format sections**

Document:

- the third conversion direction;
- supported CPA xAI and sub2api Grok wrappers;
- merged `grok2api-build-import.json` output;
- split `grok2api-build-auth-files.zip` output;
- requirement for at least one token;
- importance of `refresh_token` for automatic renewal;
- local-only security behavior.

- [ ] **Step 2: Run formatting checks**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: all existing and new tests pass with no warnings.

### Task 6: Browser Verification

**Files:**
- No source changes expected unless verification finds a defect.

- [ ] **Step 1: Install dependencies**

Run:

```powershell
npm install
```

- [ ] **Step 2: Start the local Worker**

Run:

```powershell
npm run dev -- --port 8791
```

Keep the process running until browser verification finishes.

- [ ] **Step 3: Verify desktop and mobile layouts**

Use browser automation to open `http://127.0.0.1:8791`, select the Build direction, load the mixed sample, and verify:

- no overlapping controls at desktop and mobile widths;
- merged output contains two Build accounts;
- preview and warning text remain readable;
- main JSON and split ZIP buttons enable;
- existing two directions still switch correctly.

- [ ] **Step 4: Check browser console**

Expected: no uncaught errors or failed local asset requests.

### Task 7: Locate and Deploy the Existing Worker

**Files:**
- Deployment metadata only; no credential files added to the repository.

- [ ] **Step 1: Check local Wrangler authentication**

Run:

```powershell
npm run whoami
```

If authenticated for the account that owns `cvt`, proceed locally. Otherwise inspect the existing deployment host for the `cvt` checkout and Wrangler authentication without printing secrets.

- [ ] **Step 2: Back up the deployed source or identify rollback version**

Before deploying, record the current Worker deployment version and preserve the existing server checkout or Cloudflare deployment identifier so rollback is available.

- [ ] **Step 3: Deploy the Worker assets**

From the authenticated checkout, run:

```powershell
npm run deploy
```

Expected: Wrangler reports a successful deployment for Worker `cvt`.

- [ ] **Step 4: Verify production**

Open `https://cvt.okcode.cc.cd` and verify the third conversion direction, mixed sample conversion, merged JSON output, and split ZIP activation.

- [ ] **Step 5: Report rollback information**

Record the previous deployment identifier and the newly deployed version in the final handoff without exposing Cloudflare credentials.
