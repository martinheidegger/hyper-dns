/* global fetch:readable */
const base = require('./resolve.js')

async function resolveTxtFallback (_domain) {
  throw new Error('Non of the specified dns-over-https providers returned a valid result.')
}

const createBrowserResolveContext = base.createResolveContext.bind(null, fetch, resolveTxtFallback)
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
  ...addDefaults(async function resolveProtocol (protocol, name, opts) {
    return base.resolveProtocol(createBrowserResolveContext, protocol, name, {
      cache,
      ...opts
    })
  }, base.resolveProtocol),
  ...addDefaults(async function resolve (name, opts) {
    return base.resolve(createBrowserResolveContext, name, {
      cache,
      ...opts
    })
  }, base.resolve),
  ...addDefaults(async function resolveURL (url, opts) {
    return base.resolveURL(createBrowserResolveContext, url, {
      cache,
      ...opts
    })
  }, base.resolveURL)
})

function addDefaults (fn, baseFn) {
  fn.DEFAULTS = {
    ...baseFn.DEFAULTS,
    cache
  }
  return {
    [fn.name]: Object.freeze(fn)
  }
}
