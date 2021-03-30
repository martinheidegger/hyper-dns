const debug = require('debug')('hyper-dns')
const QuickLRU = require('quick-lru')
const { bubbleAbort, wrapTimeout } = require('@consento/promise')
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
    this.cache = new QuickLRU({
      maxSize: this.opts.maxSize
    })
    this.processes = {}
  }

  async clearName (name, opts = {}) {
    return wrapTimeout(async signal => {
      debug('deleting cache entry', name)
      await this.opts.persistentCache.clearName(name, { signal })
      this.cache.delete(name)
    }, opts)
  }

  async clear (opts = {}) {
    return wrapTimeout(async signal => {
      debug('clearing cache')
      await this.opts.persistentCache.clear({ signal })
      this.cache.clear()
    }, opts)
  }

  async flush (opts = {}) {
    return wrapTimeout(async signal => {
      debug('flushing cache')
      await this.opts.persistentCache.flush({ signal })
      const now = Date.now()
      for (const { name, expires } of this.cache.values()) {
        if (expires < now) {
          this.cache.delete(name)
        }
      }
    }, opts)
  }

  async lookup (name, opts = {}) {
    const { persistentCache } = this.opts
    const { ignoreCache, ignoreCachedMiss } = opts
    if (!ignoreCache && name in this.processes) {
      debug('reusing ongoing process to fetch', name)
      return await this.processes[name]
    }

    const process = wrapTimeout(async signal => {
      if (!ignoreCache) {
        let cacheEntry = this.cache.get(name)
        if (cacheEntry === undefined) {
          try {
            debug('restoring from persistent cache', name)
            cacheEntry = await persistentCache.read(name, { signal })
            this.cache.set(name, cacheEntry)
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

      const newEntry = await super.lookup(name, { signal })
      try {
        await persistentCache.write(newEntry, { signal })
      } catch (err) {
        debug('persisting cache failed:', err)
      }
      this.cache.set(name, newEntry)
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
