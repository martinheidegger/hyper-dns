const { wrapTimeout } = require('@consento/promise/wrapTimeout')
const { AbortError } = require('@consento/promise/AbortError')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const protocols = require('./protocols.js')
const createCacheLRU = require('./cache-lru.js')
const createResolveContext = require('./resolve-context.js')
const { LightURL, urlRegex } = require('./light-url.js')
const { matchRegex, isLocal } = createResolveContext
const debug = require('debug')('hyper-dns')

const CORS_WARNING = (name, url) => `Warning, the well-known lookup for "${name}" at ${url} does not serve with the http-header access-control-allow-origin=*. This means that while this domain works in the current environment it is not universally accessible and does not conform to the standard. Please contact the host and ask them to add the http-header, thanks!`

class RecordNotFoundError extends Error {
  constructor (name, msg = 'No record found for ') {
    super(`${msg}${name}`)
    this.name = name
  }
}
RecordNotFoundError.prototype.code = 'ENOTFOUND'

function isEntryActive (protocol, name, entry, ignoreCachedMiss) {
  if (entry === undefined) {
    return false
  }
  const now = Date.now()
  if (entry.expires < now) {
    debug('Cached entry for %s:%s has expired: %s < %s', protocol.name, name, entry.expires, now)
    return false
  }
  if (entry.key === null && ignoreCachedMiss) {
    debug('Ignoring cached miss for %s:%s because of user option.', protocol.name, name)
    return false
  }
  return true
}

function sanitizeTTL (ttl, minTTL, maxTTL) {
  if (ttl === null || ttl === undefined) {
    return
  }
  if (ttl < minTTL) {
    debug('ttl=%s is less than minTTL=%s, using minTTL', ttl, minTTL)
    return minTTL
  }
  if (ttl > maxTTL) {
    debug('ttl=%s is more than maxTTL=%s, using maxTTL', ttl, maxTTL)
    return maxTTL
  }
  return ttl
}

async function storeCacheEntry (opts, protocol, name, entry) {
  const { cache, maxTTL } = opts
  if (!cache || entry.expires === null) {
    return
  }
  const now = Date.now()
  if (now >= entry.expires) {
    return
  }
  const maxExpires = now + maxTTL * 1000
  if (entry.expires > maxExpires) {
    return
  }
  try {
    await cache.set(protocol.name, name, entry)
  } catch (error) {
    debug('Error while storing protocol %s and name %s in cache: %s', protocol.name, name, error)
  }
}

async function fallbackToCache (opts, protocol, name, cachedEntry, error) {
  const { ignoreCache, cache } = opts
  if (ignoreCache && cache) {
    debug('Falling back to cache, as error occured while looking up %s:%s: %s', protocol.name, name, error)
    cachedEntry = await getCacheEntry(opts, protocol, name)
    return cachedEntry ? cachedEntry.key : null
  }
  if (cachedEntry !== undefined) {
    debug('Using cached entry(expires=%s) because looking up %s:%s failed: %s', cachedEntry.expires, protocol.name, name, error)
    return cachedEntry.key
  }
  debug('Error while looking up %s:%s: %s', protocol.name, name, error)
  return null
}

async function resolveRaw (opts, protocol, name) {
  const { minTTL, maxTTL, signal } = opts
  let { ttl } = opts
  let key = null
  const result = await protocol(opts.context, name)
  bubbleAbort(signal)
  if (result !== undefined) {
    key = result.key
    ttl = result.ttl
  }
  ttl = sanitizeTTL(ttl, minTTL, maxTTL)
  if (key === null) {
    debug('Lookup of %s:%s[ttl=%s] returned "null", marking it as a miss.', protocol.name, name, ttl)
  } else {
    debug('Successful lookup of %s:%s[ttl=%s]: %s', protocol.name, name, ttl, result.key)
  }
  return {
    key,
    expires: ttl === undefined ? null : Date.now() + ttl * 1000
  }
}

async function resolveProtocol (createLookupContext, protocol, name, opts = {}) {
  opts = {
    ...resolveProtocol.DEFAULTS,
    ...opts
  }
  protocol = getProtocol(opts, protocol)
  return wrapContext(async opts => {
    let cachedEntry
    const { cache, ignoreCache, ignoreCachedMiss } = opts
    if (!ignoreCache && cache) {
      cachedEntry = await getCacheEntry(opts, protocol, name)
      if (isEntryActive(protocol, name, cachedEntry, ignoreCachedMiss)) {
        return cachedEntry.key
      }
    }
    let entry
    try {
      entry = await resolveRaw(opts, protocol, name)
    } catch (error) {
      if (error instanceof AbortError || error instanceof TypeError) {
        throw error
      }
      return await fallbackToCache(opts, protocol, name, cachedEntry, error)
    }
    await storeCacheEntry(opts, protocol, name, entry)
    return entry.key
  }, createLookupContext, opts)
}
resolveProtocol.DEFAULTS = Object.freeze({
  dohLookups: Object.freeze([
    'https://cloudflare-dns.com:443/dns-query',
    'https://dns.google:443/resolve'
  ]),
  userAgent: null,
  cache: null,
  protocols: Object.freeze(Object.values(protocols)),
  ignoreCache: false,
  ignoreCachedMiss: false,
  ttl: 60 * 60, // 1hr
  minTTL: 30, // 1/2min
  maxTTL: 60 * 60 * 24 * 7, // 1 week
  corsWarning: (name, url) => console.log(`${CORS_WARNING(name, url)} If you wish to hide this error, set opts.corsWarning to null.`)
})
Object.freeze(resolveProtocol)

async function resolve (createLookupContext, name, opts = {}) {
  opts = {
    ...resolve.DEFAULTS,
    ...opts
  }
  return await wrapContext(async opts => {
    const { protocols } = opts
    const keys = {}
    await Promise.all(protocols.map(async protocol => {
      protocol = getProtocol(opts, protocol)
      keys[protocol.name] = await resolveProtocol(createLookupContext, protocol, name, opts)
    }))
    return keys
  }, createLookupContext, opts)
}
resolve.DEFAULTS = resolveProtocol.DEFAULTS
Object.freeze(resolve)

async function resolveURL (createLookupContext, input, opts) {
  const url = urlRegex.exec(input).groups
  if (!url.hostname) {
    throw new TypeError('URL needs to specify a hostname, just a path can not resolve to anything.')
  }
  opts = {
    ...resolveURL.DEFAULTS,
    localPort: url.port,
    ...opts
  }
  return await wrapContext(async opts => {
    const p = url.protocol ? url.protocol.substr(0, url.protocol.length - 1) : null
    if (!p || supportsProtocol(opts.protocols, p)) {
      if (p) {
        const key = await resolveProtocol(createLookupContext, p, url.hostname, opts)
        if (key !== null) {
          url.hostname = key
        } else {
          throw new RecordNotFoundError(url.hostname)
        }
      } else {
        for (const protocol of getProtocols(opts)) {
          const key = await resolveProtocol(createLookupContext, protocol, url.hostname, opts)
          if (key !== null) {
            url.protocol = `${protocol.name}:`
            url.hostname = key
            url.slashes = '//'
            break
          }
        }
        if (!url.protocol) {
          url.protocol = `${opts.fallbackProtocol}:`
        }
      }
    }
    return new LightURL(url)
  }, createLookupContext, opts)
}
resolveURL.DEFAULTS = Object.freeze({
  ...resolve.DEFAULTS,
  protocolPreference: null,
  fallbackProtocol: 'https'
})
Object.freeze(resolveURL)

module.exports = Object.freeze({
  resolveProtocol,
  resolve,
  resolveURL,
  createCacheLRU,
  createResolveContext,
  protocols,
  RecordNotFoundError,
  LightURL
})

function supportsProtocol (protocols, protocolName) {
  for (const protocol of protocols) {
    if (protocol.name === protocolName) {
      return true
    }
  }
  return false
}

async function wrapContext (handler, createLookupContext, opts) {
  return await wrapTimeout(async signal => {
    if (signal) {
      opts.signal = signal
    }
    if (!opts.context) {
      opts.context = createLookupContext(opts)
    }
    return await handler(opts)
  }, opts)
}

function * getProtocols (opts) {
  const { protocolPreference: preferences } = opts
  const preferred = []
  if (preferences !== null && preferences !== undefined) {
    for (const preference of preferences) {
      const protocol = getProtocol(opts, preference)
      preferred.push(protocol)
    }
  }
  for (const protocol of preferred) {
    yield protocol
  }
  for (const protocol of opts.protocols) {
    if (!preferred.includes(protocol)) {
      yield protocol
    }
  }
}

const VALID_PROTOCOL = /^[^:]+$/

function getProtocol (opts, input) {
  const protocol = typeof input === 'function'
    ? input
    : opts.protocols.find(protocol => protocol.name === input)
  if (protocol === undefined) {
    throw new TypeError(`Unsupported protocol ${input}, supported protocols are [${opts.protocols.map(protocol => protocol.name).join(', ')}]`)
  }
  /* c8 ignore start */
  if (!VALID_PROTOCOL.test(protocol.name)) {
    // Note: depending on JavaScript VM, this is a possible edge case!
    throw new TypeError(`Protocol name "${protocol.name}" is invalid, it needs to match ${VALID_PROTOCOL}`)
  }
  /* c8 ignore end */
  return protocol
}

const sanitizingContext = Object.freeze({
  isLocal,
  matchRegex,
  async getDNSTxtRecord () {},
  async fetchWellKnown () {}
})

async function getCacheEntry (opts, protocol, name) {
  const { cache, signal } = opts
  let entry
  try {
    entry = await cache.get(protocol.name, name, signal)
    bubbleAbort(signal)
  } catch (error) {
    if (error instanceof AbortError || error instanceof TypeError) {
      throw error
    }
    debug('Error while restoring %s:%s from cache: %s', protocol.name, name, error)
  }
  if (entry === undefined) {
    return
  }
  if (entry === null) {
    debug('cache entry for %s:%s was empty', protocol.name, name)
    return
  }
  if (typeof entry !== 'object') {
    debug('cache entry for %s:%s was of unexpected type %s: %s', protocol.name, name, typeof entry, entry)
    return
  }
  const { key, expires } = entry
  if (typeof expires !== 'number' || isNaN(expires)) {
    debug('cache entry for %s:%s contained unexpected .expires property, expected number was: %s', protocol.name, name, expires)
    return
  }
  if (key !== null) {
    // The protocol is supposed to use .matchRegex to see if the domain to resolve contains a key.
    // A result indicates that the key indeed is valid
    if (await protocol(sanitizingContext, key) === undefined) {
      debug('cache entry for %s:%s not identified as valid key: %s', protocol.name, name, key)
      return
    }
  }
  return entry
}
