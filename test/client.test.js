const { resolveName, lookup, resolveURL, clearName, clear, flush } = require('..')
const { test } = require('tape')

const TEST_DOMAIN = 'dns-test-setup.dat-ecosystem.org'
const TEST_KEY = '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444'
const TEST_TTL = 300 // The d-o-h lookups may vary!
const TEST_SEARCH = '?hi=true'
const TEST_PATH = '/some/folder'
const TEST_HASH = '#dash'
const TEST_URL = `hyper://${TEST_DOMAIN}${TEST_PATH}${TEST_SEARCH}${TEST_HASH}`

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
  t.equals(url.protocol, 'hyper:')
  t.equals(url.hostname, TEST_KEY)
  t.equals(url.pathname, TEST_PATH)
  t.equals(url.search, TEST_SEARCH)
  t.equals(url.hash, TEST_HASH)
})

test(`verifying basic clear operations`, async () => {
  await clearName(TEST_PATH)
  await clear()
  await flush()
})

/*
test('Successful test against cblgh.org', async t => {
  const dns = new HyperDNS({
    keyRegex: /^\s*(?:cabal:)?(?:\/\/)?([0-9a-f]{64})\s*$/i,
    txtRegex: /^\s*"?(?:cabalkey)=([0-9a-f]{64})"?\s*$/i,
    protocol: 'cabal'
  })
  await dns.resolveName('cblgh.org')
})
*/
