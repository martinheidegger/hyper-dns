# 🧑‍💻 API Documentation

Table of Contents:

- [Introduction](#introduction)
- [Core API](#core-api)
  - [resolveProtocol()](#async-resolveprotocolprotocol-name-opts)
  - [resolve()](#async-resolvename-opts)
  - [resolveURL()](#async-resolveurlurl-opts)
- [Caching](#caching)
  - [cache](#cache)
  - [createCacheLRU](#createcachelru)
  - [createCacheSQLite](#createcachesqlite)
- [protocols](#protocols)
- [createResolveContext](#createresolvecontextopts-signal)
- [LightURL](#lighturl)

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
    } catch (error) {
      /* An error may be thrown if no protocol can be matched! */
    }
    ```

## Core API

```javascript
const { resolveProtocol, resolve, resolveURL } = require('hyper-dns')
```

#### `async resolveProtocol(protocol, name, [opts])`

Returns either `null` if no key could be found or a `string` containing the key.

- `protocol` name of the protocol or a protocol implementation
- `name` name to be looked up
- `opts.dohLookups` (optional) array of https endpoints to look up DNS records
- `opts.userAgent` (optional) `string` or `null` of the user-agent to be used during https requests
- `opts.cache` (Cache, optional, default caching logic differs by runtime) Caching implementation to be used during execution, set to `null` or `undefined` to prevent caching. (see [Caching](#caching))
- `opts.ignoreCache` (boolean, default=`false`) Can be used to ignore the content of the cache. Note: this is different from setting `opts.cache = null` in that a result will be written to cache even if `ignoreCache` is true.
- `opts.ignoreCachedMiss` (boolean, default=`false`) Will retry to resolve the a name only if a miss was cached.
- `opts.context` (optional) Context to be used for protocol execution. (see [Architecture Guide][])
- `opts.ttl` (defaults to `3600` = 1 hour) Default `ttl` in seconds to be used if protocol doesn't specify a `ttl`
- `opts.minTTL` (defaults to `30` = 1/2 min) Minimum `ttl` in seconds that can be used for records, good to prevent rapid cache invalidation
- `opts.maxTTL` (defaults to `604800` = 1 week) Maximum `ttl` to store records for, good to indicator for stale requests.
- `opts.corsWarning` handler with signature `(name: string, url: string) => void` to be called if a http request has been noticed to have not any cors headers set, set to `falsish` to prevent any message.
- `opts.localPort` (optional) port used when trying to lookup `well-known` entries on a local domain.
- `opts.protocols` (optional) list of supported protocols, defaults to common list of supported protocols. (see [Protocol Guide][])

_Note:_ `resolveProtocol.DEFAULTS` contains the object with all defaults.

[Architecture Guide]: ./architecture.md
[Protocol Guide]: ./protocol.md

**About the .corsWarning option**: Some protocols support the lookup of https resources to identify a name. This is problematic when you try to run `hyper-dns` in a browser if that domain didn't set the [CORS][] header `access-control-allow-origin = *`, as it will not notice _why_ a request failed. In order for the users of `hyper-dns` to quickly notice if that is the case, it will show a warning on the command line.

[CORS]: https://en.wikipedia.org/wiki/Cross-origin_resource_sharing

#### `async resolve(name, [opts])`

Returns an object with the `resolveProtocol()` results for all given protocols, like:

```js
{
  dat: 'ae14a...fc651',
  hyper: null,
  cabal: '3bea1...8569a',
  // The protocols are derived from the `opts.protocols` option
}
```

- `opts` The same options as for `resolveProtocols()` apply.

_Note:_ `resolve.DEFAULTS` contains the object with all defaults.

#### `async resolveURL(url, [opts])`

- `opts` uses the same options as `resolveProtocol` but adds:
- `opts.protocolPreference` (optional: Array of names) order of protocols to look up with preference
- `opts.fallbackProtocol` (default: https) protocol to be used if no other protocol can be found.

_Note:_ `resolveURL.DEFAULTS` contains the object with all defaults.

Returns a [LightURL](#lighturl) instance that contains all properties of the input url in a readable manner.

The `resolveURL` API has two different modes that behave slightly different:

1. If you pass in a URL like `hyper://dat-ecosystem.org` with a full protocol specified, it will look up only the `hyper` protocol and throw a `require('hyper-dns').RecordNotFoundError` if no record for that protocol could be found.

    ```js
    try {
      const url = await resolveURL('hyper://dat-ecosystem.org')
      url.href === 'hyper://ae14a...fc651' // if a hyper record was found
    } catch (err) {
      err.code === 'ENOTFOUND' // if no HYPER record was found
    }
    ```

2. If you pass in a URL like `dat-ecosystem.org` it will try, with preference, all given protocols and use the first result as result. If non of the protocols could be found it will fall-back to `opts.fallbackProtocol`.

    ```js
    const url = await resolveURL('dat-ecosystem.org')
    
    url.href === 'hyper://ae14a...fc651' // if a hyper record was found
    url.href === 'https://dat-ecosystem.org' // if no record was found
    ```

**resolveURL()** will work for local domains if the protocol supports it! In this case it fill forward the port specified to as `opts.localPort` if it hasn't been overwritten.

## Caching

```javascript
const { cache, createCacheSQLite, createCacheLRU } = require('hyper-dns')
```

All `Cache` instances have to implement a common interface:

```typescript
interface Cache {
  get (
    protocol: string,
    name: string
  ): Promise<
    undefined // If no cache entry was found
    | {
      key:
        string
        | null // Indicating a cache-miss! (Needs to be stored)
      ,
      expires: number
    }
  >

  set (
    protocol: string,
    name: string,
    entry: { key: string | null, expires: number }
  ): Promise<void>
}
```

The result of `get()` operations will be sanitizied.

#### `cache`

The cache holds the instance for the default `opts.cache` option to be used by `resolveProtocol`, `resolve` or `resolveURL`.

In browsers this will default to a `lru-cache` and in node to the `sqlite-cache`.

#### `createCacheLRU([opts])`

// TODO

#### `createCacheSQLite([opts])`

// TODO

## protocols

```javascript
const { protocols } = require('hyper-dns')
protocols.dat // certainly supported protocol
```

Object containing all default supported protocols. More about this in the [Protocol Guide](./protocol.md#supported-protocols).

## `createResolveContext(opts, signal)`

```javascript
const { createResolveContext } = require('hyper-dns')
```

// TODO

## `LightURL`

```javascript
const { LightURL } = require('hyper-dns')
```

// TODO
