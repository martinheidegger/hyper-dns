
require('./cache-lru.test.js')
require('./protocols.test.js')
require('./resolve-context.test.js')
require('./resolve.test.js')

const { test } = require('tape')
const pkg = require('..')
test('API objects', t => {
  t.deepEquals(
    Object.keys(pkg).sort(),
    [
      'LightURL',
      'RecordNotFoundError',
      'cache',
      'createCacheLRU',
      'createCacheSqlite',
      'createResolveContext',
      'protocols',
      'resolve',
      'resolveProtocol',
      'resolveURL'
    ],
    'All API objects exists'
  )
  t.equals(typeof pkg.cache, 'object')
  t.end()
})
