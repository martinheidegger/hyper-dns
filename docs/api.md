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

### `async resolveProtocol(protocol, name, [opts])`

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

### `async resolve(name, [opts])`

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

### `async resolveURL(url, [opts])`

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

### `cache`

The cache holds the instance for the default `opts.cache` option to be used by `resolveProtocol`, `resolve` or `resolveURL`.

In browsers this will default to a `lru-cache` and in node to the `sqlite-cache`.

### `createCacheLRU([opts])`

> This is the default cache when using `hyper-dns` in the browser.

- `opts.maxSize` (number, default=1000) Amount of entries to keep in the cache.

The LRU cache uses the [quick-lru][] paging mechanism to keep entries in memory

[quick-lru]: https://github.com/sindresorhus/quick-lru


### `createCacheSQLite([opts])`

> This is only available in Node.js! With its default options, it is also the **default cache** of `resolve` operations in Node.js! Using this operation in the browser will cause an error!

- `opts.file` (string, default=see below) file path for the cache
- `opts.table` (string, default=names) database table to store cache entries in
- `opts.maxSize` (number, default=1000) amount of domains to keep in memory
- `opts.autoClose` (number, default=5000) milliseconds of inactivity before the SQLite instance is closed. Set autoClose to 0 to keep the database open.
- `opts.maxWalSize` (number, default=10485760) max size that triggers a wal_checkpoint operation
- `opts.walCheckInterval` (number, default 5000) interval to check the wal size

The default `file` for storing data is system specific and we use the [env-paths][] library to figure out where it is stored.

`envPaths('hyper-dns', { suffix: '' }).cache + '/cache.db'`

↑ This is the pattern for the default path.

[env-paths]: https://github.com/sindresorhus/env-paths

#### Implementation details

- It will start a sqlite instance on demand and will close it after the specified `.opts.autoClose` timeout.
- It will keep once requested entries in a `lru` cache with the provided `.maxSize` to reduce `I/O`.
- It uses the `journal_mode = WAL` which is done [for better performance][wal-performance].

_Note:_ This implementation uses the [better-sqlite3][] library.

[better-sqlite3]: https://github.com/JoshuaWise/better-sqlite3
[wal-performance]: https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/performance.md

## `protocols`

```javascript
const { protocols } = require('hyper-dns')
protocols.dat // certainly supported protocol
```

Object containing all default supported protocols. More about this in the [Protocol Guide](./protocol.md#supported-protocols).

## `createResolveContext(opts, signal)`

```javascript
const { createResolveContext } = require('hyper-dns')
```

`createResolveContext` can be used to create `Context` implementations for the `opts.context` option of `resolve...()` operations. (more in the [Protocol Guide][ContextAPI])

[ContextAPI]: ./protocol.md#context-api

The following options form [resolveProtocol(opts)][] are used: `ttl`, `corsWarning`, `userAgent`, `dohLookups`, `localPort`. More about these options in the `resolveProtocol(opts)` documentation.

- `signal` (AbortSignal, optional) - an abort signal to be used to cancel all protocol requests.


[resolveProtocol(opts)]: #async-resolveprotocolprotocol-name-opts

## `LightURL`

Initially the [URL][] implementation was supposed to be used. Sadly browsers and node.js are not 100% compatible and furthermore decentralized web protocols also have an additional "version" specifier.

This is why `hyper-dns` provides a custom `LightURL`, named to prevent confusion with the regular `URL`.

```js
const { LightURL } = require('hyper-dns')

const url = new LightURL('dat://dat-ecosystem.org/organization')
url.protocol == 'dat://'
url.hostname == 'dat-ecosystem.org'
url.pathname == '/organization'
url.href == 'dat://dat-ecosystem.org/organization'
```

### `new LightURL(url, [base])`

- `url` (string) the url, or path segment to be used to create the string
- `base` (string or LightURL instance, optional)

The biggest incompatibility to [URL][] is that path names and query strings are **not uri encoded** but kept in their original form!

**Important Note:** Instances are [frozen][] upon creation. This means you can't modify properties as you usually would with `URL` instances to reduce complexity.

Another difference is the additional `versionedHref` property which contains the parsed version as well!

```js
const { LightURL, resolveURL } = require('hyper-dns')

const input = '../démonstration.html'
const base = await resolveURL('dat://dat-ecosystem.org+1234/base/index.html')

// Getting the relative path for a dat URL
const url = new LightURL(input, base)

// To stay compatible the .href doesn't contain a version
url.href === 'dat://dat-ecosystem.org/démonstration.html'

// But the new property versionedHref contains everything
url.versionedHref === 'dat://dat-ecosystem.org+1234/démonstration.html'
```

[URL]: https://developer.mozilla.org/en-US/docs/Web/API/URL
[frozen]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
