# hyper-dns

Advanced resolving of decentralized web links using different name systems such as DNS Txt entries and `.well-known` https lookups locations.
It implements various naming systems such as [dat][], [hyper][] and [cabal][] but is extensible to support other systems as well.

[hyper]: https://hypercore-protocol.org/
[dat]: https://www.datprotocol.com/deps/0005-dns/
[cabal]: https://cabal.chat/

## 🚀 Basic API

After installing it through [npm][hyper-dns-npm], you can simply run it like this:

```js
const { resolveProtocol, resolve, resolveURL } = require('hyper-dns')
const protocol = 'dat'
const domain = 'dat-ecosystem.org'
const key = await resolveProtocol(protocol, domain)
```

> Note: You may need to wrap it in a `async` function until [top level async/await][] lands.

That's it! 🎉 - in the `key` variable you will get the `dat` key or `null`, if it can't be found.

[hyper-dns-npm]: https://npmjs.com/package/hyper-dns
[top level async/await]: https://github.com/tc39/proposal-top-level-await

## 🧙‍♀️ What is this magic?

Different decentralized web systems have different means to resolve _"names"_ to a decentralized document.

`hyper-dns` contains a variety of implementations. Many are using [DNS TXT records][] that contain a key of specified pattern, but other means are possible as well. − (more in the [Protocol Guide][])

The power of `hyper-dns` in comparison to other, protocol-specific implementations is that it has a shared cache for all protocols, it works in he browser and does a list of things well. − (more in the [Architecture Overview][])

[DNS TXT records]: https://en.wikipedia.org/wiki/TXT_record

## 👩‍🎓 Further reading

- [Architecture Overview][] _…to learn how caching and other things work._ 🕵️‍♀️
- [API documentation][] _…for getting to know the API in detail._ 🧑‍💻
- [Contribution Guide][] _…because help is always welcome._ 🥳
- [Protocol Guide][] _…for current protocols and adding new ones._ 🤠
- [dat-dns comparison][] _…for when you feel nostaligc._

[Architecture Overview]: ./docs/architecture.md
[API documentation]: ./docs/api.md
[Contribution Guide]: ./docs/contributing.md
[Protocol Guide]: ./docs/protocol.md
[dat-dns comparison]: ./docs/dat-dns.md

## 📜 License

[MIT License](./LICENSE)
