import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/)
assert.ok(scriptMatch, 'index.html should contain the converter script')

const eventBindingMarker = 'els.dirCpaToSub.addEventListener'
const coreSource = scriptMatch[1].slice(0, scriptMatch[1].indexOf(eventBindingMarker))
assert.ok(coreSource.length > 0, 'converter core should be found before UI event bindings')

const elements = new Map()
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

const context = vm.createContext({
  Blob,
  TextEncoder,
  URL,
  Uint8Array,
  clearTimeout,
  console,
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, elementStub())
      return elements.get(id)
    }
  },
  setTimeout
})

vm.runInContext(`${coreSource}
globalThis.converter = {
  buildCPA,
  buildSub2API,
  buildGrok2APIBuild: typeof buildGrok2APIBuild === 'function' ? buildGrok2APIBuild : undefined,
  convertCPARecord,
  convertSubAccount,
  parseInputText,
  setDirection,
  validateSub2APIDataHeader
}`, context)

const converter = context.converter
const plain = (value) => JSON.parse(JSON.stringify(value))

test('Build direction UI is available and updates output state', () => {
  assert.match(html, /id="dirToGrok2APIBuild"/)
  assert.match(html, /CPA \/ sub2api -&gt; Grok2API Build|CPA \/ sub2api -> Grok2API Build/)

  converter.setDirection('to-grok2api-build')

  assert.equal(elements.get('outputTitle').textContent, 'Grok2API Build 导入包')
  assert.equal(elements.get('downloadSplitBtn').classList.contains('hidden'), false)
})

test('Build tabs provide compact responsive labels', () => {
  assert.match(html, /aria-label="CPA \/ sub2api -> Grok2API Build"/)
  assert.match(html, /class="wide-label">Grok2API Build<\/span>/)
  assert.match(html, /class="compact-label">CPA-&gt;sub<\/span>/)
  assert.match(html, /class="compact-label">sub-&gt;CPA<\/span>/)
  assert.match(html, /@media \(max-width: 1360px\)/)
})

test('CPA xAI converts to Grok2API Build', () => {
  assert.equal(typeof converter.buildGrok2APIBuild, 'function')

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

const sub2apiGrokAccount = {
  name: 'sub@example.com',
  platform: 'grok',
  type: 'oauth',
  credentials: {
    client_id: 'sub-client',
    access_token: 'sub-access',
    refresh_token: 'sub-refresh',
    id_token: 'sub-id',
    token_type: 'Bearer',
    scope: 'openid offline_access',
    expires_at: '2099-02-01T00:00:00Z',
    email: 'sub@example.com',
    sub: 'sub-user'
  }
}

test('sub2api Grok OAuth converts to Grok2API Build', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'sub2api.json',
    value: {
      type: 'sub2api-data',
      version: 1,
      proxies: [],
      accounts: [sub2apiGrokAccount]
    }
  }]))

  assert.equal(result.accountCount, 1)
  assert.equal(result.output.accounts[0].client_id, 'sub-client')
  assert.equal(result.output.accounts[0].access_token, 'sub-access')
  assert.equal(result.output.accounts[0].refresh_token, 'sub-refresh')
  assert.equal(result.output.accounts[0].id_token, 'sub-id')
  assert.equal(result.output.accounts[0].scope, 'openid offline_access')
  assert.equal(result.output.accounts[0].expires_at, '2099-02-01T00:00:00.000Z')
  assert.equal(result.output.accounts[0].email, 'sub@example.com')
  assert.equal(result.output.accounts[0].user_id, 'sub-user')
  assert.equal(result.previews[0].platform, 'sub2api Grok')
})

test('mixed CPA and sub2api input produces one merged Build document', () => {
  const result = plain(converter.buildGrok2APIBuild([
    {
      name: 'cpa.json',
      value: { type: 'xai', refresh_token: 'cpa-refresh', email: 'cpa@example.com' }
    },
    { name: 'sub.json', value: sub2apiGrokAccount }
  ]))

  assert.equal(result.accountCount, 2)
  assert.equal(result.output.accounts.length, 2)
  assert.equal(result.grok2apiFiles.length, 2)
})

test('wrapped sub2api data expands before Build conversion', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'wrapped.json',
    value: {
      data: {
        type: 'sub2api-data',
        version: 1,
        proxies: [],
        accounts: [sub2apiGrokAccount]
      }
    }
  }]))

  assert.equal(result.accountCount, 1)
  assert.equal(result.output.accounts[0].email, 'sub@example.com')
})

test('refresh_token-only Build account is emitted', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'refresh-only.json',
    value: { type: 'xai', refresh_token: 'refresh-only', email: 'refresh@example.com' }
  }]))

  assert.equal(result.accountCount, 1)
  assert.equal(result.output.accounts[0].access_token, undefined)
  assert.equal(result.output.accounts[0].refresh_token, 'refresh-only')
  assert.equal(result.output.accounts[0].expires_at, undefined)
  assert.equal(result.previews[0].status, '可自动续期')
  assert.equal(result.issues.length, 0)
})

test('missing both Build tokens is skipped', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'empty.json',
    value: { type: 'xai', email: 'empty@example.com' }
  }]))

  assert.equal(result.accountCount, 0)
  assert.match(result.skipped[0].reason, /access_token 和 refresh_token/)
})

test('missing refresh token keeps Build account with an issue', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'access-only.json',
    value: { type: 'xai', access_token: 'access-only' }
  }]))

  assert.equal(result.accountCount, 1)
  assert.match(result.issues[0].reason, /无法自动续期/)
  assert.equal(result.previews[0].status, '不可自动续期')
})

test('non-Bearer Build token type is skipped', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'basic.json',
    value: { type: 'xai', refresh_token: 'refresh', token_type: 'Basic' }
  }]))

  assert.equal(result.accountCount, 0)
  assert.match(result.skipped[0].reason, /token_type/)
})

test('invalid Build expires_at is omitted with an issue', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'expiry.json',
    value: { type: 'xai', refresh_token: 'refresh', expired: '0' }
  }]))

  assert.equal(result.output.accounts[0].expires_at, undefined)
  assert.match(result.issues[0].reason, /expires_at 无效/)
})

test('negative Build expires_in is omitted with an issue', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'negative-expiry.json',
    value: { type: 'xai', refresh_token: 'refresh', expires_in: -10 }
  }]))

  assert.equal(result.output.accounts[0].expires_in, undefined)
  assert.match(result.issues[0].reason, /expires_in 无效/)
})

test('nested CPA token fields are retained for Build import', () => {
  const result = plain(converter.buildGrok2APIBuild([{
    name: 'nested.json',
    value: {
      type: 'xai',
      email: 'nested@example.com',
      token: {
        access_token: 'nested-access',
        refresh_token: 'nested-refresh',
        id_token: 'nested-id',
        token_type: 'Bearer',
        scope: 'openid offline_access'
      }
    }
  }]))

  assert.equal(result.output.accounts[0].id_token, 'nested-id')
  assert.equal(result.output.accounts[0].scope, 'openid offline_access')
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
    {
      name: 'one.json',
      value: { type: 'xai', refresh_token: 'one', email: 'same@example.com' }
    },
    {
      name: 'two.json',
      value: { type: 'xai', refresh_token: 'two', email: 'same@example.com' }
    }
  ]))

  assert.equal(result.grok2apiFiles[0].name, 'grok2api-build-same-example.com.json')
  assert.equal(result.grok2apiFiles[1].name, 'grok2api-build-same-example.com-2.json')
})

test('CLIProxyAPI xai OAuth converts to a native sub2api grok account', () => {
  const result = plain(converter.buildSub2API([{
    name: 'xai-user.json',
    value: {
      type: 'xai',
      access_token: 'access-xai',
      refresh_token: 'refresh-xai',
      id_token: 'id-xai',
      token_type: 'Bearer',
      expired: '2099-01-01T00:00:00Z',
      email: 'xai@example.com',
      sub: 'subject-1',
      subscription_tier: 'SuperGrok',
      entitlement_status: 'active',
      base_url: 'https://api.x.ai/v1',
      auth_kind: 'oauth'
    }
  }]))

  assert.equal(result.accountCount, 1)
  const account = result.output.accounts[0]
  assert.equal(account.platform, 'grok')
  assert.equal(account.type, 'oauth')
  assert.equal(account.concurrency, 1)
  assert.equal(account.priority, 1)
  assert.equal(account.rate_multiplier, 1)
  assert.equal(account.auto_pause_on_expired, true)
  assert.equal(account.credentials.access_token, 'access-xai')
  assert.equal(account.credentials.refresh_token, 'refresh-xai')
  assert.equal(account.credentials.sub, 'subject-1')
  assert.equal(account.credentials.client_id, 'b1a00492-073a-47ea-816f-4c329264a828')
  assert.equal(account.credentials.scope, 'openid profile email offline_access grok-cli:access api:access')
  assert.equal(account.credentials.base_url, 'https://cli-chat-proxy.grok.com/v1')
  assert.deepEqual(account.extra, {
    email: 'xai@example.com',
    subscription_tier: 'SuperGrok',
    entitlement_status: 'active'
  })
})

test('bare sub2api-data restores grok auth fields but deliberately drops proxy details', () => {
  const payload = {
    type: 'sub2api-data',
    version: 1,
    exported_at: '2026-07-14T00:00:00Z',
    proxies: [{
      proxy_key: 'proxy-1',
      name: 'local',
      protocol: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      username: 'user',
      password: 'pass',
      status: 'active'
    }],
    accounts: [{
      name: 'Grok account',
      platform: 'grok',
      type: 'oauth',
      proxy_key: 'proxy-1',
      credentials: {
        access_token: 'access-grok',
        refresh_token: 'refresh-grok',
        id_token: 'id-grok',
        token_type: 'Bearer',
        expires_at: '2099-01-01T00:00:00Z',
        email: 'grok@example.com',
        sub: 'subject-2',
        base_url: 'https://cli-chat-proxy.grok.com/v1',
        using_api: false
      },
      concurrency: 1,
      priority: 1
    }]
  }

  const parsed = plain(converter.parseInputText(JSON.stringify(payload), 'sub2api.json'))
  assert.equal(parsed.entries.length, 1)

  const result = plain(converter.buildCPA(parsed.entries))
  assert.equal(result.accountCount, 1)
  assert.equal(result.proxyCount, 0)
  const auth = result.cpaFiles[0].data
  assert.equal(auth.type, 'xai')
  assert.equal(auth.email, 'grok@example.com')
  assert.equal(auth.sub, 'subject-2')
  assert.equal(auth.auth_kind, 'oauth')
  assert.equal(auth.base_url, 'https://api.x.ai/v1')
  assert.equal(auth.token_endpoint, 'https://auth.x.ai/oauth2/token')
  assert.equal(auth.using_api, false)
  assert.equal(auth.expired, '2099-01-01T00:00:00Z')
  assert.equal(auth.proxy_url, undefined)
  assert.equal(JSON.stringify(result.output).includes('pass'), false)
})

test('OpenAI fields and standard OAuth defaults remain compatible', () => {
  const result = plain(converter.buildSub2API([{
    name: 'codex.json',
    value: {
      type: 'codex',
      access_token: 'access-codex',
      refresh_token: 'refresh-codex',
      account_id: 'account-1',
      subscription_expires_at: '2099-12-31T00:00:00Z',
      chatgpt_account_is_fedramp: true,
      expired: '2099-01-01T00:00:00Z'
    }
  }]))

  const account = result.output.accounts[0]
  assert.equal(account.platform, 'openai')
  assert.equal(account.concurrency, 10)
  assert.equal(account.credentials.chatgpt_account_id, 'account-1')
  assert.equal(account.credentials.subscription_expires_at, '2099-12-31T00:00:00Z')
  assert.equal(account.credentials.chatgpt_account_is_fedramp, true)
})

test('sub2api account name remains the CPA email fallback', () => {
  const result = plain(converter.buildCPA([{
    name: 'sub2api-account.json',
    value: {
      name: 'user@example.com__ws_account-id',
      platform: 'openai',
      type: 'oauth',
      credentials: {
        access_token: 'access-openai',
        chatgpt_account_id: 'account-id',
        expires_at: '2099-01-01T00:00:00Z'
      },
      priority: 1
    }
  }]))

  assert.equal(result.accountCount, 1)
  assert.equal(result.cpaFiles[0].data.email, 'user@example.com__ws_account-id')
})

test('legacy CPA Gemini is forward-only and no invalid latest CPA file is emitted', () => {
  const forward = plain(converter.buildSub2API([{
    name: 'gemini.json',
    value: {
      type: 'gemini',
      project_id: 'project-1',
      token: {
        access_token: 'access-gemini',
        refresh_token: 'refresh-gemini'
      }
    }
  }]))
  assert.equal(forward.accountCount, 1)
  assert.equal(forward.output.accounts[0].platform, 'gemini')

  const reverse = plain(converter.buildCPA([{
    name: 'gemini-account.json',
    value: {
      name: 'Gemini account',
      platform: 'gemini',
      type: 'oauth',
      credentials: { access_token: 'access-gemini' }
    }
  }]))
  assert.equal(reverse.accountCount, 0)
  assert.match(reverse.skipped[0].reason, /已移除 Gemini auth/)
})

test('sub2api data headers follow the latest type and version validation', () => {
  assert.equal(converter.validateSub2APIDataHeader({
    type: 'sub2api-data',
    version: 1,
    proxies: [],
    accounts: []
  }), '')
  assert.match(converter.validateSub2APIDataHeader({
    type: 'unknown-data',
    version: 1,
    proxies: [],
    accounts: []
  }), /不支持的 sub2api data type/)
  assert.match(converter.validateSub2APIDataHeader({
    type: 'sub2api-data',
    version: 2,
    proxies: [],
    accounts: []
  }), /不支持的 sub2api data version/)
  assert.equal(converter.validateSub2APIDataHeader({
    name: 'single account',
    platform: 'openai',
    type: 'oauth',
    credentials: { access_token: 'access' }
  }), '')
})
