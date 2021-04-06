const resolveTxt = require('util').promisify(require('dns').resolveTxt)
const debug = require('debug')('hyper-dns')
const base = require('./resolve.js')
const createCacheSqlite = require('./cache-sqlite.js')

const nodeFetch = require('node-fetch')
const createHttpsAgent = require('https-proxy-agent')
const { getProxyForUrl } = require('proxy-from-env')
const loadQuickLRU = import('quick-lru')

let proxyCache
async function fetch (url, options) {
  let agent = null
  const proxy = getProxyForUrl(url)
  if (proxy) {
    debug('Using https proxy %s for %s', proxy, url)
    if (!proxyCache) {
      const { default: QuickLRU } = await loadQuickLRU
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

const createNodeLookupContext = base.createResolveContext.bind(null, fetch, resolveTxtFallback)
const cache = createCacheSqlite()

module.exports = Object.freeze({
  ...base,
  cache,
  createCacheSqlite,
  ...addDefaults(async function resolveProtocol (protocol, name, opts) {
    return base.resolveProtocol(createNodeLookupContext, protocol, name, {
      cache,
      ...opts
    })
  }, base.resolveProtocol),
  ...addDefaults(async function resolve (name, opts) {
    return base.resolve(createNodeLookupContext, name, {
      cache,
      ...opts
    })
  }, base.resolve),
  ...addDefaults(async function resolveURL (url, opts) {
    return base.resolveURL(createNodeLookupContext, url, {
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
