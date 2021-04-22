import resolve, { Cache, ProtocolInput, ResolveOptions, ResolveURLOptions, LightURL } from './resolve'
import createCacheSQLite from './cache-sqlite'

declare const hyperdns: Omit<typeof resolve, 'resolve' | 'resolveProtocol' | 'resolveURL'> & {
  cache: Cache
  createCacheSQLite: typeof createCacheSQLite
  resolve (input: string, opts: ResolveOptions): Promise<string | null>
  resolveProtocol (protocol: ProtocolInput, input: string, opts: ResolveOptions): Promise<string | null>
  resolveURL (input: string, opts: ResolveURLOptions): Promise<typeof LightURL>
}

export = hyperdns