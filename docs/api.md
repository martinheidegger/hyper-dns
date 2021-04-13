# 🧑‍💻 API Documentation

## Introduction

There are three core API's of hyper-dns, each optimized for a different usecases:

- `resolveProtocol(protocol, domain)` → For a simple lookup of one particular protocol

    ```js
    const { resolveProtocol } = require('hyper-dns')
    const key = await resolveProtocol('dat', 'dat-ecosystem.org')
    ```

- `resolve(domain)` → For finding out what protocols are supported by a given domain

    ```js
    const { resolve } = require('hyper-dns')
    const keys = await resolve('dat-ecosystem.org')
    // keys contains all supported protocols with null or the key value
    ```

- `resolveURL(url)` → If you have a given url, locate the best matching decentralized key

    ```js
    const { resolveURL } = require('hyper-dns')
    try {
      const url = resolveURL('dat-ecosystem.org/some/path?query')
      url.protocol // to contain the best matching protocol for the given domain
      url.hostname // to contain the key, if a decentralized key was found
      url.pathname // other url properties exist as well.
    } catch (error) { /* An error may be thrown if no protocol can be matched! */ }
    ```

## The Core API

All options for `resolveProtocol()` can also be found in `resolve()` and `resolveURL`.

---

```js
async resolveProtocol(protocol, name, [opts])
```

Returns either `null` if no key could be found or a `string` containing the key.

- `protocol` name of the protocol or a protocol implementation
- `name` name to be looked up
- `opts.dohLookups` (optional) array of https endpoints to look up DNS entires at
- `opts.userAgent` (optional) `string` or `null` of the user-agent to be used during https requests
- `opts.cache` (Cache, optional) Caching implementation to be used during execution, set to `null` or `undefined` to prevent caching. (see [Cache](#cache))
- `opts.ignoreCache` (boolean, default=`false`) Can be used to ignore the content of the cache. Note: this is different from setting `opts.cache = null` in that a result will be written to cache even if `ignoreCache` is true.
- `opts.ignoreCachedMiss` (boolean, default=`false`) Will retry to resolve the a name only if a miss was cached.
- `opts.context` (optional) Context to be used for protocol execution. (see [Architecture Guide][])
- `opts.ttl` (defaults to `3600` = 1 hour) Default `ttl` in seconds to be used if protocol doesn't specify a `ttl`
- `opts.minTTL` (defaults to `30` = 1/2 min) Minimum `ttl` in seconds that can be used for records, good to prevent rapid cache invalidation
- `opts.maxTTL` (defaults to `604800` = 1 week) Maximum `ttl` to store records for, good to indicator for stale requests.
- `opts.corsWarning` handler with signature `(name: string, url: string) => void` to be called if a http request has been noticed to have not any cors headers set, set to `falsish` to prevent any message.
- `opts.protocols` (optional) list of supported protocols, defaults to common list of supported protocols. (see [Protocol Guide][])

[Architecture Guide]: ./architecture.md
[Protocol Guide]: ./protocol.md

**About the .corsWarning option**: Some protocols support the lookup of https resources to identify a name. This is problematic when you try to run `hyper-dns` in a browser if that domain didn't set the [CORS][] header `access-control-allow-origin = *`, as it will not notice _why_ a request failed. In order for the users of `hyper-dns` to quickly notice if that is the case, it will show a warning on the command line.

// TODO...


