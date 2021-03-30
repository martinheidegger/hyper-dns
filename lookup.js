const debug = require('debug')('hyper-dns')
const fetch = require('cross-fetch')
const { stringify } = require('querystring')
const { wrapTimeout, bubbleAbort } = require('@consento/promise')

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
  maxTTL: 3600 * 24 * 7 // 1 week
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

class HyperLookup {
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
      url.hostname = await this.resolveName(url.hostname, opts)
    }
    const raw = `${url.protocol}://${url.auth ? `${url.auth}@` : ''}${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname || ''}${url.search ? `?${url.search}` : ''}${url.hash ? `#${url.hash}` : ''}`
    if (version) {
      return new VersionURL(raw, version)
    }
    return new URL(raw)
  }

  async resolveName (name, opts = {}) {
    const { keyRegex } = this.opts
    const key = keyRegex.exec(name)
    if (key) {
      return key[1]
    }

    // ensure the name is a FQDN
    if (!name.includes('.')) {
      throw new NotFQDNError(name)
    }

    const entry = await this.lookup(cleanName(name), opts)
    if (entry.key === null) {
      throw new RecordNotFoundError(name)
    }
    return entry.key
  }

  async lookup (name, opts = {}) {
    return wrapTimeout(async signal => {
      const { dohLookup, txtRegex, userAgent, maxTTL } = this.opts
      let key = null
      let { ttl } = this.opts
      try {
        // do a DNS-over-HTTPS lookup
        const raw = await fetchDnsOverHttpsRecord(name, dohLookup, userAgent, signal)
        bubbleAbort(signal)
        // parse the record
        const res = parseDnsOverHttpsRecord(name, await raw.text(), txtRegex)
        key = res.key
        ttl = getTTL(res.TTL, ttl, maxTTL)
        debug('dns-over-https lookup succeeded for "' + name + '":', key, 'ttl=' + ttl)
      } catch (error) {
        debug('dns-over-https lookup failed for "' + name + '":', error, 'ttl=' + ttl)
      }
      return { name, key, expires: Math.round(Date.now() + ttl * 1000) }
    }, opts)
  }
}

Object.freeze(HyperLookup)
Object.freeze(HyperLookup.prototype)

module.exports = Object.freeze({
  HyperLookup,
  DEFAULTS,
  ArgumentError,
  RecordNotFoundError,
  NotFQDNError,
  HttpStatusError,
  DOHFormatError,
  DOHAnswerMissingError,
  VersionURL
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
  if (typeof ttl !== 'number' || isNaN(ttl) || ttl < 0) {
    return defaultTTL
  }
  if (ttl > maxTTL) {
    return maxTTL
  }
  return ttl
}
