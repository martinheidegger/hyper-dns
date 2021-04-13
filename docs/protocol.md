# 🤠 Protocol Guide

Table of Contents

- [Write your own protocol](#write-your-own-protocol)
- [Context API](#context-api)
- [Supported Protocols](#supported-protocols)

## Write your own protocol

The simplest protocol you could write that works with the [Core API](./api.md#core-api) looks like this:

```javascript
resolveProtocol(
  async function simple () {},
  'name'
)
```

The `async function simple() {}` creates a JavaScript function with the `.name = 'simple'` which will return `undefined`. This indicates that nothing could be resolved and marks it as a "miss".

To return a result the method needs to return an object with a key:

```javascript
async function simple () {
  return {
    key: 'foo'
  }
}
```

Now the `key = 'foo'` will be returned (and eventually stored in the cache).

To implement a protocol properly, you will need the name that we are supposed to look up. Lucky for us it is passed in the second argument

```javascript
const knownDomains = {
  foo: 'bar'
}
async function simple (_, name) {
  return {
    key: keys[name],
    ttl: 1 // you can optionally also return a ttl for this entry
  }
}
```

What is in the first parameter you ask? Good Question!

## Context API

The first parameter for a `protocol` is the `context` which gives you a few handy methods to work with:

```javascript
const myKeyRegex = /^(?<key>[0-9]{6})$/
const myTxtRegex = /^simple=(?<key>[0-9]{6})$/

// Since well-known entries may redirect: a limit for the redirects
const followRedirects = 6

async function simple (context, name) {

  let result // undefined or a result with { key, ttl }

  // check if the domain is a local domain
  // (not to be looked up over dns-over-https)
  context.isLocal(name) // returns true/false

  // Matches a domain against a given regular
  // expression to see if the name is maybe a key.
  result = context.matchRegex(name, myKeyRegex)

  // Fetches the DNS TXT records of a name that match the given regex.
  result = await context.getDNSTxtRecord(name, myTxtRegex)
 
  // Location to find a well-known entry
  const href = `https://${name}/.well-known/simple`

  result = await context.fetchWellKnown(name, href, myKeyRegex, followRedirects)
}
```

**Important** All Protocols are **required** to check if the name is actually a valid protocol key. The easiest way to get this done is using this small snippet:

```javascript
async function simple (context, name) {
  let record = context.matchRegex(name, myKeyRegex)
  if (record !== undefined) {
    return record
  }
  // ...
}
```

Are you missing a function that context needs for your protocol to work? There are two options for you:

1. [Open an Issue on Github!](https://github.com/martinheidegger/hyper-dns/issues/new/choose) and we can figure out together if we can add this feature.
2. Pass your own `opts.context` to hyper-dns that supports methods you may need. This will make your protocol "non-standard" thought and may make it hard for others to support.

## Supported Protocols

By default `hyper-dns` already supports following protocols

### dat

```javascript
const { dat } = require('hyper-dns').protocols
```

The dat protocol is implemented to match the implementation found in https://github.com/datprotocol/dat-dns.

### cabal

```javascript
const { cabal } = require('hyper-dns').protocols
```

The [cabal chat](https://cabal.chat/) protocol works the same way as `dat` does but has a different lookups for DNS entries (cabalkey=) and uses the `/.well-known/cabal` lookup.

### See a missing protocol?

If you have an implementation that should really find its way into `hyper-dns`: feel free to open a Pull Request and suggest it as default for a protocol!
