const { stringify } = require('querystring')
const { bubbleAbort } = require('@consento/promise/bubbleAbort')
const debug = require('debug')('hyper-dns')

const TTL_REGEX = /^ttl=(\d+)$/i

function isLocal (name) {
  return name === 'localhost' ||
    name.endsWith('.local') ||
    name.endsWith('.localhost') ||
    !name.includes('.')
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

function createSimpleFetch (fetch, opts) {
  const { userAgent } = opts
  const headers = {
    Accept: 'text/plain'
  }
  if (userAgent) {
    headers['User-Agent'] = userAgent
  }
  return (href, fetchOpts) => fetch(href, {
    signal: opts.signal,
    redirect: 'manual',
    ...fetchOpts,
    headers: {
      ...headers,
      ...(fetchOpts || {}).headers
    }
  })
}

function createResolveContext (fetch, dnsTxtFallback, opts) {
  const { localPort } = opts
  const simpleFetch = createSimpleFetch(fetch, opts)

  // This is not a class on purpose! We don't trust the protocols to read the state of the context.
  return Object.freeze({
    isLocal,
    matchRegex,
    getDNSTxtRecord: createGetDNSTxtRecord(opts, simpleFetch, dnsTxtFallback),
    async fetchWellKnown (name, schema, keyRegex, followRedirects) {
      const href = `https://${name}${isLocal(name) && localPort ? `:${localPort}` : ''}/.well-known/${schema}`
      const res = await fetchWellKnownRecord(simpleFetch, name, href, followRedirects, opts)
      bubbleAbort(opts.signal)
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
      return { key: match.groups.key, ttl: parseWellKnownTTL(opts, secondLine) }
    }
  })
}
createResolveContext.isLocal = isLocal
createResolveContext.matchRegex = matchRegex

function createGetDNSTxtRecord (opts, simpleFetch, dnsTxtFallback) {
  const dnsTxtLookups = {}
  return async function getDNSTxtRecord (name, txtRegex) {
    if (isLocal(name)) {
      debug('Domain "%s" is identified as local (not fully qualified). Skipping dns lookup.', name)
      return
    }
    let lookup = dnsTxtLookups[name]
    if (lookup === undefined) {
      lookup = fetchDnsTxtRecords(dnsTxtFallback, simpleFetch, name, opts)
      dnsTxtLookups[name] = lookup
    }
    return keyForTextEntries(opts, await lookup, txtRegex)
  }
}

function keyForTextEntries (opts, txtEntries, txtRegex) {
  let keys = keysForTxtEntries(txtEntries, txtRegex)
  if (keys.length === 0) {
    debug('doh: No matching TXT record found')
    return
  }
  if (keys.length > 1) {
    // Note: Open DNS servers are not consistent in the ordering of TXT entries!
    debug('doh: Warning: multiple dns TXT records for found, using the logically largest')
    keys = keys.sort(largestKey)
  }
  const res = keys[0]
  if (typeof res.ttl !== 'number' || isNaN(res.ttl) || res.ttl < 0) {
    debug('doh: no valid ttl for key=%s specified (%s), falling back to regular ttl (%s)', res.key, res.ttl, opts.ttl)
    res.ttl = opts.ttl
  }
  return res
}

const largestKey = (a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0

function invalidTxtEntry (entry) {
  if (entry === null || typeof entry !== 'object') {
    return false
  }
  if (typeof entry.data !== 'string') {
    return false
  }
  return true
}

function keysForTxtEntries (txtEntries, txtRegex) {
  return txtEntries
    .filter(invalidTxtEntry)
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
}

function parseWellKnownTTL (opts, secondLine) {
  let { ttl } = opts
  if (secondLine) {
    const ttlMatch = TTL_REGEX.exec(secondLine)
    if (ttlMatch !== null) {
      ttl = +ttlMatch[1]
    } else {
      debug('failed to parse well-known TTL for line: %s, must conform to %s', secondLine, TTL_REGEX)
    }
  }
  return ttl
}

module.exports = Object.freeze(createResolveContext)

async function fetchWellKnownRecord (simpleFetch, name, href, followRedirects, opts) {
  const { corsWarning } = opts
  debug('well-known lookup at %s', href)
  let redirectCount = 0
  while (true) {
    bubbleAbort(opts.signal)
    let res
    try {
      res = await simpleFetch(href)
    } catch (error) {
      debug('well-known lookup: error while fetching %s: %s', href, error)
      return
    }
    if (corsWarning && res.headers.get('access-control-allow-origin') !== '*') {
      corsWarning(name, res.url)
    }
    if ([301, 302, 307, 308].includes(res.status)) {
      const url = processRedirect(name, href, res)
      if (url === undefined) {
        return
      }
      redirectCount++
      if (followRedirects > 0 && redirectCount > followRedirects) {
        debug('well-known lookup for %s exceeded redirect limit: %s', name, followRedirects)
        return
      }
      debug('well-known lookup for %s redirected from %s to %s (%s) [%s/%s]', name, href, url.href, res.status, redirectCount, followRedirects)
      href = url.href
    } else {
      return res
    }
  }
}

function processRedirect (name, href, res) {
  const newLocation = res.headers.get('Location')
  if (!newLocation) {
    debug('well-known lookup for %s redirected (%s) from %s to nowhere', name, res.status, href)
    return
  }
  // resolve relative paths with original URL as base URL
  const url = new URL(newLocation, href)
  if (url.protocol !== 'https:') {
    debug('well-known lookup for %s redirected (%s) from %s to non-https location: %s', name, res.status, href, newLocation)
    return
  }
  return url
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

async function fetchDnsTxtRecords (dnsTxtFallback, fetch, name, opts) {
  const result = await fetchDnsTxtOverHttps(fetch, name, opts)
  if (result !== undefined) {
    return result
  }
  return await dnsTxtFallback(name)
}

async function fetchDnsTxtOverHttps (simpleFetch, name, opts) {
  const { dohLookups } = opts
  if (!name.endsWith('.')) {
    name = `${name}.`
  }
  const query = stringify({
    name,
    type: 'TXT'
  })
  for (const dohLookup of randomized(dohLookups)) {
    const path = `${dohLookup}?${query}`
    let res
    try {
      res = await simpleFetch(path, {
        headers: {
          // Cloudflare requires this exact header; luckily everyone else ignores it
          Accept: 'application/dns-json'
        }
      })
    } catch (error) {
      debug('doh: Error while looking up %s: %s', path, error)
      continue // Try next doh provider
    }
    bubbleAbort(opts.signal)
    const record = await jsonFromResponse(opts, name, path, res)
    if (record === undefined) {
      continue // Try next doh provider
    }
    const answers = answersFromRecord(record)
    if (answers !== undefined) {
      return answers
    }
  }
}

async function answersFromRecord (record) {
  if (typeof record !== 'object') {
    debug('doh: Invalid record, root needs to be an object')
    return // Try next doh provider
  }
  // find valid answers
  let { Answer: answers } = record
  if (answers === null || answers === undefined) {
    debug('doh: No Answers given')
    answers = []
  }
  if (!Array.isArray(answers)) {
    debug('doh: Invalid record, unexpected "Answers" given')
    return // Try next doh provider
  }
  return answers
}

async function jsonFromResponse (opts, name, path, res) {
  if (res.status !== 200) {
    /* c8 ignore next */
    const text = debug.enabled ? await res.text() : null
    debug('doh: Http status error[code=%s] while looking up %s: %s', res.status, path, text)
    return // Try next doh provider
  }
  const body = await res.text()
  bubbleAbort(opts.signal)
  debug('doh: lookup for name: %s at %s resulted in %s', name, path, res.status, body)
  try {
    return JSON.parse(body)
  } catch (error) {
    debug('doh: Invalid record, must provide valid json:\n%s', error)
  }
}
