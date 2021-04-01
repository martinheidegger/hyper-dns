const loadQuickLRU = import('quick-lru')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const { wrapTimeout } = require('@consento/promise/wrapTimeout')
const lookup = require('./lookup.js')
const { HyperLookup, DEFAULTS } = lookup

const CACHED_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  maxSize: 1000,
  persistentCache: Object.freeze({
    async clear (_opts) {},
    async clearName (_name, _opts) {},
    async read (_name, _opts) {},
    async write (_name, _key, _expires, _opts) {},
    async flush (_opts) {}
  })
})

class HyperCachedLookup extends HyperLookup {
  constructor (opts) {
    super({
      ...CACHED_DEFAULTS,
      ...opts
    })
    this.cache = loadQuickLRU.then(({ default: QuickLRU }) => {
      return new QuickLRU({
        maxSize: this.opts.maxSize
      })
    })
    this.processes = {}
  }

  async clearName (name, opts = {}) {
    const { debug, persistentCache } = this.opts
    return wrapTimeout(async signal => {
      debug('deleting cache entry', name)
      await persistentCache.clearName(name, { signal })
      ;(await this.cache).delete(name)
    }, opts)
  }

  async clear (opts = {}) {
    const { debug, persistentCache } = this.opts
    return wrapTimeout(async signal => {
      debug('clearing cache')
      await persistentCache.clear({ signal })
      ;(await this.cache).clear()
    }, opts)
  }

  async flush (opts = {}) {
    const { debug, persistentCache } = this.opts
    return wrapTimeout(async signal => {
      debug('flushing cache')
      await persistentCache.flush({ signal })
      const now = Date.now()
      const cache = await this.cache
      for (const { name, expires } of cache.values()) {
        if (expires < now) {
          cache.delete(name)
        }
      }
    }, opts)
  }

  async lookup (name, opts = {}) {
    const { persistentCache, debug } = this.opts
    const { ignoreCache, ignoreCachedMiss } = opts
    if (!ignoreCache && name in this.processes) {
      debug('reusing ongoing process to fetch', name)
      return await this.processes[name]
    }

    const process = wrapTimeout(async signal => {
      const cache = await this.cache
      if (!ignoreCache) {
        let cacheEntry = cache.get(name)
        if (cacheEntry === undefined) {
          try {
            debug('restoring from persistent cache', name)
            cacheEntry = await persistentCache.read(name, { signal })
            cache.set(name, cacheEntry)
          } catch (err) {
            debug('error while restoring "' + name + '":', err)
          }
        }
        const now = Date.now()
        if (cacheEntry !== undefined) {
          if (cacheEntry.expires < now) {
            debug('cache entry expired:', cacheEntry.expires, '<', now)
          } else if (cacheEntry.key !== null) {
            debug('cache resolved', name, 'to', cacheEntry.key)
            return cacheEntry
          } else if (!ignoreCachedMiss) {
            debug('cache resolved', name, 'as miss')
            return cacheEntry
          } else {
            debug('ignoring cache miss')
          }
        } else {
          debug('not in cache')
        }
      }

      bubbleAbort(signal)

      const newEntry = await super.lookup(name, { ...opts, signal })
      try {
        await persistentCache.write(newEntry, { signal })
      } catch (err) {
        debug('persisting cache failed:', err)
      }
      cache.set(name, newEntry)
      return newEntry
    }, opts).finally(() => {
      if (this.processes[name] === process) {
        delete this.processes[name]
      }
    })
    this.processes[name] = process
    return await process
  }
}

Object.freeze(HyperCachedLookup)
Object.freeze(HyperCachedLookup.prototype)

module.exports = Object.freeze({
  ...lookup,
  HyperCachedLookup,
  CACHED_DEFAULTS
})
