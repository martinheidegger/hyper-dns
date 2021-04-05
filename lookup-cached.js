const loadQuickLRU = import('quick-lru')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const { wrapTimeout } = require('@consento/promise/wrapTimeout')
const lookup = require('./lookup.js')
const { HyperLookup, DEFAULTS, ArgumentError } = lookup

const CACHED_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  maxSize: 1000,
  persistentCache: Object.freeze({
    async clear (_opts) {},
    async clearName (_name, _opts) {},
    async read (_name, _opts) {},
    async write (_cacheEntry, _opts) {},
    async flush (_opts) {},
    async close (_opts) {}
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
    this.closed = false
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
    const { persistentCache, debug, maxTTL, keyRegex } = this.opts
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
          let persisted
          try {
            debug('restoring "%s" from persistent cache', name)
            persisted = await persistentCache.read(name, { signal })
            cache.set(name, cacheEntry)
          } catch (err) {
            debug('error while restoring "%s": %s', name, err)
          }
          const type = typeof persisted
          if (type !== 'object' && persisted !== undefined) {
            debug('persisted entry for "%s" contained unexpected type %s', name, type)
          } else if (persisted !== undefined && persisted !== null) {
            const max = Date.now() + maxTTL
            let expires = max
            if (typeof persisted.expires !== 'number' || isNaN(persisted.expires)) {
              debug('persited entry for "%s" contained an invalid expiration date %s, using maxTTL', name, persisted.expires)
            } else if (persisted.expires > max) {
              debug('persisted entry for "%s" contained an expiration date too far in the future %s, using maxTTL', name, persisted.expires)
            } else {
              expires = persisted.expires
            }
            let key
            if (persisted.key !== null && typeof persisted.key !== 'string') {
              debug('persisted entry for "%s" contained invalid key %s', name, persisted.key)
            } else {
              if (persisted.key === null) {
                key = null
              } else {
                const match = keyRegex.exec(persisted.key)
                if (!match) {
                  debug('persisted entry for "%s", "%s" didnt match .keyRegex pattern %s', name, persisted.key, keyRegex)
                } else {
                  if (!match.groups || !match.groups.key) {
                    throw new ArgumentError(`provided opts.keyRegex doesn't provide a "key" group response like /(?<key>[0-9a-f]{64})/: ${keyRegex}`)
                  } else {
                    key = match.groups.key
                  }
                }
              }
            }
            if (key !== undefined) {
              cacheEntry = { name, key, expires }
              cache.set(name, cacheEntry)
            }
          }
        }
        if (cacheEntry !== undefined) {
          const now = Date.now()
          if (cacheEntry.expires < now) {
            debug('cache for "%s" expired: %s < %s', name, cacheEntry.expires, now)
          } else if (cacheEntry.key !== null) {
            debug('cache resolved "%s" to %s', name, cacheEntry.key)
            return cacheEntry
          } else if (!ignoreCachedMiss) {
            debug('cache resolved "%s" as miss', name)
            return cacheEntry
          } else {
            debug('ignoring cache miss for "%s', name)
          }
        } else {
          debug('no cache entry for "%s" found', name)
        }
      }

      bubbleAbort(signal)

      const newEntry = await super.lookup(name, { ...opts, signal })
      try {
        await persistentCache.write(newEntry, { signal })
      } catch (err) {
        debug('persisting cache for "%s% failed (sync): %s', name, err)
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

  async close (opts = {}) {
    const { debug, persistentCache } = this.opts
    if (this.closed) {
      debug('.close called even thought its been closed before')
      return
    }
    this.closed = true
    if (persistentCache) {
      debug('closing persistent cache')
      await persistentCache.close(opts)
    }
  }
}

Object.freeze(HyperCachedLookup)
Object.freeze(HyperCachedLookup.prototype)

module.exports = Object.freeze({
  ...lookup,
  HyperCachedLookup,
  CACHED_DEFAULTS
})
