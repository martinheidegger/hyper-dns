// For local https server
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const { AbortError } = require('@consento/promise/AbortError')
const { test } = require('tape')
const { resolveProtocol, resolve, resolveURL, RecordNotFoundError } = require('../resolve.js')
const { rejects, tRange, compareURL } = require('./helpers.js')
const createCacheLRU = require('../cache-lru.js')

const dummyCtx = () => ({
  isLocal: () => true,
  matchRegex: () => {},
  getDNSTxtRecord: () => {},
  fetchWellKnown: () => {}
})

test('basic resolving', async t => {
  const testContext = {}
  const testName = 'Foo'
  const key = 'Bar'
  const cache = createCacheLRU()
  const createContext = (opts, signal) => {
    t.deepEquals(opts, {
      ...resolveProtocol.DEFAULTS,
      cache
    })
    t.equals(signal, undefined)
    return testContext
  }
  const start = Date.now()
  t.same(
    await resolveProtocol(createContext, async function test (context, name) {
      t.equals(context, testContext)
      t.equals(name, testName)
      return {
        key,
        ttl: 40
      }
    }, testName, { cache }),
    key
  )
  tRange(t, 40000, (await cache.get('test', testName)).expires - start, 40100)
})

test('null resolving', async t => {
  const start = Date.now()
  const cache = createCacheLRU()
  t.same(
    await resolveProtocol(dummyCtx, async function test () {
      return { key: null, ttl: 1 }
    }, 'hello', { cache }),
    null
  )
  tRange(t, 30000, (await cache.get('test', 'hello')).expires - start, 30100)
})

test('maintaining minTTL', async t => {
  const start = Date.now()
  const cache = createCacheLRU()
  t.same(
    await resolveProtocol(dummyCtx, async function test () {
      return { key: null, ttl: 1 }
    }, 'hello', { minTTL: 100, cache }),
    null
  )
  tRange(t, 100000, (await cache.get('test', 'hello')).expires - start, 100100)
})

test('maintaining maxTTL', async t => {
  const start = Date.now()
  const cache = createCacheLRU()
  t.same(
    await resolveProtocol(dummyCtx, async function test () {
      return { key: null, ttl: 200 }
    }, 'hello', { maxTTL: 100, cache }),
    null
  )
  tRange(t, 100000, (await cache.get('test', 'hello')).expires - start, 100100)
})

test('resolving protocol by name', async t => {
  t.plan(1)
  const testName = 'Foox'
  await resolveProtocol(dummyCtx, 'myProtocol', testName, {
    protocols: [
      function myProtocol (_context, name) {
        t.equals(name, testName)
      }
    ]
  })
})

test('unsupported protocol rejects', async t => {
  await rejects(t, resolveProtocol(dummyCtx, 'foo', 'bar', {
    protocols: []
  }), TypeError)
})

test('storing resolved entry in cache', async t => {
  let cached = 0
  const start = Date.now()
  await resolveProtocol(dummyCtx, function testProtocol () {
    return {
      key: 'bar',
      ttl: 1
    }
  }, 'foo', {
    cache: {
      async get () {},
      async set (protocol, name, entry) {
        cached += 1
        t.equals(protocol, 'testProtocol')
        t.equals(name, 'foo')
        t.equals(entry.key, 'bar')
        tRange(t, 30000, entry.expires - start, 30100)
      }
    }
  })
  t.equals(cached, 1)
})

test('retreiving entry from cache', async t => {
  const result = {
    key: 'bar',
    expires: Date.now() + 1000
  }
  t.equals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol (_, name) {
        // Lookup for the test key to make sure its a valid key
        // provided by the cache
        t.equals(name, 'bar')
        return result
      },
      'foo',
      {
        cache: {
          async get (protocol, name) {
            t.equals(protocol, 'testProtocol')
            t.equals(name, 'foo')
            return result
          }
        }
      }
    ),
    result.key
  )
})

test('retreiving miss from cache', async t => {
  const result = {
    key: null,
    expires: Date.now() + 1000
  }
  t.equals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        throw new Error('shouldnt use resolve!')
      },
      'foo',
      {
        cache: {
          async get (protocol, name) {
            t.equals(protocol, 'testProtocol')
            t.equals(name, 'foo')
            return result
          }
        }
      }
    ),
    result.key
  )
})

test('ignoring expired cache entry', async t => {
  const cached = {
    key: 'cached',
    expires: Date.now() - 1
  }
  const fetched = {
    key: 'fetched',
    ttl: null
  }
  t.deepEquals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        return fetched
      },
      'foo',
      {
        cache: { get: async () => cached }
      }
    ),
    'fetched'
  )
})

test('ignoring cache option', async t => {
  const cached = {
    key: 'cached',
    expires: Date.now() + 1000
  }
  const fetched = {
    key: 'fetched',
    ttl: null
  }
  t.deepEquals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        return fetched
      },
      'foo',
      {
        cache: { get: async () => cached },
        ignoreCache: true
      }
    ),
    'fetched'
  )
})

test('ignoring cache-miss if specified', async t => {
  const cached = {
    key: null,
    expires: Date.now() + 1000
  }
  const fetched = {
    key: 'fetched',
    ttl: null
  }
  t.deepEquals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        return fetched
      },
      'foo',
      {
        cache: { get: async () => cached },
        ignoreCachedMiss: true
      }
    ),
    'fetched'
  )
})

test('Falling back to cached entry (even expired) when resolve resulted in error', async t => {
  const cached = {
    key: 'cached',
    expires: Date.now() - 1
  }
  t.equals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol (_, name) {
        if (name === 'cached') {
          return cached
        }
        throw new Error('test error')
      },
      'foo',
      {
        cache: { get: async () => cached }
      }
    ),
    cached.key
  )
})

test('Falling back to cached entry (even ignored!) when resolve resulted in error', async t => {
  const cached = {
    key: 'cached',
    expires: Date.now() - 1
  }
  t.equals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol (_, name) {
        if (name === 'cached') {
          return cached
        }
        throw new Error('test error')
      },
      'foo',
      {
        cache: { get: async () => cached },
        ignoreCache: true
      }
    ),
    cached.key
  )
})

test('Fetching if the cache returned with error', async t => {
  const fetched = {
    key: 'fetched',
    ttl: null
  }
  t.deepEquals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        return fetched
      },
      'foo',
      {
        cache: { get: async () => { throw new Error('cache error') } }
      }
    ),
    'fetched'
  )
})

test('Gracefully handling error from lookup', async t => {
  t.deepEquals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        throw new Error('Some error')
      },
      'foo'
    ),
    null
  )
})

test('gracefully handling error when storing entry in cache', async t => {
  let cached = 0
  await resolveProtocol(dummyCtx, function testProtocol () {
    return {
      key: 'bar',
      ttl: 1
    }
  }, 'foo', {
    cache: {
      async get () {},
      async set () {
        cached += 1
        throw new Error('test error')
      }
    }
  })
  t.equals(cached, 1)
})

test('Gracefully handing error when fetching from the cache after resolved with error (ignoreCache)', async t => {
  t.equals(
    await resolveProtocol(
      dummyCtx,
      function testProtocol () {
        throw new Error('fetch error')
      },
      'foo',
      {
        cache: { get: async () => { throw new Error('cache error') } },
        ignoreCache: true
      }
    ),
    null
  )
})

test('AbortError in lookup is passed through', async t => {
  await rejects(t, resolveProtocol(dummyCtx, function testProtocol () {
    throw new AbortError()
  }, 'hello'), AbortError)
})

test('AbortError in cache.get is passed through', async t => {
  await rejects(t, resolveProtocol(dummyCtx, function testProtocol () {}, null, {
    cache: {
      async get () {
        throw new AbortError()
      }
    }
  }), AbortError)
})

test('AbortError in cache.get after error in fetching is passed through', async t => {
  await rejects(t, resolveProtocol(dummyCtx, function testProtocol () {
    throw new Error('test error')
  }, null, {
    cache: {
      async get () {
        throw new AbortError()
      }
    },
    ignoreCache: true
  }), AbortError)
})

test('TypeError in lookup is passed through', async t => {
  await rejects(t, resolveProtocol(dummyCtx, function testProtocol () {
    throw new TypeError()
  }, 'hello'), TypeError)
})

test('Signal is passed through to context', async t => {
  const testSignal = {}
  t.plan(1)
  await resolveProtocol(
    (_opts, signal) => {
      t.equals(signal, testSignal)
      return {}
    },
    function testProtocol () {},
    'test',
    {
      signal: testSignal
    }
  )
})

test('timeout causes signal', async t => {
  t.plan(2)
  await resolveProtocol(
    (_opts, signal) => {
      t.notEquals(signal, undefined)
      t.notEquals(signal, null)
      return {}
    },
    function testProtocol () {},
    'test',
    {
      timeout: 100
    }
  )
})

test('resolving a bunch of protocols', async t => {
  const start = Date.now()
  const cache = createCacheLRU()
  const result = await resolve(dummyCtx, 'foo', {
    cache,
    protocols: [
      function a () {
        return {
          key: 'abcd',
          ttl: 1
        }
      },
      function b () {
        return {
          key: 'xyz'
        }
      },
      function c () {
        return {
          key: null,
          ttl: 50
        }
      }
    ]
  })
  t.deepEquals(
    result,
    {
      a: 'abcd',
      b: 'xyz',
      c: null
    }
  )
  tRange(t, 30000, (await cache.get('a', 'foo')).expires - start, 30100)
  t.equals((await cache.get('b', 'foo')), undefined)
  tRange(t, 50000, (await cache.get('c', 'foo')).expires - start, 50100)
})

test('gracefully handling resolve problem when resolving many', async t => {
  t.deepEquals(
    await resolve(dummyCtx, 'hello', {
      protocols: [
        function a () {
          throw new Error('test error')
        }
      ]
    }),
    { a: null }
  )
})

test('resolving common urls blob/http/https/ftp/file url', async t => {
  t.equals((await resolveURL(dummyCtx, 'ftp://me:you@datproject.com')).href, 'ftp://me:you@datproject.com/')
  t.equals((await resolveURL(dummyCtx, 'http://datproject.com')).href, 'http://datproject.com/')
  t.equals((await resolveURL(dummyCtx, 'https://datproject.com')).href, 'https://datproject.com/')
  t.equals((await resolveURL(dummyCtx, 'file:here')).href, 'file://here')
  t.equals((await resolveURL(dummyCtx, 'blob:someblob')).href, 'blob:someblob')
})

test('resolving minimal url properties', async t => {
  const href = 'test:abcd'
  const url = await resolveURL(dummyCtx, href)
  compareURL(t, url, {
    protocol: 'test:',
    host: 'abcd',
    hostname: 'abcd',
    pathname: null,
    search: null,
    hash: null,
    username: null,
    password: null,
    port: null,
    version: null,
    slashes: null,
    href,
    versionedHref: href
  })
})

test('supporting non-standard version in common urls', async t => {
  const url = await resolveURL(dummyCtx, 'ftp://me:you@datproject.com+12341a-^')
  t.equals(url.versionedHref, 'ftp://me:you@datproject.com+12341a-^/')
  t.equals(url.version, '12341a-^')
})

test('using fallback protocol if non specified and not resolvable', async t => {
  t.equals((await resolveURL(dummyCtx, 'datproject.com', { protocols: [] })).href, 'https://datproject.com/')
  t.equals((await resolveURL(dummyCtx, 'datproject.com', { protocols: [], fallbackProtocol: 'ftp' })).href, 'ftp://datproject.com/')
})

test('resolving to a known protocol, complete domain name with path', async t => {
  const order = []
  t.equals((await resolveURL(dummyCtx, 'datproject.com/fancy', {
    protocols: [
      function old () {
        order.push('old')
      },
      function cool (_ctx, name) {
        order.push('cool')
        t.equals(name, 'datproject.com')
        return {
          key: 'abcd',
          ttl: null
        }
      },
      function notExpected () {
        order.push('notExpected')
      }
    ]
  })).href, 'cool://abcd/fancy')
  t.deepEquals(order, ['old', 'cool'])
})

test('resolving protocols by preference', async t => {
  const order = []
  t.equals((await resolveURL(dummyCtx, 'datproject.com/fancy', {
    protocolPreference: ['notExpected', 'old'],
    protocols: [
      function old () {
        order.push('old')
      },
      function cool (_ctx, name) {
        order.push('cool')
        t.equals(name, 'datproject.com')
        return {
          key: 'abcd',
          ttl: null
        }
      },
      function notExpected () {
        order.push('notExpected')
      }
    ]
  })).href, 'cool://abcd/fancy')
  t.deepEquals(order, ['notExpected', 'old', 'cool'])
})

test('preferring unsupported protocol should throw an error and not process previous protocols', async t => {
  await rejects(t, resolveURL(dummyCtx, 'datproject.com/fancy', {
    protocolPreference: ['dontcall', 'notsupported'],
    protocols: [
      function dontcall () {
        t.fail('should not try protocol if an unsupported is in the preference')
      }
    ]
  }), TypeError)
})

test('reject path only urls in resolveURL', async t => {
  await rejects(t, resolveURL(dummyCtx, '/datproject', { protocols: [] }), TypeError)
})

test('resolving known protocol', async t => {
  t.equals((await resolveURL(dummyCtx, 'cool:datproject', {
    protocols: [
      function cool (_ctx, name) {
        t.equals(name, 'datproject')
        return {
          key: 'abcd',
          ttl: null
        }
      }
    ]
  })).href, 'cool:abcd')
})

test('resolving known protocol', async t => {
  t.equals((await resolveURL(dummyCtx, 'cool:datproject', {
    protocols: [
      function cool (_ctx, name) {
        t.equals(name, 'datproject')
        return {
          key: 'abcd',
          ttl: null
        }
      }
    ]
  })).href, 'cool:abcd')
})

test('port of url should be passed to context', async t => {
  t.plan(1)
  await resolveURL(
    opts => {
      t.equals(opts.localPort, '3141')
      return {}
    },
    'cool://datproject:3141',
    {
      protocols: [function cool () {
        return { key: 'abcd' } // To not cause an error
      }]
    }
  )
})

test('resolveURL for known protocol without result causes error', async t => {
  await rejects(t, resolveURL(dummyCtx, 'cool:datproject', {
    protocols: [
      function cool () {
        return undefined
      }
    ]
  }), RecordNotFoundError)
})

test('resolve urls', async t => {
  const url = await resolveURL(dummyCtx, 'foo://me:you@bar.foo.com+ab19:4324/me/and/you?q=hi#hash', {
    protocols: [
      function foo () {
        return {
          key: 'b2',
          ttl: null
        }
      }
    ]
  })
  const prefix = 'foo://me:you@b2'
  const postfix = ':4324/me/and/you?q=hi#hash'
  const href = `${prefix}${postfix}`
  compareURL(t, url, {
    protocol: 'foo:',
    host: 'b2:4324',
    hostname: 'b2',
    slashes: '//',
    username: 'me',
    password: 'you',
    port: '4324',
    version: 'ab19',
    pathname: '/me/and/you',
    search: '?q=hi',
    hash: '#hash',
    href: href,
    versionedHref: `${prefix}+ab19${postfix}`
  })
  t.same(url.toString(), href)
  t.same(url.toJSON(), href)
})
