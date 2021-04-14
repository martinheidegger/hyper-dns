module.exports = Object.freeze({
  async dat (context, name) {
    let record = context.matchRegex(name, /^(?<key>[0-9a-f]{64})$/i)
    if (record !== undefined) {
      return record
    }
    record = await context.getDNSTxtRecord(name, /^\s*"?datkey=(?<key>[0-9a-f]{64})"?\s*$/i)
    if (record !== undefined) {
      return record
    }
    return await context.fetchWellKnown(name, 'dat', /^\s*(?:(?:dat):)?(?:\/\/)?(?<key>[0-9a-f]{64})\s*$/i, 6)
  },
  async cabal (context, name) {
    let record = context.matchRegex(name, /^(?<key>[0-9a-f]{64})$/i)
    if (record !== undefined) {
      return record
    }
    record = await context.getDNSTxtRecord(name, /^\s*"?(?:cabalkey)=(?<key>[0-9a-f]{64})"?\s*$/i)
    if (record !== undefined) {
      return record
    }
    return await context.fetchWellKnown(name, 'cabal', /^\s*(?:cabal:)?(?:\/\/)?(?<key>[0-9a-f]{64})\s*$/i, 6)
  }
})
