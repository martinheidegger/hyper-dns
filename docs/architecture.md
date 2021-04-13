# 🏠 Architecture

When starting this project, it seemed simple but it turns out there are a few things that were not obvious and hide quite a bit of complexity.

## Caching

Hyper-dns uses two levels of cache. A _context-cache_ and a _system-cache_.

The _context-cache_ is used for the duration of a `resolve` operation. It will keep things like DNS results in memory to make sure that two protocols that need the same resource can access it. This is implemented in the `resolve-context` and is not shared[^api-context] between requests.

The _system-cache_ is used to cache the results of a `resolve` operations to lower the load for repeat requests. It will only cache the results and supports expiration. This is implemented in either as a _in-memory-cache_ or a _sqlite-cache_.

The _in-memory-cache_ is a [lru-cache][] used to cache the result of `resolve` operations only. It is  which gives it a stable runtime-performance.

The _sqlite-cache_ is a overlay over the _in-memory-cache_. As the name suggest it uses [SQLite][] to store data on the hard disk. SQLite is used because it turns out that the team put significant effort into making it work for [multiple processes at a time][sqlite-mp].

**Cache entries are not flushed or destroyed by default.** This ensures that even expired entries can be used if your computer is offline for a longer period of time!

[^api-context]: An API user _can_ use the `context` option to share contexts between requests.

[lru-cache]: https://en.wikipedia.org/wiki/Cache_replacement_policies#Segmented_LRU_(SLRU)
[SQLite]: https://sqlite.org/index.html
[sqlite-mp]: https://sqlite.org/faq.html#q5

## Networking

For `DNS` requests to work work in the browser context and for anonymity we use [dns-over-https][] to look-up dns entries. However, since dns-over-https providers may break and/or be unreachable it falls back to the system DNS resolving if possible.

All requests are exclusively done over https and respect [proxy settings][], for the system to also work in environments with limited network access.

[proxy settings]: https://en.wikipedia.org/wiki/HTTP_tunnel
[dns-over-https]: https://en.wikipedia.org/wiki/DNS_over_HTTPS

## Isolation of Concerns

This library in several places embraces functional programming. For example: it may be a question why the API is written `resolve(protocol, name)` instead of `protocol.resolve(name)`. While this may look like a question of taste, this structure has gradually evolved.

Below you find a diagram, illustrating two common data flows, in:

#### API

The API methods (like `resolve` or `resolveURL`) isolate the Cache, Context and Protocol from another, making sure that each only focusses on their task.

#### Cache

To accomodate browser/node environments we need different cache implementations. To prevent having to test various assumptions in the cache, its operations are as simple as possible.

#### Context

Different runtimes need to provide different contexts (eg. different fetch implementation), but the contexts also simplify operations for Protocol definitions as much as possible in order for Protocol definitions to be as minimalistic as possible to distinguish themselves from another.

#### Protocol (like `dat` or `hyper`)

To make sure that protocols can be easily tested, the protocol definitions are very reduced and isolated, they have only the context and name as input to operate on which makes them very easily testable.

_As you may have noticed: all concepts are simplified for testability. Earlier versions needed complex setup's to test even the simplest assumptions thoroughly._

[![](https://mermaid.ink/img/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG5cbiAgICBVc2VyLT4-K0FQSTogcmVzb2x2ZSgpXG4gICAgb3B0IG5vIGNvbnRleHQgZ2l2ZW5cbiAgICAgICAgQVBJLT4-QVBJOiBjcmVhdGVDb250ZXh0KClcbiAgICBlbmRcbiAgICBvcHQgb3B0cy5jYWNoZSAhPT0gbnVsbCAmJiAhb3B0cy5pZ25vcmVDYWNoZVxuICAgICAgICBBUEktPj5DYWNoZTogZ2V0KHByb3RvY29sLCBkb21haW4pXG4gICAgICAgIENhY2hlLT4-QVBJOiBbbWlzc11cbiAgICBlbmRcbiAgICBBUEktPj5Qcm90b2NvbDogcmVzb2x2ZShjb250ZXh0LCBkb21haW4pXG4gICAgUHJvdG9jb2wtPj5Db250ZXh0OiBjb250ZXh0LjxhcGk-KClcbiAgICBhbHQgaWYgYXZhaWxhYmxlOlxuICAgICAgICBDb250ZXh0LT4-UHJvdG9jb2w6IFtyZXN1bHRdXG4gICAgZWxzZVxuICAgICAgICBDb250ZXh0LT4-UHJvdG9jb2w6IFttaXNzXVxuICAgIGVuZFxuICAgIFByb3RvY29sLT4-QVBJOiBbcmVzdWx0XVxuICAgIG9wdCBvcHRzLmNhY2hlICE9PSBudWxsICYmIGVudHJ5IG5vdCBleHBpcmVkXG4gICAgICAgIE5vdGUgbGVmdCBvZiBDYWNoZTogRXZlbiB3aXRoIG9wdHMuaWdub3JlQ2FjaGUgc2V0IVxuICAgICAgICBBUEktPj5DYWNoZTogc2V0KHByb3RvY29sLCBkb21haW4sIFtyZXN1bHRdKVxuICAgIGVuZFxuICAgIEFQSS0-Pi1Vc2VyOiAocGFzcyB0aHJvdWdoKVxuXG4gICAgVXNlci0-PitBUEk6IHJlc29sdmUoKVxuICAgIEFQSS0-PkFQSTogY3JlYXRlQ29udGV4dCgpXG4gICAgQVBJLT4-Q2FjaGU6IGdldChwcm90b2NvbCwgZG9tYWluKVxuICAgIENhY2hlLT4-QVBJOiBbcmVzdWx0XVxuICAgIE5vdGUgcmlnaHQgb2YgQVBJOiByZXN1bHQgaXMgc2FuaXRpemVkIGJ5IHRoZSBBUEkgPGJyIC8-Zm9yIHNpbXBsZXIgY2FjaGUgbG9naWMuPGJyIC8-SW52YWxpZCBzdGF0ZW1lbnRzIGFyZTxici8-dHJlYXRlZCBhcyBcIm1pc3NcIlxuICAgIEFQSS0-Pi1Vc2VyOiAocGFzcyB0aHJvdWdoKVxuIiwibWVybWFpZCI6eyJ0aGVtZSI6ImRlZmF1bHQifSwidXBkYXRlRWRpdG9yIjpmYWxzZX0)](https://mermaid-js.github.io/mermaid-live-editor/#/edit/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG5cbiAgICBVc2VyLT4-K0FQSTogcmVzb2x2ZSgpXG4gICAgb3B0IG5vIGNvbnRleHQgZ2l2ZW5cbiAgICAgICAgQVBJLT4-QVBJOiBjcmVhdGVDb250ZXh0KClcbiAgICBlbmRcbiAgICBvcHQgb3B0cy5jYWNoZSAhPT0gbnVsbCAmJiAhb3B0cy5pZ25vcmVDYWNoZVxuICAgICAgICBBUEktPj5DYWNoZTogZ2V0KHByb3RvY29sLCBkb21haW4pXG4gICAgICAgIENhY2hlLT4-QVBJOiBbbWlzc11cbiAgICBlbmRcbiAgICBBUEktPj5Qcm90b2NvbDogcmVzb2x2ZShjb250ZXh0LCBkb21haW4pXG4gICAgUHJvdG9jb2wtPj5Db250ZXh0OiBjb250ZXh0LjxhcGk-KClcbiAgICBhbHQgaWYgYXZhaWxhYmxlOlxuICAgICAgICBDb250ZXh0LT4-UHJvdG9jb2w6IFtyZXN1bHRdXG4gICAgZWxzZVxuICAgICAgICBDb250ZXh0LT4-UHJvdG9jb2w6IFttaXNzXVxuICAgIGVuZFxuICAgIFByb3RvY29sLT4-QVBJOiBbcmVzdWx0XVxuICAgIG9wdCBvcHRzLmNhY2hlICE9PSBudWxsICYmIGVudHJ5IG5vdCBleHBpcmVkXG4gICAgICAgIE5vdGUgbGVmdCBvZiBDYWNoZTogRXZlbiB3aXRoIG9wdHMuaWdub3JlQ2FjaGUgc2V0IVxuICAgICAgICBBUEktPj5DYWNoZTogc2V0KHByb3RvY29sLCBkb21haW4sIFtyZXN1bHRdKVxuICAgIGVuZFxuICAgIEFQSS0-Pi1Vc2VyOiAocGFzcyB0aHJvdWdoKVxuXG4gICAgVXNlci0-PitBUEk6IHJlc29sdmUoKVxuICAgIEFQSS0-PkFQSTogY3JlYXRlQ29udGV4dCgpXG4gICAgQVBJLT4-Q2FjaGU6IGdldChwcm90b2NvbCwgZG9tYWluKVxuICAgIENhY2hlLT4-QVBJOiBbcmVzdWx0XVxuICAgIE5vdGUgcmlnaHQgb2YgQVBJOiByZXN1bHQgaXMgc2FuaXRpemVkIGJ5IHRoZSBBUEkgPGJyIC8-Zm9yIHNpbXBsZXIgY2FjaGUgbG9naWMuPGJyIC8-SW52YWxpZCBzdGF0ZW1lbnRzIGFyZTxici8-dHJlYXRlZCBhcyBcIm1pc3NcIlxuICAgIEFQSS0-Pi1Vc2VyOiAocGFzcyB0aHJvdWdoKVxuIiwibWVybWFpZCI6eyJ0aGVtZSI6ImRlZmF1bHQifSwidXBkYXRlRWRpdG9yIjpmYWxzZX0)

## Performance considerations

All `resolve` API's of hyper-dns can be cancelled and support timeouts. It uses the [AbortSignal API][] which also is used the browser's fetch operation. This is done to allow for saving resources in quick lookups of domains as may happen in a URL input bar.

The `resolveURL` and `resolve` API's have two different goals: one is to find the first matching protocol, the other to find all protocols. The cache system has been chosen to allow both operations to run at the best performance.

[AbortSignal API]: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
