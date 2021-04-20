const { test } = require('tape')
const { LightURL } = require('../light-url.js')
const { compareURL } = require('./helpers.js')

test('resolving maximal url', async t => {
  const url = new LightURL('foo://usr:pwd@sub.test.com+12ab:12351/hello/world?some=query#some-hash')
  const prefix = 'foo://usr:pwd@sub.test.com'
  const postfix = ':12351/hello/world?some=query#some-hash'
  compareURL(t, url, {
    protocol: 'foo:',
    host: 'sub.test.com:12351',
    hostname: 'sub.test.com',
    pathname: '/hello/world',
    search: '?some=query',
    hash: '#some-hash',
    username: 'usr',
    password: 'pwd',
    port: '12351',
    version: '12ab',
    slashes: '//',
    href: `${prefix}${postfix}`,
    versionedHref: `${prefix}+12ab${postfix}`
  })
})

test('resolving ../ and ./ in urls', async t => {
  const url = new LightURL('ftp://datproject.com/../project/some/.././other/.././foo/bar/dat')
  t.equals(url.href, 'ftp://datproject.com/project/foo/bar/dat')
  t.equals(url.hostname, 'datproject.com')
  t.equals(url.pathname, '/project/foo/bar/dat')
})

test('non-fqdn throws error', async t => {
  t.throws(() => new LightURL('datproject.org'), TypeError)
})

test('using base urls', async t => {
  t.equals((new LightURL('../dat', 'dat:datproject.com/foo/bar')).href, 'dat:datproject.com/dat')
  t.equals((new LightURL('../dat', 'dat://datproject.com/foo/bar/')).href, 'dat://datproject.com/foo/dat')
  const url = new LightURL('../dat/../query?some=query#some-hash', 'dat://usr:pwd@datproject.com+123ab:453/foo/bar/')
  compareURL(t, url, {
    protocol: 'dat:',
    host: 'datproject.com:453',
    hostname: 'datproject.com',
    pathname: '/foo/query',
    search: '?some=query',
    hash: '#some-hash',
    username: 'usr',
    password: 'pwd',
    port: '453',
    version: '123ab',
    slashes: '//',
    href: 'dat://usr:pwd@datproject.com:453/foo/query?some=query#some-hash',
    versionedHref: 'dat://usr:pwd@datproject.com+123ab:453/foo/query?some=query#some-hash'
  })
})
