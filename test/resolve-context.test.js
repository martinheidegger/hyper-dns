const { test } = require('tape')
const createResolveContext = require('../resolve-context.js')
const { isLocal, matchRegex } = createResolveContext
const { rejects, fetchResponse } = require('./helpers.js')

const TEST_ERROR = new Error('TEST: DNS lookup failed')
const causeError = () => { throw TEST_ERROR }

test('instantiation', async t => {
  const ctx = createResolveContext(null, null, {})
  t.same(await ctx.getDNSTxtRecord('localhost'), undefined)
})

test('dns lookup a record works', async t => {
  const lookup = 'datproject.org/query'
  const domain = 'te-st?.com'
  const fetch = async (url, opts) => {
    t.equals(url, `${lookup}?name=${encodeURIComponent(domain)}.&type=TXT`)
    t.equals(opts.headers['User-Agent'], 'some')
    t.equals(opts.headers.Accept, 'application/dns-json')
    return fetchResponse({
      json: {
        Answer: [{
          data: 'hello',
          TTL: 23
        }]
      }
    })
  }
  const ctx = createResolveContext(fetch, null, {
    userAgent: 'some',
    dohLookups: [lookup]
  })
  t.deepEquals(await ctx.getDNSTxtRecord(domain, /(?<key>.*)/), { key: 'hello', ttl: 23 })
})

test('local dns lookups get ignored', async t => {
  let count = 0
  const fetch = async () => {
    count++
    return fetchResponse({ json: {} })
  }
  const ctx = createResolveContext(fetch, null, {
    dohLookups: ['any']
  })
  t.same(await ctx.getDNSTxtRecord('domain.local', /(?<key>.*)/), undefined)
  t.equals(count, 0)
})

test('multiple dns lookups are cached in memory', async t => {
  let count = 0
  const fetch = async () => {
    count++
    return fetchResponse({
      json: {
        Answer: [{ data: 'hello' }]
      }
    })
  }
  const ctx = createResolveContext(fetch, null, {
    dohLookups: ['any']
  })
  const p1 = ctx.getDNSTxtRecord('test.com', /(?<key>.*)/)
  const p2 = ctx.getDNSTxtRecord('test.com', /(?<key>.*)/)
  t.notEquals(p1, p2)
  await Promise.all([p1, p2])
  t.equals(count, 1)
})

test('dns uses smallest of multiple entries', async t => {
  const fetch = async () => fetchResponse({
    json: {
      Answer: [
        { data: 'd4' },
        { data: 'b2' },
        { data: 'a1' },
        { data: 'c3' }
      ]
    }
  })
  const ctx = createResolveContext(fetch, null, {
    dohLookups: ['any']
  })
  t.deepEquals(await ctx.getDNSTxtRecord('test.com', /(?<key>.*)/), { key: 'd4', ttl: undefined })
})

test('dns with invalid regex (missing key group) causes TypeError', async t => {
  const fetch = async () => fetchResponse({
    json: {
      Answer: [{
        data: 'hello'
      }]
    }
  })
  const ctx = createResolveContext(fetch, null, {
    dohLookups: ['any']
  })
  await rejects(t, ctx.getDNSTxtRecord('test.com', /(.*)/), 'specified txtRegex doesn\'t contain a "key" group like /(?<key>[0-9a-f]{64})/: /(.*)/')
})

test('dns lookup with fetch error falls back to other DNS', async t => {
  const fetch = async () => { throw new Error('fetch error') }
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  await rejects(t, ctx.getDNSTxtRecord('test.com'), TEST_ERROR)
})

test('dns lookup with http-status error falls back to other DNS', async t => {
  const fetch = async () => fetchResponse({
    status: 500,
    text: 'error'
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  await rejects(t, ctx.getDNSTxtRecord('test.com'), TEST_ERROR)
})

test('dns lookup with invalid json falls back to other DNS', async t => {
  const fetch = async () => fetchResponse({
    text: '<invalid json>'
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  await rejects(t, ctx.getDNSTxtRecord('test.com'), TEST_ERROR)
})

test('dns lookup non-object json falls back to other DNS', async t => {
  const fetch = async () => fetchResponse({
    text: '"hello"'
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  await rejects(t, ctx.getDNSTxtRecord('test.com'), TEST_ERROR)
})

test('dns lookup empty-object json fails gracefully', async t => {
  const fetch = async () => fetchResponse({
    json: {}
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  t.same(await ctx.getDNSTxtRecord('test.com'), undefined)
})

test('dns lookup wrong Answer falls back to other DNS', async t => {
  const fetch = async () => fetchResponse({
    json: {
      Answer: 'hello'
    }
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  await rejects(t, ctx.getDNSTxtRecord('test.com'), TEST_ERROR)
})

test('dns lookup no Answer json fails gracefully', async t => {
  const fetch = async () => fetchResponse({
    json: {
      Answer: []
    }
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  t.same(await ctx.getDNSTxtRecord('test.com'), undefined)
})

test('dns lookup other Answer json fails gracefully', async t => {
  const fetch = async () => fetchResponse({
    json: {
      Answer: [
        null,
        'hi', {
          data: 123
        },
        {
          data: 'hello'
        }
      ]
    }
  })
  const ctx = createResolveContext(fetch, causeError, {
    dohLookups: ['any']
  })
  t.equals(await ctx.getDNSTxtRecord('test.com', /xxx/), undefined)
})

test('fetch well-known', async t => {
  const key = 'abc'
  const localPort = '1234'
  const fetch = async (url, opts) => {
    t.equals(url, `https://localhost:${localPort}/.well-known/dat`)
    t.equals(opts.headers['User-Agent'], 'some')
    t.equals(opts.headers.Accept, 'text/plain')
    return fetchResponse({
      text: `${key}\nttl=123`
    })
  }
  const ctx = createResolveContext(fetch, null, {
    userAgent: 'some',
    localPort
  })
  t.deepEquals(
    await ctx.fetchWellKnown('localhost', 'dat', /(?<key>.{3})/, 0),
    {
      key,
      ttl: 123
    }
  )
})

test('fetch well-known (invalid ttl)', async t => {
  const key = 'abc'
  const fetch = async () => fetchResponse({
    text: `${key}\nttl=abc`
  })
  const ctx = createResolveContext(fetch, null, {
    userAgent: 'some'
  })
  t.deepEquals(
    await ctx.fetchWellKnown('localhost', 'dat', /(?<key>.{3})/, 0),
    {
      key,
      ttl: undefined
    }
  )
})

test('fetch well-known gracefully handles fetch error', async t => {
  const fetch = async () => { throw new Error('fetch error') }
  const ctx = createResolveContext(fetch, null, {
    userAgent: 'some'
  })
  t.deepEquals(
    await ctx.fetchWellKnown('localhost', 'dat', /(?<key>.{3})/, 0),
    undefined
  )
})

test('well-known lookup error (wrong format)', async t => {
  const fetch = async () => fetchResponse({
    text: 'abcd'
  })
  const ctx = createResolveContext(fetch, null, {})
  t.same(
    await ctx.fetchWellKnown('localhost', 'dat', /(?<key>xxx)/, 0),
    undefined
  )
})

test('well-known lookup error (key regex wrong)', async t => {
  const fetch = async () => fetchResponse({
    text: 'xxx'
  })
  const ctx = createResolveContext(fetch, null, {})
  await rejects(t, ctx.fetchWellKnown('localhost', 'dat', /(xxx)/, 0), 'specified keyRegex doesn\'t provide a "key" group response like /(?<key>[0-9a-f]{64})/: /(xxx)/')
})

for (const code of [301, 302, 307, 308]) {
  test(`well-known lookup (redirect) (status=${code})`, async t => {
    const fetch = async (url) => {
      if (url === 'https://localhost/.well-known/dat') {
        return fetchResponse({
          status: code,
          headers: [
            ['Location', '/redirect']
          ],
          text: '.'
        })
      }
      t.equals(url, 'https://localhost/redirect')
      return fetchResponse({
        text: 'xxx'
      })
    }
    const ctx = createResolveContext(fetch, null, {})
    t.deepEquals(
      await ctx.fetchWellKnown('localhost', 'dat', /^(?<key>.{3})$/, 0),
      {
        key: 'xxx',
        ttl: undefined
      }
    )
  })
}

test('error while well-known lookup (redirect without location)', async t => {
  const fetch = async () => fetchResponse({
    status: 302,
    text: '.'
  })
  const ctx = createResolveContext(fetch, null, {})
  t.same(
    await ctx.fetchWellKnown('localhost', 'dat'),
    undefined
  )
})

test('error while well-known lookup (redirect without https)', async t => {
  const fetch = async () => fetchResponse({
    status: 302,
    headers: [
      ['Location', 'http://some.domain']
    ],
    text: '.'
  })
  const ctx = createResolveContext(fetch, null, {})
  t.same(
    await ctx.fetchWellKnown('localhost', 'dat'),
    undefined
  )
})

test('error while well-known lookup (too many redirects)', async t => {
  const fetch = async () => fetchResponse({
    status: 302,
    headers: [
      ['Location', '/.well-known/dat']
    ],
    text: '.'
  })
  const ctx = createResolveContext(fetch, null, {})
  t.same(
    await ctx.fetchWellKnown('localhost', 'dat', /a/, 6),
    undefined
  )
})

test('cors warning for well-known lookups', async t => {
  const resultUrl = 'https://datproject.org/.well-known/dat'
  const fetch = async () => fetchResponse({
    url: resultUrl,
    text: 'abc'
  })
  let corsWarningExecuted = 0
  const ctx = createResolveContext(fetch, null, {
    corsWarning: (name, url) => {
      t.equals(name, 'localhost')
      t.equals(url, resultUrl)
      corsWarningExecuted++
    }
  })
  t.same(
    await ctx.fetchWellKnown('localhost', 'dat', /^(?<key>.{3})$/i, 6),
    { key: 'abc', ttl: undefined }
  )
  t.equals(corsWarningExecuted, 1)
})

test('no cors warning for well-known lookups with right header', async t => {
  const resultUrl = 'https://datproject.org/.well-known/dat'
  const fetch = async () => fetchResponse({
    url: resultUrl,
    headers: [
      ['access-control-allow-origin', '*']
    ],
    text: 'abc'
  })
  let corsWarningExecuted = 0
  const ctx = createResolveContext(fetch, null, {
    corsWarning: () => {
      corsWarningExecuted++
    }
  })
  t.same(
    await ctx.fetchWellKnown('localhost', 'dat', /^(?<key>.{3})$/i, 6),
    { key: 'abc', ttl: undefined }
  )
  t.equals(corsWarningExecuted, 0)
})

test('isLocal matches lonely domain names', async t => {
  t.ok(isLocal('localhost'))
  t.ok(isLocal('my.localhost'))
  t.ok(isLocal('my.local'))
  t.ok(isLocal('somehost'))
  t.ok(!isLocal('some.domain'))
})

test('matching key regex in context', async t => {
  t.equals(matchRegex('no-match', /[0-9]+/), undefined)
  t.deepEquals(matchRegex('abcd', /(?<key>.*)/), {
    key: 'abcd',
    ttl: null
  })
  t.throws(() => matchRegex('abcd', /(?:.*)/), TypeError)
})
