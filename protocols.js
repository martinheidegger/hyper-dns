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
  async hyper (context, name) {
    let record = context.matchRegex(name, /^(?<key>[0-9a-f]{64})$/i)
    if (record !== undefined) {
      return record
    }
    if (!context.isLocal(name)) {
      const domain = `hyper-dns.${name}`
      record = await context.getDNSTxtRecord(domain, /^\s*"?(?:hyperkey)=(?<key>(?:[0-9a-f]{64}|well-known))"?\s*$/i)
      if (record === undefined) {
        return
      }
      if (record.key !== 'well-known') {
        return record
      }
    }
    const wk = await context.fetchWellKnown(name, 'hyper', /^\s*(?:(?:hyper):)?(?:\/\/)?(?<key>[0-9a-f]{64})\s*$/i, 6)
    if (wk === undefined) {
      return
    }
    if (typeof wk.ttl !== 'number') {
      wk.ttl = record.ttl
    } else if (typeof record.ttl === 'number') {
      wk.ttl = Math.min(wk.ttl, record.ttl)
    }
    return wk
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
  },
  async ara (context, name) {
    let record = context.matchRegex(name, /^(?<key>[0-9a-f]{64})$/i)
    if (record !== undefined) {
      return record
    }
    record = await context.getDNSTxtRecord(name, /^\s*"?(?:did:ara:)(?<key>[0-9a-f]{64})"?\s*$/i)
    if (record !== undefined) {
      return record
    }
    return await context.fetchWellKnown(name, 'ara', /^\s*(?:did:ara:)?(?:\/\/)?(?<key>[0-9a-f]{64})\s*$/i, 6)
  }
})
