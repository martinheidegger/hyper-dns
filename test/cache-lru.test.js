const { test } = require('tape')
const createCacheLRU = require('../cache-lru.js')

test('basic read/write', async t => {
  // Note: QuickLRU keeps double the size in memory, evicting
  const cache = createCacheLRU({ maxSize: 2 })
  const expires = Date.now()
  await cache.set('a', 'x', { key: '1', expires })
  t.deepEquals(await cache.get('a', 'x'), { key: '1', expires }, 'making sure that set/get works')
  await cache.set('a', 'y', { key: '2', expires })
  await cache.set('a', 'z', { key: '3', expires })
  t.notEquals(await cache.get('a', 'x'), undefined, 'a:x still exists, even though 2 more have been added, it is also bumped to the top, making a:y the oldest')
  await cache.set('a', 'v', { key: '4', expires })
  t.equals(await cache.get('a', 'y'), undefined, 'a:y is gone after an addition write')
})

test('clearing all entries', async t => {
  const cache = createCacheLRU()
  await cache.set('a', 'x', { key: '1', expires: 0 })
  await cache.set('b', 'y', { key: '2', expires: Date.now() + 1000 })
  await cache.clear()
  t.equals(await cache.get('a', 'x'), undefined)
  t.equals(await cache.get('b', 'y'), undefined)
})

test('flushing old entries', async t => {
  const cache = createCacheLRU()
  const expires = Date.now() + 1000
  await cache.set('a', 'x', { key: '1', expires: 0 })
  await cache.set('b', 'y', { key: '2', expires })
  await cache.flush()
  t.equals(await cache.get('a', 'x'), undefined)
  t.deepEquals(await cache.get('b', 'y'), { key: '2', expires })
})

test('clearing entries with same name', async t => {
  const cache = createCacheLRU()
  await cache.set('a', 'x', { key: '1', expires: 0 })
  await cache.set('b', 'x', { key: '2', expires: 1 })
  await cache.set('a', 'y', { key: '3', expires: 2 })
  await cache.set('b', 'y', { key: '4', expires: 4 })
  await cache.clearName('x')
  t.equals(await cache.get('a', 'x'), undefined)
  t.equals(await cache.get('b', 'x'), undefined)
  t.deepEquals(await cache.get('a', 'y'), { key: '3', expires: 2 })
  t.deepEquals(await cache.get('b', 'y'), { key: '4', expires: 4 })
})
