/* global fetch:readable */
const base = require('./resolve.js')

async function resolveTxtFallback (_domain) {
  throw new Error('Non of the specified dns-over-https providers returned a valid result.')
}

function createResolveContext (opts) {
  return base.createResolveContext(fetch, resolveTxtFallback, opts)
}
const cache = base.createCacheLRU()

function createCacheSqlite () {
  throw new Error('createCacheSqlite not available in browser environment.')
}
createCacheSqlite.DEFAULTS = Object.freeze({})
Object.freeze(createCacheSqlite)

module.exports = Object.freeze({
  ...base,
  cache,
  createCacheSqlite,
  ...addProperties(createResolveContext, base.createResolveContext),
  ...addDefaults(async function resolveProtocol (protocol, name, opts) {
    return base.resolveProtocol(createResolveContext, protocol, name, {
      cache,
      ...opts
    })
  }, base.resolveProtocol),
  ...addDefaults(async function resolve (name, opts) {
    return base.resolve(createResolveContext, name, {
      cache,
      ...opts
    })
  }, base.resolve),
  ...addDefaults(async function resolveURL (url, opts) {
    return base.resolveURL(createResolveContext, url, {
      cache,
      ...opts
    })
  }, base.resolveURL)
})

function addProperties (fn, baseFn) {
  for (const [key, value] of Object.entries(baseFn)) {
    fn[key] = value
  }
  return {
    [fn.name]: Object.freeze(fn)
  }
}

function addDefaults (fn, baseFn) {
  fn.DEFAULTS = {
    ...baseFn.DEFAULTS,
    cache
  }
  return {
    [fn.name]: Object.freeze(fn)
  }
}
