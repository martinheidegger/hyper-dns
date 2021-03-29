const { HyperDNS } = require('.')
const { test } = require('tape')

test('successfully resolving test domain: dns-test-setup.dat-ecosystem.org', async t => {
  const dns = new HyperDNS()
  t.equals(await dns.resolveName('dns-test-setup.dat-ecosystem.org'), '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444')
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
