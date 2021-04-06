process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { test } = require('tape')
const Proxy = require('http-mitm-proxy')
const pkg = require('..')

test('fallback to system dns when doh providers fail', async t => {
  t.equals(
    (await pkg.resolveProtocol('dat', 'dns-test-setup.dat-ecosystem.org', {
      dohLookups: [],
      cache: null
    })).key,
    '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444'
  )
})

let proxy
let previousProxy
test('use https proxy server', async t => {
  previousProxy = process.env.HTTPS_PROXY

  proxy = Proxy()
  proxy.onError((_ctx, error) => t.fail(error))
  proxy.onRequest((_ctx, callback) => callback())
  await new Promise(resolve => proxy.listen({ port: 0 }, resolve))
  process.env.HTTPS_PROXY = `http://localhost:${proxy.httpsPort}`
  t.equals(
    (await pkg.resolveProtocol('dat', 'dns-test-setup.dat-ecosystem.org', {
      cache: null
    })).key,
    '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444'
  )
}).teardown(() => {
  if (previousProxy === undefined) {
    delete process.env.HTTPS_PROXY
  } else {
    process.env.HTTPS_PROXY = previousProxy
  }
  proxy.close()
})

require('./common.test.js')
require('./cache-sqlite.test.js')
require('./integration.test.js')
