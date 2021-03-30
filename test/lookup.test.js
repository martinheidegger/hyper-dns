// For local https server
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const { test } = require('tape')
const { HyperLookup, ArgumentError, RecordNotFoundError, NotFQDNError } = require('../lookup.js')
const { server, rejects, TEST_KEY, TEST_KEYS } = require('./helpers.js')

test('instantiation', t => {
  const service = new HyperLookup()
  t.ok(service.opts.dohLookups.includes(service.opts.dohLookup))
  t.end()
})

test('wrong arguments', t => {
  t.throws(() => new HyperLookup({ keyRegex: 'abcd' }), ArgumentError)
  t.throws(() => new HyperLookup({ txtRegex: 'abcd' }), ArgumentError)
  t.end()
})

test('support for keys', async t => {
  const key = '14bc77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e'
  const service = new HyperLookup()
  t.equals(await service.resolveName(key), key)
  t.equals(await service.resolveName(`hyper:${key}`), key)
  t.equals(await service.resolveName(`hyper://${key}`), key)
  t.end()
})

test('support for custom keys', async t => {
  const service = new HyperLookup({
    keyRegex: /^(?:dat:\/\/)?([a-z]{6})$/
  })
  const key = 'abcdef'
  t.equals(await service.resolveName(key), key)
  t.equals(await service.resolveName(`dat://${key}`), key)
  t.end()
})

test('invalid domain', async t => {
  const service = new HyperLookup()
  await rejects(t, service.resolveName('hello'), NotFQDNError)
  t.end()
})

test('resolve a dns entry using doh', async t => {
  const domain = 'hello.com'
  const service = await server.init({
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
  t.equals(await service.resolveName(domain), TEST_KEY)
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

test('full url as name', async t => {
  const dns = await server.init({
    dns: {
      txtRegex: /^\s*"?(?:hyperkey|datkey)=(.*)"?\s*$/i
    },
    json: req => {
      const { domain } = /^\/query\?name=(?<domain>.*)\.&type=TXT$/.exec(req.url).groups
      return {
        Answer: [
          { data: `datkey=${domain}`, TTL: 1 }
        ]
      }
    }
  })
  t.equals(await dns.resolveName('https://me:you@some.sub.test.com+1:442234/fancy?pants#hello'), 'some.sub.test.com')
}).teardown(server.reset)

test('resolve urls', async t => {
  const keys = {
    'foo.com': 'a1',
    'bar.foo.com': 'b2'
  }
  const dns = await server.init({
    dns: {
      txtRegex: /^\s*"?(?:hyperkey|datkey)=(.*)"?\s*$/i
    },
    json: req => {
      const { domain } = /^\/query\?name=(?<domain>.*)\.&type=TXT$/.exec(req.url).groups
      return {
        Answer: [
          { data: `datkey=${keys[domain]}`, TTL: 1 }
        ]
      }
    }
  })
  t.same((await dns.resolveURL('hyper://foo.com')).toString(), 'hyper://a1')
  t.same((await dns.resolveURL('foo.com+a1234')).toString(), 'hyper://a1+a1234')
  t.same((await dns.resolveURL('https://me@foo.com+a1234:1234')).toString(), 'https://me@foo.com+a1234:1234/')
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

test('invalid http status from doh server', async t => {
  const dns = await server.init({
    handler: (_req, res) => {
      res.writeHead(400)
      res.end('not found')
    }
  })
  await rejects(t, dns.resolveName('test.com'), RecordNotFoundError)
}).teardown(server.reset)
