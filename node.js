const debug = require('debug')('hyper-dns')
const cached = require('./lookup-cached.js')
const { SQLiteCache, DEFAULTS: SQLITE_DEFAULTS } = require('./sqlite-cache')
const { resolveURL } = cached

let plain = () => {
  const inst = new cached.HyperCachedLookup({
    debug,
    persistentCache: new SQLiteCache({
      debug
    })
  })
  plain = () => inst
  return inst
}

module.exports = Object.freeze({
  ...cached,
  SQLiteCache,
  SQLITE_DEFAULTS,
  async resolveURL (input, opts = {}) {
    if (!opts.lookup) {
      opts.lookup = plain()
    }
    if (!opts.protocol) {
      opts.protocol = 'hyper'
    }
    return resolveURL(input, opts)
  },
  async resolveName (input, opts) {
    return plain().resolveName(input, opts)
  },
  async lookup (input, opts) {
    return plain().lookup(input, opts)
  },
  async clear (opts) {
    return plain().clear(opts)
  },
  async clearName (name, opts) {
    return plain().clearName(name, opts)
  },
  async flush (opts) {
    return plain().flush(opts)
  }
})
