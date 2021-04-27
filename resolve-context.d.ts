import { ResolveOptions } from './resolve'

declare function createResolveContext (
  fetch: createResolveContext.Fetch,
  dnsTxtFallback: createResolveContext.DNSTxtFallback,
  opts: ResolveOptions
): createResolveContext.ResolveContext

declare namespace createResolveContext {
  interface LookupEntry {
    key: string
    ttl?: number
  }
  interface ResolveContext {
    isLocal: typeof isLocal
    matchRegex: typeof matchRegex
    getDNSTxtRecord: (name: string, textRegex: RegExp) => Promise<LookupEntry>
    fetchWellKnown: (name: string, schema: string, keyRegex: RegExp, followRedirects: number) => Promise<LookupEntry>
  }
  function isLocal (name: string): boolean
  function matchRegex (name: string, regex: RegExp): LookupEntry | undefined
  interface FetchOptions {
    signal: AbortSignal
    redirect: 'manual',
    headers: {
      Accept: 'text/plain' | 'application/dns-json',
      'User-Agent'?: string
    }
  }
  interface Response {
    headers: Map<string, string>
    status: number
    href: string
    text (): Promise<string>
  }
  type DNSTxtFallback = (name: string) => Array<{ data: string, TTL?: number }>
  type Fetch = (href: string, options: FetchOptions) => Promise<Response>
}

export = createResolveContext