const { fetch } = require('cross-fetch')
const { stringify } = require('querystring')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const { wrapTimeout } = require('@consento/promise/wrapTimeout')

const VERSION_REGEX = /\+([^/]+)$/g
const TTL_REGEX = /^ttl=(\d+)$/i
const noop = () => {}
const CORS_WARNING = (name, url) => `Warning, the well-known lookup for "${name}" at ${url} does not serve with the http-header access-control-allow-origin=*. This means that while this domain works in the current environment it is not universally accessible and does not conform to the standard. Please contact the host and ask them to add the http-header, thanks!`
const DEFAULTS = Object.freeze({
  // doh ... DNS over https
  dohLookups: Object.freeze([
    'https://cloudflare-dns.com:443/dns-query',
    'https://dns.google:443/resolve'
  ]),
  userAgent: null,
  followRedirects: 6,
  recordName: 'dat',
  wellKnownPort: 443,
  keyRegex: /^\s*(?:(?:hyper|dat):)?(?:\/\/)?(?<key>[0-9a-f]{64})\s*$/i,
  txtRegex: /^\s*"?(?:hyperkey|datkey)=(?<key>[0-9a-f]{64})"?\s*$/i,
  ttl: 3600, // 1hr
  minTTL: 30, // 1/2 min
  maxTTL: 3600 * 24 * 7, // 1 week
  corsWarning: (name, url) => `${CORS_WARNING(name, url)} If you wish to hide this error, set opts.corsWarning to null.`,
  debug: noop
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
    super(`${msg}:\n${cause ? `${cause}\n` : ''}\n${body}`)
    this.body = body
    this.cause = cause
  }
}
DOHFormatError.prototype.code = 'E_DOH_FORMAT'

class AnswerMissingError extends Error {
  constructor (record, msg = 'Invalid dns-over-https record, no answers given') {
    super(`${msg}: ${JSON.stringify(record)}`)
    this.record = record
  }
}
AnswerMissingError.prototype.code = 'E_ANSWER_MISSING'

class WellKnownLookupError extends Error {
  constructor (href, detail, msg) {
    super(`${msg || `well-known lookup at ${href}`} ${detail}`)
    this.href = href
    this.detail = detail
  }
}
WellKnownLookupError.prototype.code = 'E_WN_LOOKUP'

class WellKnownRecordError extends Error {
  constructor (line, regex, msg) {
    super(`${msg || `Invalid well-known record, must conform to ${regex}`}: ${line}`)
    this.line = line
    this.regex = regex
  }
}
WellKnownRecordError.prototype.code = 'E_WN_RECORD'

/**
 * The URL class of node and browsers behave inconsistently
 * LightURL is a simplified version of URL that behaves same and works with versions.
 */
class LightURL {
  constructor (url, version) {
    this.protocol = `${url.protocol}:`
    this.host = url.hostname ? (url.port ? `${url.hostname}:${url.port}` : url.hostname) : ''
    this.hostname = url.hostname || ''
    this.pathname = url.pathname || ''
    this.search = url.search ? `?${url.search}` : ''
    this.hash = url.hash ? `#${url.hash}` : ''
    this.username = url.username || ''
    this.password = url.password || ''
    this.port = url.port || ''
    this.version = version
    const auth = this.username ? `${this.username}${this.password ? `:${this.password}` : ''}@` : ''
    const versionStr = this.version ? `+${this.version}` : ''
    const port = this.port ? `:${this.port}` : this.port
    this.href = `${this.protocol}${url.slashes || ''}${auth}${this.hostname}${versionStr}${port}${this.pathname}${this.search}${this.hash}`
    this.version = version
    Object.freeze(this)
  }

  toString () {
    return this.href
  }

  toJSON () {
    return this.href
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
    if (isNaN(opts.followRedirects) || opts.followRedirects < 0) {
      throw new ArgumentError('opts.followRedirects needs to be >= 0')
    }
  }

  async resolveName (name, opts = {}) {
    const { keyRegex } = this.opts
    const key = keyRegex.exec(name)
    if (key) {
      if (!key.groups || !key.groups.key) {
        throw new ArgumentError(`provided opts.keyRegex doesn't provide a "key" group response like /(?<key>[0-9a-f]{64})/: ${keyRegex}`)
      }
      return key.groups.key
    }

    // ensure the name is a FQDN
    if (!name.includes('.') && name !== 'localhost') {
      throw new NotFQDNError(name)
    }

    const entry = await this.lookup(cleanName(name), opts)
    if (entry.key === null) {
      throw new RecordNotFoundError(name)
    }
    return entry.key
  }

  async lookup (name, opts = {}) {
    if (opts.noWellknownDat) {
      if (name === 'localhost') {
        throw new ArgumentError('can not resolve localhost with the opts.noWellknownDat option set')
      }
      if (opts.noDnsOverHttps) {
        throw new ArgumentError('opts.noDnsOverHttps and the .noWellknownDat option are mutually exclusive options')
      }
    }
    let followRedirects = this.opts.followRedirects
    if (opts.followRedirects !== null && opts.followRedirects !== undefined) {
      followRedirects = parseInt(opts.followRedirects)
      if (isNaN(followRedirects) || followRedirects < 0) {
        throw new ArgumentError('opts.followRedirects needs to be >= 0')
      }
    }
    const corsWarning = opts.corsWarning !== undefined ? opts.corsWarning : this.opts.corsWarning
    return wrapTimeout(async signal => {
      const { dohLookup, keyRegex, txtRegex, userAgent, minTTL, maxTTL, debug, recordName } = this.opts

      const port = opts.wellKnownPort || this.opts.wellKnownPort
      let key = null
      let { ttl } = this.opts
      try {
        // do a DNS-over-HTTPS lookup
        let res
        if (name !== 'localhost' && !opts.noDnsOverHttps) {
          try {
            const raw = await fetchDnsOverHttpsRecord(name, dohLookup, userAgent, debug, signal)
            bubbleAbort(signal)
            // parse the record
            res = parseDnsOverHttpsRecord(await raw.text(), txtRegex, debug)
          } catch (err) {
            if (err.code !== 'E_ANSWER_MISSING' || opts.noWellknownDat) {
              throw err
            }
          }
        }
        if (!res && !opts.noWellknownDat) {
          const raw = await fetchWellKnownRecord(name, `https://${name}:${port}/.well-known/${recordName}`, followRedirects, corsWarning, debug, signal)
          bubbleAbort(signal)
          res = parseWellknownRecord(await raw.text(), keyRegex, debug)
        }
        key = res.key
        ttl = getTTL(res.TTL, ttl, minTTL, maxTTL)
        debug('dns-over-https lookup succeeded for "%s" (ttl=%s): %s', name, ttl, key)
      } catch (error) {
        if (error instanceof ArgumentError) {
          throw error
        }
        debug('dns-over-https lookup failed for "%s" (ttl=%s): %s', name, ttl, error)
      }
      return { name, key, expires: Math.round(Date.now() + ttl * 1000) }
    }, opts)
  }
}

Object.freeze(HyperLookup)
Object.freeze(HyperLookup.prototype)

// some protocols have always slashes
const slashesRequired = ['file', 'https', 'http', 'ftp']
// some protocols require to have the pathname be set to at least /
const pathnameRequired = ['https', 'http', 'ftp']

module.exports = Object.freeze({
  HyperLookup,
  DEFAULTS,
  ArgumentError,
  RecordNotFoundError,
  NotFQDNError,
  HttpStatusError,
  DOHFormatError,
  AnswerMissingError,
  LightURL,
  async resolveURL (input, opts = {}) {
    const { protocol, lookup } = opts
    const url = parseURL(input)
    let version
    if (!url.protocol) {
      url.protocol = protocol
    }
    if (url.protocol === protocol) {
      if (!url.hostname) {
        url.hostname = url.pathname
        url.pathname = ''
      }
      url.hostname = url.hostname.replace(VERSION_REGEX, (_match, input) => {
        version = input
        return ''
      })
      url.hostname = await lookup.resolveName(url.hostname, opts)
    } else {
      if (slashesRequired.includes(url.protocol)) {
        url.slashes = '//'
      }
      if (pathnameRequired.includes(url.protocol) && url.pathname === '') {
        url.pathname = '/'
      }
    }
    return new LightURL(url, version)
  }
})

function parseURL (input) {
  // Extended from https://tools.ietf.org/html/rfc3986#appendix-B
  const parts = /^(?:(?<protocol>[^:/?#]+):)?(?:(?<slashes>\/\/)(?:(?<username>[^@:]*)(?::(?<password>[^@]*))?@)?(?:(?<hostname>[^/?#:]*)(?::(?<port>[0-9]+))?)?)?(?<pathname>[^?#]*)(?:\?(?<search>[^#]*))?(?:#(?<hash>.*))?$/.exec(input)
  return parts.groups
}

function cleanName (name) {
  // parse the name as needed
  const { hostname, pathname } = parseURL(name)

  // strip the version
  return (hostname || pathname).replace(VERSION_REGEX, '')
}

async function fetchDnsOverHttpsRecord (name, dohLookup, userAgent, debug, signal) {
  if (!name.endsWith('.')) {
    name = name + '.'
  }
  const query = {
    name,
    type: 'TXT'
  }
  const path = `${dohLookup}?${stringify(query)}`
  debug('dns-over-https lookup for name:', name, 'at', path)
  const headers = {
    // Cloudflare requires this exact header; luckily everyone else ignores it
    Accept: 'application/dns-json'
  }
  if (userAgent) {
    headers['User-Agent'] = userAgent
  }
  const res = await fetch(path, {
    headers,
    signal
  })
  if (res.status !== 200) {
    throw new HttpStatusError(path, res.status, await res.text())
  }
  return res
}

function parseDnsOverHttpsRecord (body, txtRegex, debug) {
  // decode to obj
  let record
  try {
    record = JSON.parse(body)
  } catch (error) {
    throw new DOHFormatError(body, error)
  }

  if (typeof record !== 'object') {
    throw new DOHFormatError(body, null, 'Root needs to be an object')
  }

  // find valid answers
  let { Answer: answers } = record
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new AnswerMissingError(record)
  }
  answers = answers.filter(a => {
    if (a === null || typeof a !== 'object') {
      return false
    }
    if (typeof a.data !== 'string') {
      return false
    }
    const match = txtRegex.exec(a.data)
    if (!match) {
      return false
    }
    if (!match.groups || !match.groups.key) {
      throw new ArgumentError(`provided opts.txtRegex doesn't provide a "key" group response like /(?<key>[0-9a-f]{64})/: ${txtRegex}`)
    }
    a.key = match.groups.key
    return true
  })
    // Open DNS servers are not consistent in the ordering of TXT entries.
    // In order to have a consistent behavior we sort keys in case we find multiple.
    .sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0)
  if (answers.length === 0) {
    throw new AnswerMissingError(record, 'Invalid dns-over-https record, no TXT answer given')
  } else if (answers.length > 1) {
    debug('warning: multiple TXT records found, using the logically largest')
  }

  // put together res
  return answers[0]
}

async function fetchWellKnownRecord (name, href, followRedirects, corsWarning, debug, signal) {
  let redirectCount = 0
  while (redirectCount < followRedirects) {
    bubbleAbort(signal)
    debug('well-known lookup at %s', href)
    const res = await fetch(href, { signal, redirect: 'manual' })
    if (corsWarning && res.headers.get('access-control-allow-origin') !== '*') {
      console.warn(corsWarning(name, res.url))
    }
    if ([301, 302, 307, 308].includes(res.status)) {
      const newLocation = res.headers.get('Location')
      if (!newLocation) {
        throw new WellKnownLookupError(href, `redirected (${res.status}) to nowhere`)
      }
      // resolve relative paths with original URL as base URL
      const uri = new URL(newLocation, href)
      if (uri.protocol !== 'https:') {
        throw new WellKnownLookupError(href, `redirected (${res.status})} to non-https location`)
      }
      redirectCount++
      debug('well-known lookup redirected from %s to %s (%s) [%s/%s]', href, uri.href, res.status, redirectCount, followRedirects)
      href = uri.href
    } else {
      return res
    }
  }
  throw new WellKnownLookupError(href, 'exceeded redirection limit: ' + followRedirects)
}

function parseWellknownRecord (body, keyRegex, debug) {
  const lines = body.split('\n')

  const match = keyRegex.exec(lines[0])
  if (!match) {
    throw new WellKnownRecordError(lines[0], keyRegex)
  }
  if (!match.groups || !match.groups.key) {
    throw new ArgumentError(`provided opts.keyRegex doesn't provide a "key" group response like /(?<key>[0-9a-f]{64})/: ${keyRegex}`)
  }
  const key = match.groups.key
  let TTL
  if (lines[1]) {
    try {
      TTL = +(TTL_REGEX.exec(lines[1])[1])
    } catch (_) {
      debug('well-known failed to parse TTL for line: %s, must conform to %s', lines[1], TTL_REGEX)
    }
  }
  return { key, TTL }
}

function getTTL (ttl, defaultTTL, minTTL, maxTTL) {
  if (typeof ttl !== 'number' || isNaN(ttl)) {
    ttl = defaultTTL
  }
  if (ttl < minTTL) {
    return minTTL
  }
  if (ttl > maxTTL) {
    return maxTTL
  }
  return ttl
}
