
function fetchResponse (opts = {}) {
  return {
    url: opts.url,
    status: opts.status || 200,
    headers: new Map(opts.headers),
    async text () {
      if (opts.json) {
        return JSON.stringify(opts.json)
      }
      if (opts.text) {
        return opts.text
      }
      return ''
    }
  }
}

async function rejects (t, p, err) {
  try {
    const result = await p
    t.fail('not rejected with result:' + result)
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
  fetchResponse,
  rejects,
  TEST_KEYS,
  TEST_KEY
}
