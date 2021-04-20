const { test } = require('tape')
const { resolveProtocol, resolveURL, resolve } = require('..')

test('Successful test against cblgh.org', async t => {
  t.equals(
    await resolveProtocol('cabal', 'cblgh.org', { corsWarning: null, cache: null }),
    '13c5012eb19decbb72336d66407d19e5bd7d2794c645f36cca480cc02aede220'
  )
})

const ecosystem = 'dns-test-setup.dat-ecosystem.org'
test(`Successful test against ${ecosystem}`, async t => {
  const datKey = '444231b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde444'
  const hyperKey = '000978b5589a5099aa3610a8ee550dcd454c3e33f4cac93b7d41b6b850cde000'
  t.equals(
    (await resolveURL(`dat://${ecosystem}`, { cache: null })).href,
    `dat://${datKey}`
  )
  const results = (await resolve(ecosystem, { corsWarning: null, cache: null }))
  t.deepEquals(
    results,
    {
      ara: null,
      cabal: null,
      dat: datKey,
      hyper: hyperKey
    }
  )
})

test('Successful test against jwerle.pub', async t => {
  t.equals(
    await resolveProtocol('ara', 'jwerle.pub', { corsWarning: null, cache: null }),
    '22dea0fbb722b20ab11469ed61b2409cb0ca774a285914f160071e4e9e3b8ca8'
  )

  t.equals(
    await resolveProtocol('dat', 'jwerle.pub', { corsWarning: null, cache: null }),
    '22dea0fbb722b20ab11469ed61b2409cb0ca774a285914f160071e4e9e3b8ca8'
  )
})
