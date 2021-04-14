process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const { test } = require('tape')
const { mkdtempSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const Database = require('better-sqlite3')
const createCacheSqlite = require('../cache-sqlite.js')
const { tRange } = require('./helpers')

const workdir = mkdtempSync(join(tmpdir(), 'sqlite-test'))

function getAll (file, table, opts = {}) {
  const db = new Database(file)
  const result = db.prepare(`SELECT * from ${table}`).all()
  db.close()
  if (!opts.keepUpdateStamp) {
    for (const entry of result) {
      delete entry.updated
    }
  }
  return result
}

test('simple read/write', async t => {
  const file = join(workdir, 'simple-read-write.db')
  const cache = createCacheSqlite({ file })
  const cache2 = createCacheSqlite({ file })
  const protocol = 'cool'
  const name = 'old'
  const name2 = 'new'
  const start = Date.now()
  t.equals(await cache.get(protocol, name), undefined)
  await cache.set(protocol, name, { key: 'a', expires: 1 })
  t.deepEquals(await cache.get(protocol, name), {
    key: 'a',
    expires: 1
  }, 'should use in-memory cache when available')
  t.deepEquals(await cache2.get(protocol, name), {
    key: 'a',
    expires: 1
  }, 'fetching from storage using a second cache instance')
  await cache.set(protocol, name, { key: 'b', expires: 2 })
  await cache.set(protocol, name2, { key: 'c', expires: 3 })
  await cache2.close()
  await cache.close()
  const all = getAll(file, 'names', { keepUpdateStamp: true })
  for (const entry of all) {
    tRange(t, start, entry.updated, Date.now())
    delete entry.updated
  }
  t.deepEquals(all, [
    { protocol, name, key: 'b', expires: 2 },
    { protocol, name: name2, key: 'c', expires: 3 }
  ], 'using sqlite interface to make sure all entries are written')
})

test('clearing cache', async t => {
  const file = join(workdir, 'simple-clear-cache.db')
  const cache = createCacheSqlite({ file })
  await cache.set('cool', 'old', { key: 'a', expires: 1 })
  await cache.set('cool', 'new', { key: 'b', expires: 2 })
  await cache.clear()
  cache.close()
  t.deepEquals(getAll(file, 'names'), [], 'using sqlite interface to make sure all entries are removed')
})

test('flushing entries', async t => {
  const file = join(workdir, 'simple-flush.db')
  const cache = createCacheSqlite({ file })
  const expires = Date.now() + 1000
  await cache.set('protoa', 'a', { key: 'a', expires: 1 })
  await cache.set('protob', 'b', { key: 'b', expires: 1 })
  await cache.set('protoc', 'c', { key: 'c', expires: 1 })
  await cache.set('cool', 'new', { key: 'd', expires })
  await cache.flush()
  cache.close()
  t.deepEquals(getAll(file, 'names'), [
    { protocol: 'cool', name: 'new', expires, key: 'd' }
  ], 'using sqlite interface to make sure old entries are flushed')
})

test('clearing by name', async t => {
  const file = join(workdir, 'simple-clear-name.db')
  const cache = createCacheSqlite({ file })
  await cache.set('protoa', 'a', { key: 'a', expires: 1 })
  await cache.set('protob', 'a', { key: 'b', expires: 1 })
  await cache.set('protoa', 'b', { key: 'c', expires: 1 })
  await cache.set('protob', 'b', { key: 'd', expires: 1 })
  await cache.clearName('a')
  cache.close()
  t.deepEquals(getAll(file, 'names'), [
    { protocol: 'protoa', name: 'b', expires: 1, key: 'c' },
    { protocol: 'protob', name: 'b', expires: 1, key: 'd' }
  ], 'using sqlite interface to make sure old entries are flushed')
})

test('wal clearing', async () => {
  const file = join(workdir, 'wal-clearing.db')
  const cache = createCacheSqlite({
    file,
    walCheckInterval: 10,
    maxWalSize: 2
  })
  await cache.set('hyper', 'bee', { key: null, expires: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  cache.close()
})

test('gracefully handling not working db', async t => {
  const file = mkdtempSync(join(workdir, 'sqlite-test'))
  const cache = createCacheSqlite({
    file // Should not work, since the file is a directory
  })
  t.equals(await cache.get('hyper', 'bee'), undefined)
  await cache.set('hyper', 'bee', { key: null, expires: Date.now() })
})
