const QuickLRU = require('quick-lru')

function createCacheLRU (opts) {
  opts = {
    ...createCacheLRU.DEFAULTS,
    ...opts
  }
  const cache = new QuickLRU({ maxSize: opts.maxSize })
  return Object.freeze({
    async clear () {
      cache.clear()
    },
    async clearName (name) {
      for (const key of cache.keys()) {
        const keyName = /^[^:]+:(.*)$/.exec(key)[1]
        if (keyName === name) {
          cache.delete(key)
        }
      }
    },
    async close () {},
    async flush () {
      const now = Date.now()
      for (const [key, { expires }] of cache) {
        if (expires < now) {
          cache.delete(key)
        }
      }
    },
    async get (protocol, name) {
      return cache.get(`${protocol}:${name}`)
    },
    async set (protocol, name, entry) {
      cache.set(`${protocol}:${name}`, entry)
    }
  })
}
createCacheLRU.DEFAULTS = Object.freeze({
  maxSize: 1000
})
module.exports = Object.freeze(createCacheLRU)
