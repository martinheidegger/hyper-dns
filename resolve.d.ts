import lighturl from './light-url'
import baseCreateResolveContext, { ResolveContext } from './resolve-context'
import baseProtocols from './protocols'
import baseCreateCacheLRU from './cache-lru'

declare namespace resolve {
  interface CacheEntry {
    key: string
    expires: number
  }
  type Protocol = baseProtocols.Protocol
  type ProtocolInput = string | Protocol
  type ContextFactory = (options: ResolveOptions) => ResolveContext
  interface Cache {
    set (protocol: string, name: string, entry: CacheEntry): Promise<void>
    get (protocol: string, name: string): Promise<CacheEntry | undefined>
  }
  interface ResolveOptions {
    dohLookups?: string[]
    signal?: AbortSignal
    timeout?: number
    userAgent?: string
    cache?: Cache
    protocols?: Protocol[]
    ignoreCache?: boolean
    ignoreCachedMiss?: boolean
    ttl?: number
    minTTL?: number
    maxTTL?: number
    corsWarning?: (name: string, url: string) => void
  }
  interface ResolveURLOptions {
    fallbackProtocol?: string
    protocolPreference?: ProtocolInput[]
  }
  function resolveProtocol (ctx: ContextFactory, protocol: ProtocolInput, name: string, options?: ResolveOptions): Promise<string | null>
  function resolve (ctx: ContextFactory, name: string, options?: ResolveOptions): Promise<string | null>
  function resolveURL (ctx: ContextFactory, url: string, options?: ResolveURLOptions): Promise<lighturl.LightURL>
  const createResolveContext: typeof baseCreateResolveContext
  const createCacheLRU: typeof baseCreateCacheLRU
  const protocols: typeof baseProtocols
  
  class RecordNotFoundError extends Error {
    code: 'ENOTFOUND'
    name: string
  }
  const LightURL: typeof lighturl.LightURL
}

export = resolve