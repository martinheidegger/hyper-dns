require('./common.test.js')
const { test } = require('tape')
const pkg = require('..')

test('SQLite is not available on browsers', async t => {
  t.throws(() => pkg.createCacheSqlite())
})
