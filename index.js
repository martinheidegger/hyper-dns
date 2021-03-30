const cached = require('./lookup-cached.js')

let plain = () => {
  const inst = new cached.HyperCachedLookup()
  plain = () => inst
  return inst
}

module.exports = Object.freeze({
  ...cached,
  async resolveURL (input, opts) {
    return plain().resolveURL(input, opts)
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
