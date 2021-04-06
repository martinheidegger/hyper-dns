const debug = require('debug')('hyper-dns')
const cached = require('./lookup-cached.js')
const { resolveURL } = cached

let plain = () => {
  const inst = new cached.HyperLookup({
    debug
  })
  plain = () => inst
  return inst
}

module.exports = Object.freeze({
  ...cached,
  get SQLiteCache () {
    throw new Error('SQLiteCache not available in browser environment.')
  },
  get SQLITE_DEFAULTS () {
    throw new Error('SQLITE_DEFAULTS not available in browser environment.')
  },
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
  async clear () {
    // noop
  },
  async clearName () {
    // noop
  },
  async flush () {
    // noop
  }
})
