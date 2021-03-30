// For local https server
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const { test } = require('tape')
const { HyperDNS, ArgumentError, RecordNotFoundError, NotFQDNError, resolveName, resolveURL } = require('.')
const https = require('https')
const pem = require('pem')

test('instantiation', t => {
  const dns = new HyperDNS()
  t.ok(dns.opts.dohLookups.includes(dns.opts.dohLookup))
  t.end()
})

test('wrong arguments', t => {
  t.throws(() => new HyperDNS({ keyRegex: 'abcd' }), ArgumentError)
  t.throws(() => new HyperDNS({ txtRegex: 'abcd' }), ArgumentError)
  t.end()
})

test('support for keys', async t => {
  const key = '14bc77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e'
  t.equals(await resolveName(key), key)
  t.equals(await resolveName(`hyper:${key}`), key)
  t.equals(await resolveName(`hyper://${key}`), key)
  t.end()
})

test('support for custom keys', async t => {
  const dns = new HyperDNS({
    keyRegex: /^(?:dat:\/\/)?([a-z]{6})$/
  })
  const key = 'abcdef'
  t.equals(await dns.resolveName(key), key)
  t.equals(await dns.resolveName(`dat://${key}`), key)
  t.end()
})

test('invalid domain', async t => {
  await rejects(t, resolveName('hello'), NotFQDNError)
  t.end()
})

const TEST_KEYS = [
  '100c77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e',
  '200c77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e',
  '300c77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e'
]
const TEST_KEY = TEST_KEYS[0]
const server = createHttpsServer()

test('resolve a dns entry using doh', async t => {
  const domain = 'hello.com'
  const dns = await server.init({
    json: req => {
      t.equals(req.url, `/query?name=${domain}.&type=TXT`)
      t.equals(req.headers['user-agent'], 'hyper-dns/1.0.0 (+https://github.com/martinheidegger/hyper-dns)')
      t.equals(req.headers.accept, 'application/dns-json')
      return {
        Answer: [
          { data: `datkey=${TEST_KEY}` }
        ]
      }
    }
  })
  t.equals(await dns.resolveName(domain), TEST_KEY)
}).teardown(server.reset)

test('using the largest of multiple keys using doh', async t => {
  const domain = 'hello.com'
  const dns = await server.init({
    keys: [
      TEST_KEYS[2],
      TEST_KEYS[0],
      TEST_KEYS[1]
    ]
  })
  t.equals(await dns.resolveName(domain), `${TEST_KEYS[2]}`)
}).teardown(server.reset)

test('ignoring unusable answers', async t => {
  const domain = 'hello.com'
  const dns = await server.init({
    json: () => ({
      Answer: [
        null,
        'hello',
        {},
        { data: 'something else ' },
        { data: `datkey=${TEST_KEY}` },
        { data: `datkey=${TEST_KEY}` }
      ]
    })
  })
  t.equals(await dns.resolveName(domain), TEST_KEY)
}).teardown(server.reset)

test('using the ttl set to the dns record', async t => {
  const domain = 'foo.com'
  let count = 0
  const dns = await server.init({
    json: () => {
      count++
      return {
        Answer: [
          { data: `datkey=${TEST_KEY}`, TTL: 1 }
        ]
      }
    }
  })
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 1)
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 1)
  await new Promise(resolve => setTimeout(resolve, 1200))
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 2)
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 2)
}).teardown(server.reset)

test('the maxTTL will override the ttl of the server', async t => {
  const domain = 'foo.com'
  let count = 0
  const dns = await server.init({
    dns: {
      maxTTL: 1
    },
    json: () => {
      count++
      return {
        Answer: [
          { data: `datkey=${TEST_KEY}`, TTL: 100 }
        ]
      }
    }
  })
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 1)
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 1)
  await new Promise(resolve => setTimeout(resolve, 1200))
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 2)
  t.equals(await dns.resolveName(domain), TEST_KEY)
  t.equals(count, 2)
}).teardown(server.reset)

// TODO: Test the removing of an entry from the cache
// TODO: Test the clearing of the whole cache
// TODO: Test the flushing of old entries from a cache
// TODO: Test the propagation of the abort signal
// TODO: Support well-known lookup
// TODO: Support IPNS lookup
// TODO: Test typescript definitions
// TODO: Add File System storage
// TODO: Add CLI
// TODO: Add Documentation

test('no txt answer from doh server', async t => {
  const domain = 'hello.com'
  const dns = await server.init({
    json: () => ({
      Answer: [{}]
    })
  })
  await rejects(t, dns.resolveName(domain), RecordNotFoundError)
}).teardown(server.reset)

test('non-json response from doh server', async t => {
  const dns = await server.init({
    handler: (_req, res) => res.end('not json')
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)

test('no answers from doh server', async t => {
  const dns = await server.init({
    json: () => ({})
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)

test('no answer from doh server', async t => {
  const dns = await server.init({
    json: () => ({})
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)

test('non-object answer from doh server', async t => {
  const dns = await server.init({
    handler: (_req, res) => res.end('1')
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)

test('parallel requests reuse promises', async t => {
  const dns = await server.init({
    key: TEST_KEY
  })
  const domain = 'test.com'
  const p = dns.resolveName(domain)
  const p2 = dns.resolveName(domain)
  t.same(p, p2)
  t.deepEquals(dns.processes, { [domain]: p })
  t.deepEquals(await Promise.all([p, p2]), [TEST_KEY, TEST_KEY])
  t.deepEquals(dns.processes, {})
}).teardown(server.reset)

test('restoring data from persistent storage', async t => {
  let count = 0
  const dns = await server.init({
    dns: {
      persistentCache: {
        async read (name) {
          count++
          return {
            name,
            key: 'abcd',
            expires: Date.now() + 1000
          }
        }
      }
    }
  })
  const domain = 'test.com'
  t.equals(await dns.resolveName(domain), 'abcd')
  t.equals(await dns.resolveName(domain), 'abcd')
  t.equals(count, 1, 'after initial resolve, the local cache is used')
}).teardown(server.reset)

test('restoring miss from persistent storage', async t => {
  const dns = await server.init({
    dns: {
      persistentCache: {
        read: async (name) => ({
          name,
          key: null,
          expires: Date.now() + 1000
        })
      }
    }
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)

test('full url as name', async t => {
  const dns = await server.init({
    dns: {
      persistentCache: {
        read: async (name) => ({
          name,
          key: name,
          expires: Date.now() + 1000
        })
      }
    }
  })
  t.equals(await dns.resolveName('https://me:you@some.sub.test.com+1:442234/fancy?pants#hello'), 'some.sub.test.com')
}).teardown(server.reset)

test('expiration of dns entries', async t => {

})

test('resolve urls', async t => {
  const keys = {
    'foo.com': 'a1',
    'bar.foo.com': 'b2'
  }
  const dns = await server.init({
    dns: {
      persistentCache: {
        read: async (name) => ({
          name,
          key: keys[name],
          expires: Date.now() + 1000
        })
      }
    }
  })
  t.same((await dns.resolveURL('hyper://foo.com')).toString(), 'hyper://a1')
  t.same((await dns.resolveURL('foo.com+a1234')).toString(), 'hyper://a1+a1234')
  t.same((await resolveURL('https://me@foo.com+a1234:1234')).toString(), 'https://me@foo.com+a1234:1234/')
  const complex = await dns.resolveURL('hyper://me:you@bar.foo.com+ab19:4324/me/and/you?q=hi#hash')
  t.same(complex.domain, undefined, 'hyper urls have no domain')
  t.same(complex.username, 'me')
  t.same(complex.password, 'you')
  t.same(complex.port, '4324')
  t.same(complex.hostname, 'b2')
  t.same(complex.version, 'ab19')
  t.same(complex.pathname, '/me/and/you')
  t.same(complex.search, '?q=hi')
  t.same(complex.hash, '#hash')
  t.same(complex.toString(), 'hyper://me:you@b2+ab19:4324/me/and/you?q=hi#hash')
}).teardown(server.reset)

test('restoring old entry from persistent storage', async t => {
  const domain = 'test.com'
  const dns = await server.init({
    key: [TEST_KEY],
    dns: {
      persistentCache: {
        read: async (name) => ({
          name,
          key: TEST_KEYS[1],
          expires: Date.now() - 1
        }),
        write: async () => {}
      }
    }
  })
  t.equals(await dns.resolveName(domain), TEST_KEY)
}).teardown(server.reset)

test('error restoring entry from persistent storage', async t => {
  const domain = 'test.com'
  const dns = await server.init({
    key: TEST_KEY,
    dns: {
      persistentCache: {
        read: async () => {
          throw new Error('silly error')
        },
        write: async () => {}
      }
    }
  })
  t.equals(await dns.resolveName(domain), TEST_KEY)
}).teardown(server.reset)

test('ignoring restoring miss from persistent storage', async t => {
  const dns = await server.init({
    key: TEST_KEY,
    dns: {
      persistentCache: {
        read: async (name) => ({
          name,
          key: null,
          expires: Date.now() + 1000
        })
      }
    }
  })
  t.equals(await dns.resolveName('test.com', { ignoreCachedMiss: true }), TEST_KEY)
}).teardown(server.reset)

test('ignoring cached entry', async t => {
  const dns = await server.init({
    key: TEST_KEY,
    dns: {
      persistentCache: {
        read: async (name) => ({
          name,
          key: TEST_KEYS[1],
          expires: Date.now() + 1000
        })
      }
    }
  })
  t.equals(await dns.resolveName('test.com', { ignoreCache: true }), TEST_KEY)
}).teardown(server.reset)

test('invalid http statusfrom doh server', async t => {
  const dns = await server.init({
    handler: (_req, res) => {
      res.writeHead(400)
      res.end('not found')
    }
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)

test('closing test server', async t => {
  await server.close()
})

function createHttpsServer () {
  const DEFAULT_HANDLER = (_req, res) => res.end('err')
  const serverP = new Promise((resolve, reject) => {
    pem.createCertificate(
      (err, { serviceKey: key, certificate: cert } = {}) => {
        if (err) {
          return reject(err)
        }
        const handler = (req, res) => serverP.handler(req, res)
        const server = https.createServer({ key, cert }, handler)
        const onlisten = () => {
          server.off('error', onerr)
          resolve(server)
        }
        const onerr = err => {
          server.off('listening', onlisten)
          reject(err)
        }
        server.once('listening', onlisten)
        server.once('error', onerr)
        server.listen()
      })
  })
  serverP.handler = DEFAULT_HANDLER
  serverP.init = async (opts = {}) => {
    if (opts.key) {
      opts.keys = [opts.key]
    }
    if (opts.keys) {
      opts.json = () => ({
        Answer: opts.keys.map(key => ({ data: `datkey=${key}` }))
      })
    }
    if (opts.json) {
      serverP.handler = (req, res) => res.end(JSON.stringify(opts.json(req, res)))
    }
    if (opts.handler) {
      serverP.handler = (req, res) => opts.handler(req, res)
    }
    const { port } = (await server).address()
    return new HyperDNS({
      dohLookup: `https://localhost:${port}/query`,
      ...(opts.dns || {})
    })
  }
  serverP.reset = () => {
    serverP.handler = DEFAULT_HANDLER
  }
  serverP.close = () => serverP.then(server => new Promise((resolve, reject) => {
    if (!server.listening) {
      return resolve()
    }
    const onclose = () => {
      server.off('error', onerr)
      resolve()
    }
    const onerr = err => {
      server.off('close', onclose)
      reject(err)
    }
    server.once('close', onclose)
    server.once('error', onerr)
    server.close()
  }))
  return serverP
}

async function rejects (t, p, err) {
  try {
    await p
    t.fail('not rejected')
  } catch (e) {
    if (typeof err === 'string') {
      if (e.message !== err) {
        t.fail(`rejection.message doesnt match: ${e.message} != ${err}`)
      }
    } else if (typeof err === 'function') {
      if (!(e instanceof err)) {
        t.fail(`rejection is not instance of ${err}`)
      }
    } else if (err !== null && err !== undefined) {
      if (err !== e) {
        t.fail(`rejection doesnt match: ${e} !== ${err}`)
      }
    }
    t.pass('should reject')
  }
}
