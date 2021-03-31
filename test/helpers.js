const debug = require('debug')('hyper-dns-test')
const https = require('https')
const pem = require('pem')

function createHttpsServer (Clazz) {
  const DEFAULT_HANDLER = (_req, res) => res.end('err')
  const serverP = new Promise((resolve, reject) => {
    pem.createCertificate(
      (err, { serviceKey: key, certificate: cert } = {}) => {
        if (err) {
          return reject(err)
        }
        const handler = (req, res) => serverP.handler(req, res)
        resolve(https.createServer({ key, cert }, handler))
      })
  })
  serverP.handler = DEFAULT_HANDLER
  let closeTimeout
  serverP.init = async (opts = {}) => {
    if (opts.key) {
      opts.keys = [opts.key]
    }
    if (opts.keys) {
      opts.json = () => ({
        Answer: opts.keys.map(key => ({ data: `datkey=${key}` }))
      })
    }
    if (opts.json) {
      serverP.handler = (req, res) => res.end(JSON.stringify(opts.json(req, res)))
    }
    if (opts.handler) {
      serverP.handler = (req, res) => opts.handler(req, res)
    }
    const server = await serverP
    if (closeTimeout) {
      clearTimeout(closeTimeout)
      closeTimeout = null
    }
    if (!server.listening) {
      await new Promise((resolve, reject) => {
        const onlisten = () => {
          server.off('error', onerr)
          resolve()
        }
        const onerr = err => {
          server.off('listening', onlisten)
          reject(err)
        }
        server.once('listening', onlisten)
        server.once('error', onerr)
        server.listen()
      })
    }
    const { port } = server.address()
    return new Clazz({
      dohLookup: `https://localhost:${port}/query`,
      wellKnownPort: port,
      debug,
      ...(opts.dns || {})
    })
  }
  serverP.reset = () => {
    serverP.handler = DEFAULT_HANDLER
    if (!closeTimeout) {
      closeTimeout = setTimeout(() => serverP.close(), 100)
    }
  }
  serverP.close = () => serverP.then(server => new Promise((resolve, reject) => {
    if (!server.listening) {
      return resolve()
    }
    const onclose = () => {
      server.off('error', onerr)
      resolve()
    }
    const onerr = err => {
      server.off('close', onclose)
      reject(err)
    }
    server.once('close', onclose)
    server.once('error', onerr)
    server.close()
  }))
  return serverP
}

async function rejects (t, p, err) {
  try {
    await p
    t.fail('not rejected')
  } catch (e) {
    if (typeof err === 'string') {
      if (e.message !== err) {
        t.fail(`rejection.message doesnt match: ${e.message} != ${err}`)
      }
    } else if (typeof err === 'function') {
      if (!(e instanceof err)) {
        t.fail(`rejection is not instance of ${err}: ${e}`)
      }
    } else if (err !== null && err !== undefined) {
      if (err !== e) {
        t.fail(`rejection doesnt match: ${e} !== ${err}`)
      }
    }
    t.pass('should reject')
  }
}

const TEST_KEYS = [
  '100c77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e',
  '200c77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e',
  '300c77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e'
]
const TEST_KEY = TEST_KEYS[0]

module.exports = {
  createHttpsServer,
  rejects,
  TEST_KEYS,
  TEST_KEY
}
