const resolveTxt = require('util').promisify(require('dns').resolveTxt)
const debug = require('debug')('hyper-dns')
const base = require('./resolve.js')
const createCacheSqlite = require('./cache-sqlite.js')

const nodeFetch = require('node-fetch')
const createHttpsAgent = require('https-proxy-agent')
const { getProxyForUrl } = require('proxy-from-env')
const QuickLRU = require('quick-lru')

let proxyCache
async function fetch (url, options) {
  let agent = null
  const proxy = getProxyForUrl(url)
  if (proxy) {
    debug('Using https proxy %s for %s', proxy, url)
    if (!proxyCache) {
      proxyCache = new QuickLRU({ maxSize: 100 })
    }
    agent = proxyCache.get(proxy)
    if (agent === undefined) {
      agent = createHttpsAgent(proxy)
      proxyCache.set(proxy, agent)
    }
  }
  return nodeFetch(url, {
    agent,
    ...options
  })
}

async function resolveTxtFallback (domain) {
  debug('Using system dns to resolve a domain as all doh providers have failed.')
  return (await resolveTxt(domain)).map(data => ({ data: data[0] }))
}

function createResolveContext (opts) {
  return base.createResolveContext(fetch, resolveTxtFallback, opts)
}
const cache = createCacheSqlite()

module.exports = Object.freeze({
  ...base,
  cache,
  createCacheSqlite,
  ...addProperties(createResolveContext, base.createResolveContext),
  async resolveProtocol (protocol, name, opts) {
    return base.resolveProtocol(createResolveContext, protocol, name, {
      cache,
      ...opts
    })
  },
  async resolve (name, opts) {
    return base.resolve(createResolveContext, name, {
      cache,
      ...opts
    })
  },
  async resolveURL (url, opts) {
    return base.resolveURL(createResolveContext, url, {
      cache,
      ...opts
    })
  }
})

addDefaults(module.exports.resolveProtocol, base.resolveProtocol)
addDefaults(module.exports.resolve, base.resolve)
addDefaults(module.exports.resolveURL, base.resolveURL)

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
  Object.freeze(fn)
}
