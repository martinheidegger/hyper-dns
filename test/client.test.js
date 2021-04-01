const { resolveName, lookup, resolveURL, clearName, clear, flush, HyperLookup, DEFAULTS } = require('..')
const { test } = require('tape')

const TEST_DOMAIN = 'dns-test-setup.dat-ecosystem.org'
const TEST_KEY = '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444'
const TEST_TTL = 300 // The d-o-h lookups may vary!
const TEST_SEARCH = '?hi=true'
const TEST_PATH = '/some/folder'
const TEST_HASH = '#dash'
const TEST_USER = 'usr'
const TEST_PWD = 'pwd'
const TEST_URL = `hyper://${TEST_USER}:${TEST_PWD}@${TEST_DOMAIN}${TEST_PATH}${TEST_SEARCH}${TEST_HASH}`

test(`resolving test domain: ${TEST_DOMAIN}`, async t => {
  t.equals(await resolveName(TEST_DOMAIN), TEST_KEY)
})

test(`looking up test domain: ${TEST_DOMAIN}`, async t => {
  const start = Date.now()
  const result = await lookup(TEST_DOMAIN)
  t.equals(result.name, TEST_DOMAIN)
  t.equals(result.key, TEST_KEY)
  t.ok(result.expires > start)
  t.ok(result.expires <= Math.round(Date.now() + TEST_TTL * 1000))
})

test(`resolving test url: ${TEST_URL}`, async t => {
  const url = await resolveURL(TEST_URL)
  const href = `hyper://${TEST_USER}:${TEST_PWD}@${TEST_KEY}${TEST_PATH}${TEST_SEARCH}${TEST_HASH}`
  t.equals(url.href, href)
  t.equals(url.protocol, 'hyper:')
  t.equals(url.hostname, TEST_KEY)
  t.equals(url.pathname, TEST_PATH)
  t.equals(url.search, TEST_SEARCH)
  t.equals(url.hash, TEST_HASH)
  t.equals(url.username, TEST_USER)
  t.equals(url.password, TEST_PWD)
  t.equals(url.toString(), href)
  t.equals(url.toJSON(), href)
})

test('verifying basic clear operations', async () => {
  await clearName(TEST_PATH)
  await clear()
  await flush()
})

const ecosystem = 'dns-test-setup.dat-ecosystem.org'
test(`Successful test against ${ecosystem}`, async t => {
  const dnsKey = '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444'
  const wkKey = '111231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde111'
  t.equals(await resolveName(ecosystem, { ignoreCache: true }), dnsKey, 'regular lookup')
  t.equals(await resolveName(ecosystem, { ignoreCache: true, noDnsOverHttps: true }), wkKey, 'well-known lookup')
  for (const dohLookup of DEFAULTS.dohLookups) {
    t.equals(await (new HyperLookup({ dohLookup })).resolveName(ecosystem, { noWellknownDat: true }), dnsKey, `doh-provider ${dohLookup}`)
  }
})
