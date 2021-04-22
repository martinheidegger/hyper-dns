import lighturl from './light-url'
import baseCreateResolveContext from './resolve-context'
import baseProtocols from './protocols'
import baseCreateCacheLRU from './cache-lru'

namespace resolve {
  interface CacheEntry {
    key: string
    expires: number
  }
  type Protocol = baseProtocols.Protocol
  type ProtocolInput = string | Protocol
  type ContextFactory = (options: ProtocolOptions) => Context
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
  declare function resolveProtocol (ctx: ContextFactory, protocol: ProtocolInput, name: string, options?: ResolveOptions): Promise<string | null>
  declare function resolve (ctx: ContextFactory, name: string, options?: ResolveOptions): Promise<string | null>
  declare function resolveURL (ctx: ContextFactory, url: string, options?: ResolveURLOptions): Promise<BaseLightURL>
  declare const createCacheLRU: typeof createCacheLRU
  declare const createResolveContext: typeof baseCreateResolveContext
  declare const createCacheLRU: typeof baseCreateCacheLRU
  declare const protocols: typeof baseProtocols
  
  declare class RecordNotFoundError extends Error {
    code: 'ENOTFOUND'
    name: string
  }
  declare const LightURL: typeof lighturl.LightURL
}

export = resolve