// some protocols have always slashes
const slashesRequired = ['file:', 'https:', 'http:', 'ftp:']
// some protocols require to have the pathname be set to at least /
const pathnameRequired = ['https:', 'http:', 'ftp:']

// Extended from https://tools.ietf.org/html/rfc3986#appendix-B
const urlRegex = /^(?<protocol>[^:/?#]+:)?(?:(?<slashes>\/\/)?(?:(?<username>[^@:]*)(?::(?<password>[^@]*))?@)?(?:(?<hostname>[^/?#:+]*)(?:\+(?<version>[^/?#:]*))?(?::(?<port>[0-9]+))?)?)?(?<pathname>[^?#]+)?(?<search>[^#]+)?(?<hash>.+)?$/

function parseURL (input) {
  const url = urlRegex.exec(input).groups
  if (url.hostname === '.' || url.hostname === '..') {
    url.pathname = `${url.hostname}${url.pathname}`
    url.hostname = undefined
  }
  return url
}

function resolveRelative (url, base) {
  const basePath = `${base.pathname || ''}`
  return {
    ...url,
    ...base,
    pathname: `${basePath}${basePath.endsWith('/') ? '' : '/../'}${url.pathname}`,
    search: url.search,
    hash: url.hash
  }
}

function sanitizeBase (base) {
  if (typeof base === 'string') {
    return new LightURL(base)
  }
  return base || null
}

function sanitizeURLInput (input, base) {
  const url = typeof input === 'string' ? parseURL(input) : input
  if (url.protocol !== undefined) {
    return url
  }
  base = sanitizeBase(base)
  if (base === null) {
    throw new TypeError(`Invalid URL: ${String(input)}`)
  }
  return resolveRelative(url, base)
}

function compileURLProperties (url) {
  const slashes = slashesRequired.includes(url.protocol) ? '//' : url.slashes || ''
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  const versionStr = url.version ? `+${url.version}` : ''
  const port = url.port ? `:${url.port}` : ''
  const prefix = `${url.protocol || ''}${slashes || ''}${auth}${url.hostname || ''}`
  const postfix = `${port}${url.pathname || ''}${url.search || ''}${url.hash || ''}`
  return {
    host: url.hostname ? (url.port ? `${url.hostname}:${url.port}` : url.hostname) : null,
    href: `${prefix}${postfix}`,
    versionedHref: `${prefix}${versionStr}${postfix}`
  }
}

function sanitizePathname (url) {
  let { protocol, pathname } = url
  if (pathname) {
    // Processing ../ and ./ path entries
    let ignore = 0
    pathname = pathname.split('/').reverse()
      .filter(entry => {
        if (entry === '.') {
          return false
        }
        if (entry === '..') {
          ignore += 1
          return false
        }
        if (ignore > 0) {
          ignore -= 1
          return false
        }
        return true
      })
      .reverse().join('/')
    if (pathname.startsWith('/')) {
      return pathname
    }
    return `/${pathname}`
  }
  if (pathnameRequired.includes(protocol)) {
    return '/'
  }
  return null
}

/**
 * The URL class of node and browsers behave inconsistently
 * LightURL is a simplified version of URL that behaves same and works with versions.
 */
class LightURL {
  constructor (input, base) {
    const url = sanitizeURLInput(input, base)
    this.protocol = url.protocol || null
    this.hostname = url.hostname || null
    this.pathname = sanitizePathname(url)
    this.search = url.search || null
    this.hash = url.hash || null
    this.username = url.username || null
    this.password = url.password || null
    this.port = url.port || null
    this.version = url.version || null
    this.slashes = url.slashes || null
    Object.assign(this, compileURLProperties(this))
    Object.freeze(this)
  }

  toString () {
    return this.href
  }

  toJSON () {
    return this.href
  }
}
Object.freeze(LightURL.prototype)

module.exports = Object.freeze({
  LightURL,
  urlRegex
})
