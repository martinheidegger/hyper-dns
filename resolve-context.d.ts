/**
 * This context is used during the lookup for a name
 * to unify the logic between the different protocols
 * and to make sure that dns requests are done only once
 * per protocol.
 */
declare const createResolveContext: (
  fetch: (url: string, options: any) => Promise<any>,
  resolveTxtFallback: (domain: string) => Promise<Array<{ data: string, TTL?: number }>>,
  opts: createResolveContext.LookupContextOpts,
  signal?: AbortSignal
) => createResolveContext.LookupContext

namespace createResolveContext {
  const isLocal: (name: string) => boolean
  const matchRegex: (domain: string, regex: Regexp) => { key: string | null, ttl: null } | undefined

  interface ResolveContextOpts {
    dohLookup: string
    userAgent?: string
    corsWarning: undefined | null | ((name: string, url: string) => void)
    localPort: string
  }

  interface ResolveContext {
    /**
     * @returns true if the domain is a local domain (not to be looked up over dns-over-https)
     */
    isLocal: (domain: string) => boolean

    /**
     * Matches a domain against a given regular expression to see if the domain maybe already is a key.
     * 
     * @param domain name of the domain that may be a key
     * @param regex regex that should be matched, important: this regex needs to have a <key> group!
     */
    matchRegex: (domain: string, regex: Regexp) => { key: string | null, ttl: null } | undefined

    /**
     * Fetches the TXT records of a domain that match the given regex.
     * If the resulting key is "null" it means that no entry has been found.
     * 
     * @param domain name of the domain you are looking for
     * @param txtRegexp regex that matches the TXT keys, important: this regex needs to have a <key> group!
     */
    getDNSTxtRecord: (domain: string, txtRegexp: RegExp) => Promise<undefined | { key: string | null, ttl?: numer }>
  
    /**
     * Fetches the well-known identifier for a domain from its https location.
     * 
     * @param domain name of the domain you are looking for (mostly used for debug)
     * @param href url under which there may be a well-known txt file
     * @param keyRegex regular expression to verify the key's structure, important: this regex needs to have a <key> group!
     * @param followRedirects how many redirects to follow
     */
    fetchWellKnown: (domain: string, href: string, keyRegex: RegExp, followRedirects: number) => Promise<undefined | { key: string | null, ttl?: number }>
  }
}

export = createResolveContext
