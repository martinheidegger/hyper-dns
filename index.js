const debug = require('debug')('hyper-dns')
const fetch = require('cross-fetch')
const { stringify } = require('querystring')
const { bubbleAbort, wrapTimeout } = require('@consento/promise')
const QuickLRU = require('quick-lru')

const VERSION_REGEX = /\+([^/]+)$/g
const DEFAULTS = Object.freeze({
  // doh ... DNS over https
  dohLookups: Object.freeze([
    'https://cloudflare-dns.com:443/dns-query',
    'https://dns.google:443/resolve'
  ]),
  // We shouldn't read the package.json as this may cause troubles with bundlers
  userAgent: 'hyper-dns/1.0.0 (+https://github.com/martinheidegger/hyper-dns)',
  protocol: 'hyper',
  keyRegex: /^\s*(?:(?:hyper|dat):)?(?:\/\/)?([0-9a-f]{64})\s*$/i,
  txtRegex: /^\s*"?(?:hyperkey|datkey)=([0-9a-f]{64})"?\s*$/i,
  ttl: 3600, // 1hr
  maxTTL: 3600 * 24 * 7, // 1 week,
  maxSize: 1000,
  persistentCache: Object.freeze({
    async clear (_opts) {},
    async clearName (_name, _opts) {},
    async read (_name, _opts) {},
    async write (_name, _key, _expires, _opts) {},
    async flush (_opts) {}
  })
})

class ArgumentError extends Error {}
ArgumentError.prototype.code = 'EARGS'

class RecordNotFoundError extends Error {
  constructor (name, msg = 'DNS record not found') {
    super(`${msg}: ${name}`)
    this.name = name
  }
}
RecordNotFoundError.prototype.code = 'ENOTFOUND'

class NotFQDNError extends Error {
  constructor (domain, msg) {
    super(msg || `Domain (${domain}) is not a FQDN.`)
    this.domain = domain
  }
}
NotFQDNError.prototype.code = 'E_DOMAIN_NOT_FQDN'

class HttpStatusError extends Error {
  constructor (url, status, body) {
    super(`${url}[${status}] ${body}`)
    this.url = url
    this.status = status
    this.body = body
  }
}
HttpStatusError.prototype.code = 'E_HTTP_STATUS'

class DOHFormatError extends Error {
  constructor (body, cause, msg = 'Invalid dns-over-https record, must provide json') {
    super(`${msg}:\n${cause}\n${body}`)
    this.body = body
    this.cause = cause
  }
}
DOHFormatError.prototype.code = 'E_DOH_FORMAT'

class DOHAnswerMissingError extends Error {
  constructor (record, msg = 'Invalid dns-over-https record, no answers given') {
    super(`${msg}: ${JSON.stringify(record)}`)
    this.record = record
  }
}
DOHAnswerMissingError.prototype.code = 'E_DOH_ANSWER_MISSING'

class VersionURL extends URL {
  constructor (input, version, base) {
    super(input, base)
    this.version = version
  }

  toString () {
    return `${this.protocol}//${this.username ? `${this.username}:${this.password}@` : ''}${this.hostname}+${this.version}${this.port ? `:${this.port}` : ''}${this.pathname}${this.search}${this.hash}`
  }
}

class HyperDNS {
  constructor (opts) {
    opts = {
      ...DEFAULTS,
      ...opts
    }
    if (!opts.dohLookup) {
      opts.dohLookup = opts.dohLookups[Math.floor(Math.random() * opts.dohLookups.length)]
    }
    this.opts = opts

    if (!(opts.keyRegex instanceof RegExp)) {
      throw new ArgumentError('opts.keyRegex must be a RegExp object')
    }
    if (!(opts.txtRegex instanceof RegExp)) {
      throw new ArgumentError('opts.txtRegex must be a RegExp object')
    }

    this.cache = new QuickLRU({
      maxSize: opts.maxSize
    })
    this.processes = {}
  }

  async delete (name, opts = {}) {
    return wrapTimeout(async signal => {
      await this.persistentCache.clearName(name, { signal })
      this.cache.delete(name)
    }, opts)
  }

  async clear (opts = {}) {
    return wrapTimeout(async signal => {
      await this.persistentCache.clear({ signal })
      this.cache.clear()
    }, opts)
  }

  async flush (opts = {}) {
    return wrapTimeout(async signal => {
      await this.persistentCache.flush({ signal })
      const now = Date.now()
      for (const [name, value] of this.cache.entriesAscending()) {
        if (value.expires < now) {
          this.cache.delete(name)
        }
      }
    }, opts)
  }

  async resolveURL (input, opts = {}) {
    const { protocol } = this.opts
    const url = parseURL(input)
    if (!url.hostname) {
      url.hostname = url.pathname
      url.pathname = ''
    }
    let version
    if (!url.protocol) {
      url.protocol = protocol
    }
    if (url.protocol === protocol) {
      url.hostname = url.hostname.replace(VERSION_REGEX, (_match, input) => {
        version = input
        return ''
      })
      url.hostname = await this.resolveClean(url.hostname, opts)
    }
    const raw = `${url.protocol}://${url.auth ? `${url.auth}@` : ''}${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname || ''}${url.search ? `?${url.search}` : ''}${url.hash ? `#${url.hash}` : ''}`
    if (version) {
      return new VersionURL(raw, version)
    }
    return new URL(raw)
  }

  async resolveName (name, opts = {}) {
    return await this.resolveClean(cleanName(name), opts)
  }

  async resolveClean (name, opts) {
    const { persistentCache, ttl, maxTTL, dohLookup, txtRegex, keyRegex, userAgent } = this.opts

    const key = keyRegex.exec(name)
    if (key) {
      return key[1]
    }

    // ensure the name is a FQDN
    if (!name.includes('.')) {
      throw new NotFQDNError(name)
    }

    const { ignoreCache, ignoreCachedMiss } = opts
    if (!ignoreCache && name in this.processes) {
      debug('reusing ongoing process to fetch', name)
      return this.processes[name]
    }

    const process = wrapTimeout(async signal => {
      if (!ignoreCache) {
        let cacheEntry = this.cache.get(name)
        if (cacheEntry === undefined) {
          try {
            debug('restoring from persistent cache', name)
            cacheEntry = await persistentCache.read(name, { signal })
            this.cache.set(name, cacheEntry)
          } catch (err) {
            debug('error while restoring "' + name + '":', err)
          }
        }
        const now = Date.now()
        if (cacheEntry !== undefined) {
          if (cacheEntry.expires < now) {
            debug('cache entry expired:', cacheEntry.expires, '<', now)
          } else if (cacheEntry.key !== null) {
            debug('cache resolved', name, 'to', cacheEntry.key)
            return cacheEntry.key
          } else if (!ignoreCachedMiss) {
            debug('cache resolved', name, 'as miss')
            throw new RecordNotFoundError(name)
          } else {
            debug('ignoring cache miss')
          }
        } else {
          debug('not in cache')
        }
      }

      bubbleAbort(signal)

      let res
      try {
        res = await loadDnsOverHttpsRecord(name, dohLookup, txtRegex, userAgent, signal)
        debug('dns-over-https resolved "' + name + '" to', res.key)
        return res.key
      } catch (error) {
        debug('dns-over-https couldnt resolve "' + name + '":', error)
        throw new RecordNotFoundError(name)
      } finally {
        const newCacheEntry = {
          name,
          key: res ? res.key : null,
          expires: Date.now() + (res ? getTTL(res.TTL, ttl, maxTTL) : ttl) * 1000
        }
        try {
          await persistentCache.write(newCacheEntry, { signal })
        } catch (err) {
          debug('persisting cache failed:', err)
        }
        this.cache.set(name, newCacheEntry)
      }
    }, opts).finally(() => {
      if (this.processes[name] === process) {
        delete this.processes[name]
      }
    })
    this.processes[name] = process
    return process
  }
}

HyperDNS.DEFAULTS = DEFAULTS

Object.freeze(HyperDNS)
Object.freeze(HyperDNS.prototype)

let plain = () => {
  const inst = new HyperDNS()
  plain = () => inst
  return inst
}
module.exports = Object.freeze({
  HyperDNS,
  ArgumentError,
  RecordNotFoundError,
  NotFQDNError,
  HttpStatusError,
  DOHFormatError,
  DOHAnswerMissingError,
  VersionURL,
  async resolveURL (input, opts) {
    return plain().resolveURL(input, opts)
  },
  async resolveName (input, opts) {
    return plain().resolveName(input, opts)
  },
  async clear (opts) {
    return plain().clear(opts)
  },
  async delete (name, opts) {
    return plain().delete(name, opts)
  },
  async flush (opts) {
    return plain().flush(opts)
  }
})

function parseURL (input) {
  // Extended from https://tools.ietf.org/html/rfc3986#appendix-B
  const parts = /^(?:(?<protocol>[^:/?#]+):)?(?:\/\/(?:(?<auth>[^@]*)@)?(?:(?<hostname>[^/?#:]*)(?::(?<port>[0-9]+))?)?)?(?<pathname>[^?#]*)(?:\?(?<search>[^#]*))?(?:#(?<hash>.*))?$/.exec(input)
  return parts.groups
}

function cleanName (name) {
  // parse the name as needed
  const { hostname, pathname } = parseURL(name)

  // strip the version
  return (hostname || pathname).replace(VERSION_REGEX, '')
}

async function loadDnsOverHttpsRecord (name, dohLookup, dnsTxtRegex, userAgent, signal) {
  // do a DNS-over-HTTPS lookup
  const raw = await fetchDnsOverHttpsRecord(name, dohLookup, userAgent, signal)
  // parse the record
  return parseDnsOverHttpsRecord(name, await raw.text(), dnsTxtRegex)
}

async function fetchDnsOverHttpsRecord (name, dohLookup, userAgent, signal) {
  if (!name.endsWith('.')) {
    name = name + '.'
  }
  const query = {
    name,
    type: 'TXT'
  }
  const path = `${dohLookup}?${stringify(query)}`
  debug('dns-over-https lookup for name:', name, 'at', path)
  const res = await fetch(path, {
    headers: {
      // Cloudflare requires this exact header; luckily everyone else ignores it
      Accept: 'application/dns-json',
      'User-Agent': userAgent
    },
    signal
  })
  if (res.status !== 200) {
    throw new HttpStatusError(path, res.status, await res.text())
  }
  return res
}

function parseDnsOverHttpsRecord (name, body, dnsTxtRegex) {
  // decode to obj
  let record
  try {
    record = JSON.parse(body)
    if (typeof record !== 'object') {
      throw new Error('Root needs to be and object')
    }
  } catch (error) {
    throw new DOHFormatError(body, error)
  }

  // find valid answers
  let { Answer: answers } = record
  if (!Array.isArray(answers) || answers.length === 0) {
    debug('dns-over-https failed', name, 'did not give any answers')
    throw new DOHAnswerMissingError(record)
  }
  answers = answers.filter(a => {
    if (a === null || typeof a !== 'object') {
      return false
    }
    if (typeof a.data !== 'string') {
      return false
    }
    const match = dnsTxtRegex.exec(a.data)
    if (!match) {
      return false
    }
    a.key = match[1]
    return true
  })
    // Open DNS servers are not consistent in the ordering of TXT entries.
    // In order to have a consistent behavior we sort keys in case we find multiple.
    .sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0)
  if (answers.length === 0) {
    throw new DOHAnswerMissingError(record, 'Invalid dns-over-https record, no TXT answer given')
  } else if (answers.length > 1) {
    debug('warning: multiple TXT records found, using the logically largest')
  }

  // put together res
  return answers[0]
}

function getTTL (ttl, defaultTTL, maxTTL) {
  if (!Number.isSafeInteger(ttl) || ttl < 0) {
    return defaultTTL
  }
  if (ttl > maxTTL) {
    return maxTTL
  }
  return ttl
}
