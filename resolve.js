const { wrapTimeout } = require('@consento/promise/wrapTimeout')
const { AbortError } = require('@consento/promise/AbortError')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const protocols = require('./protocols.js')
const createCacheLRU = require('./cache-lru.js')
const createResolveContext = require('./resolve-context.js')
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

// some protocols have always slashes
const slashesRequired = ['file', 'https', 'http', 'ftp']
// some protocols require to have the pathname be set to at least /
const pathnameRequired = ['https', 'http', 'ftp']

/**
 * The URL class of node and browsers behave inconsistently
 * LightURL is a simplified version of URL that behaves same and works with versions.
 */
class LightURL {
  constructor (url) {
    this.protocol = url.protocol ? `${url.protocol}:` : null
    this.host = url.hostname ? (url.port ? `${url.hostname}:${url.port}` : url.hostname) : null
    this.hostname = url.hostname || null
    let pathname = url.pathname || null
    if (pathname === null && pathnameRequired.includes(url.protocol)) {
      pathname = '/'
    }
    this.pathname = pathname
    this.search = url.search ? `?${url.search}` : null
    this.hash = url.hash ? `#${url.hash}` : null
    this.username = url.username || null
    this.password = url.password || null
    this.port = url.port || null
    this.version = url.version || null
    this.slashes = url.slashes || null
    const slashes = slashesRequired.includes(url.protocol) ? '//' : url.slashes || ''
    const auth = this.username ? `${this.username}${this.password ? `:${this.password}` : ''}@` : ''
    const versionStr = this.version ? `+${this.version}` : ''
    const port = this.port ? `:${this.port}` : ''
    this.href = `${this.protocol || ''}${slashes || ''}${auth}${this.hostname || ''}${versionStr}${port}${this.pathname || ''}${this.search || ''}${this.hash || ''}`
    Object.freeze(this)
  }

  toString () {
    return this.href
  }

  toJSON () {
    return this.href
  }
}

async function resolveProtocol (createLookupContext, protocol, name, opts = {}) {
  opts = {
    ...resolveProtocol.DEFAULTS,
    ...opts
  }
  protocol = getProtocol(opts, protocol)
  return wrapContext(async (context, signal) => {
    let entry
    let isCachedEntry = true
    const { cache, ignoreCache, ignoreCachedMiss, minTTL, maxTTL } = opts
    if (!ignoreCache && cache) {
      entry = await getCacheEntry(cache, protocol, name, entry)
      if (entry !== undefined) {
        const now = Date.now()
        if (entry.expires < now) {
          debug('Cached entry for %s:%s has expired: %s < %s', protocol.name, name, entry.expires, now)
        } else if (entry.key === null) {
          if (!ignoreCachedMiss) {
            return null
          } else {
            debug('Ignoring cached miss for %s:%s because of user option.', protocol.name, name)
          }
        } else {
          return entry.key
        }
      }
    }
    let { ttl } = opts
    try {
      let key = null
      const result = await protocol(context, name)
      bubbleAbort(signal)
      if (result !== undefined) {
        key = result.key
        ttl = result.ttl
      }
      isCachedEntry = false
      if (ttl !== null) {
        if (ttl < minTTL) {
          debug('ttl=%s is less than minTTL=%s, using minTTL', ttl, minTTL)
          ttl = minTTL
        } else if (ttl > maxTTL) {
          debug('ttl=%s is more than maxTTL=%s, using maxTTL', ttl, maxTTL)
          ttl = maxTTL
        }
      }
      if (key === null) {
        debug('Lookup of %s:%s[ttl=%s] returned "null", marking it as a miss.', protocol.name, name, ttl)
      } else {
        debug('Successful lookup of %s:%s[ttl=%s]: %s', protocol.name, name, ttl, result.key)
      }
      entry = {
        key,
        expires: ttl === null || ttl === undefined ? null : Date.now() + ttl * 1000
      }
    } catch (error) {
      if (error instanceof AbortError || error instanceof TypeError) {
        throw error
      }
      if (ignoreCache && cache) {
        debug('Falling back to cache, as error occured while looking up %s:%s: %s', protocol.name, name, error)
        entry = await getCacheEntry(cache, protocol, name, entry)
        return entry ? entry.key : null
      }
      if (entry !== undefined) {
        debug('Using cached entry(expires=%s) because looking up %s:%s failed: %s', entry.expires, protocol.name, name, error)
        return entry.key
      }
      debug('Error while looking up %s:%s: %s', protocol.name, name, error)
      return null
    }
    const now = Date.now()
    if (cache && !isCachedEntry && entry.expires !== null && now < entry.expires && entry.expires <= now + maxTTL * 1000) {
      try {
        await cache.set(protocol.name, name, entry)
      } catch (error) {
        debug('Error while storing protocol %s and name %s in cache: %s', protocol.name, name, error)
      }
    }
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
  return await wrapContext(async (context, signal) => {
    const { protocols } = opts
    const keys = {}
    const childOpts = {
      ...opts,
      context,
      signal
    }
    await Promise.all(protocols.map(async protocol => {
      protocol = getProtocol(opts, protocol)
      keys[protocol.name] = await resolveProtocol(createLookupContext, protocol, name, childOpts)
    }))
    return keys
  }, createLookupContext, opts)
}
resolve.DEFAULTS = resolveProtocol.DEFAULTS
Object.freeze(resolve)

// Extended from https://tools.ietf.org/html/rfc3986#appendix-B
const urlRegex = /^(?:(?<protocol>[^:/?#]+):)?(?:(?<slashes>\/\/)?(?:(?<username>[^@:]*)(?::(?<password>[^@]*))?@)?(?:(?<hostname>[^/?#:+]*)(?:\+(?<version>[^/?#:]*))?(?::(?<port>[0-9]+))?)?)?(?<pathname>[^?#]*)(?:\?(?<search>[^#]*))?(?:#(?<hash>.*))?$/

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
  return await wrapContext(async (context, signal) => {
    if (!url.protocol || supportsProtocol(opts.protocols, url.protocol)) {
      const childOpts = {
        ...opts,
        context,
        signal
      }
      if (url.protocol) {
        const key = await resolveProtocol(createLookupContext, url.protocol, url.hostname, childOpts)
        if (key !== null) {
          url.hostname = key
        } else {
          throw new RecordNotFoundError(url.hostname)
        }
      } else {
        for (const protocol of getProtocols(opts)) {
          const key = await resolveProtocol(createLookupContext, protocol, url.hostname, childOpts)
          if (key !== null) {
            url.protocol = protocol.name
            url.hostname = key
            url.slashes = '//'
            break
          }
        }
        if (!url.protocol) {
          url.protocol = opts.fallbackProtocol
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
  if (opts.context) {
    return await handler(opts.context, opts.signal)
  }
  return wrapTimeout(async signal => {
    return await handler(createLookupContext(opts, signal), signal)
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

async function getCacheEntry (cache, protocol, name, signal) {
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
