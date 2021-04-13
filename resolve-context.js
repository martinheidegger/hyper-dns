const { stringify } = require('querystring')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const debug = require('debug')('hyper-dns')

const TTL_REGEX = /^ttl=(\d+)$/i

function isLocal (name) {
  if (name === 'localhost') {
    return true
  }
  if (name.endsWith('.local')) {
    return true
  }
  if (name.endsWith('.localhost')) {
    return true
  }
  if (!name.includes('.')) {
    return true
  }
  return false
}

function matchRegex (name, regex) {
  const match = regex.exec(name)
  if (match !== null) {
    if (!match.groups || !match.groups.key) {
      throw new TypeError('The .regex to match a key is not properly specified. It needs to return a <key> group.')
    }
    debug('No resolving of "%s" for needed, its a key.', name)
    return {
      key: match.groups.key,
      ttl: null
    }
  }
}

function createResolveContext (fetch, dnsTxtFallback, opts, signal) {
  const dnsTxtLookups = {}
  const { localPort } = opts

  // This is not a class on purpose! We don't trust the protocols
  // to read the state of the context.
  return Object.freeze({
    isLocal,
    matchRegex,
    async getDNSTxtRecord (name, txtRegex) {
      if (isLocal(name)) {
        debug('Domain "%s" is identified as local (not fully qualified). Skipping dns lookup.', name)
        return
      }
      let lookup = dnsTxtLookups[name]
      if (lookup === undefined) {
        lookup = fetchDnsTxtRecords(dnsTxtFallback, fetch, name, opts, signal)
        dnsTxtLookups[name] = lookup
      }
      const answers = (await lookup).filter(a => {
        if (a === null || typeof a !== 'object') {
          return false
        }
        if (typeof a.data !== 'string') {
          return false
        }
        return true
      })
      if (answers === undefined || answers.length === 0) {
        return
      }
      let keys = answers
        .map(({ data, TTL: ttl }) => {
          const match = txtRegex.exec(data)
          if (!match) {
            return undefined
          }
          if (!match.groups || !match.groups.key) {
            throw new TypeError(`specified txtRegex doesn't contain a "key" group like /(?<key>[0-9a-f]{64})/: ${txtRegex}`)
          }
          return { key: match.groups.key, ttl }
        })
        .filter(Boolean)
      if (keys.length === 0) {
        debug('doh: No matching TXT record found')
        return
      } else if (keys.length > 1) {
        debug('doh: Warning: multiple dns TXT records for found, using the logically largest')
        keys = keys
          // Open DNS servers are not consistent in the ordering of TXT entries.
          // In order to have a consistent behavior we sort keys in case we find multiple.
          .sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0)
      }
      const res = keys[0]
      if (typeof res.ttl !== 'number' || isNaN(res.ttl) || res.ttl < 0) {
        debug('doh: no valid ttl for key=%s specified (%s), falling back to regular ttl (%s)', res.key, res.ttl, opts.ttl)
        res.ttl = opts.ttl
      }
      return res
    },
    async fetchWellKnown (name, schema, keyRegex, followRedirects) {
      const href = `https://${name}${isLocal(name) && localPort ? `:${localPort}` : ''}/.well-known/${schema}`
      const res = await fetchWellKnownRecord(fetch, name, href, followRedirects, opts, signal)
      bubbleAbort(signal)
      if (res === undefined) {
        return
      }
      const [firstLine, secondLine] = (await res.text()).split('\n')
      const match = keyRegex.exec(firstLine)
      if (!match) {
        debug('Invalid well-known record at %s, must conform to %s: %s', href, keyRegex, firstLine)
        return
      }
      if (!match.groups || !match.groups.key) {
        throw new TypeError(`specified keyRegex doesn't provide a "key" group response like /(?<key>[0-9a-f]{64})/: ${keyRegex}`)
      }
      const key = match.groups.key
      let { ttl } = opts
      if (secondLine) {
        const ttlMatch = TTL_REGEX.exec(secondLine)
        if (ttlMatch !== null) {
          ttl = +ttlMatch[1]
        } else {
          debug('failed to parse well-known TTL for line: %s, must conform to %s', secondLine, TTL_REGEX)
        }
      }
      return { key, ttl }
    }
  })
}
createResolveContext.isLocal = isLocal
createResolveContext.matchRegex = matchRegex

module.exports = Object.freeze(createResolveContext)

async function fetchWellKnownRecord (fetch, name, href, followRedirects, opts, signal) {
  const { userAgent, corsWarning } = opts
  let redirectCount = 0
  while (true) {
    bubbleAbort(signal)
    if (redirectCount === 0) {
      debug('well-known lookup at %s', href)
    }
    const headers = {
      Accept: 'text/plain'
    }
    if (userAgent) {
      headers['User-Agent'] = userAgent
    }
    let res
    try {
      res = await fetch(href, { headers, signal, redirect: 'manual' })
    } catch (error) {
      debug('well-known lookup: error while fetching %s: %s', href, error)
      return
    }
    if (corsWarning && res.headers.get('access-control-allow-origin') !== '*') {
      corsWarning(name, res.url)
    }
    if ([301, 302, 307, 308].includes(res.status)) {
      const newLocation = res.headers.get('Location')
      if (!newLocation) {
        debug('well-known lookup for %s redirected (%s) from %s to nowhere', name, res.status, href)
        return
      }
      // resolve relative paths with original URL as base URL
      const uri = new URL(newLocation, href)
      if (uri.protocol !== 'https:') {
        debug('well-known lookup for %s redirected (%s) from %s to non-https location: %s', name, res.status, href, newLocation)
        return
      }
      redirectCount++
      if (followRedirects > 0 && redirectCount > followRedirects) {
        debug('well-known lookup for %s exceeded redirect limit: %s', name, followRedirects)
        return
      }
      debug('well-known lookup for %s redirected from %s to %s (%s) [%s/%s]', name, href, uri.href, res.status, redirectCount, followRedirects)
      href = uri.href
    } else {
      return res
    }
  }
}

function * randomized (array) {
  const rest = array.concat() // clone
  let len = rest.length
  while (len > 1) {
    const [entry] = rest.splice((Math.random() * len) % len, 1)
    len -= 1
    yield entry
  }
  if (len === 1) {
    yield rest[0]
  }
}

async function fetchDnsTxtRecords (dnsTxtFallback, fetch, name, opts, signal) {
  const { noDnsOverHttps } = opts
  if (!noDnsOverHttps) {
    const result = await fetchDnsTxtOverHttps(fetch, name, opts, signal)
    if (result !== undefined) {
      return result
    }
  }
  return await dnsTxtFallback(name)
}

async function fetchDnsTxtOverHttps (fetch, name, opts, signal) {
  const { dohLookups, userAgent } = opts
  if (!name.endsWith('.')) {
    name = `${name}.`
  }
  const headers = {
    // Cloudflare requires this exact header; luckily everyone else ignores it
    Accept: 'application/dns-json'
  }
  if (userAgent) {
    headers['User-Agent'] = userAgent
  }
  const query = stringify({
    name,
    type: 'TXT'
  })
  for (const dohLookup of randomized(dohLookups)) {
    const path = `${dohLookup}?${query}`
    let res
    try {
      res = await fetch(path, {
        headers,
        signal
      })
    } catch (error) {
      debug('doh: Error while looking up %s: %s', path, error)
      continue // Try next doh provider
    }
    if (res.status !== 200) {
      /* c8 ignore next */
      const text = debug.enabled ? await res.text() : null
      debug('doh: Http status error[code=%s] while looking up %s: %s', res.status, path, text)
      continue // Try next doh provider
    }
    bubbleAbort(signal)
    const body = await res.text()
    debug('doh: lookup for name: %s at %s resulted in %s', name, path, res.status, body)
    let record
    try {
      record = JSON.parse(body)
    } catch (error) {
      debug('doh: Invalid record, must provide valid json:\n%s', error)
      continue // Try next doh provider
    }
    bubbleAbort(signal)
    if (typeof record !== 'object') {
      debug('doh: Invalid record, root needs to be an object')
      continue // Try next doh provider
    }
    // find valid answers
    let { Answer: answers } = record
    if (answers === null || answers === undefined) {
      debug('doh: No Answers given')
      answers = []
    }
    if (!Array.isArray(answers)) {
      debug('doh: Invalid record, unexpected "Answers" given')
      continue // Try next doh provider
    }
    return answers
  }
}
