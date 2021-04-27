declare namespace lightURL {

  const urlRegex: RegExp

  interface LightURLParts {
    protocol?: string
    slashes?: string
    username?: string
    password?: string
    hostname?: string
    version?: string
    port?: string
    pathname?: string
    search?: string
    hash?: string
  }

  class LightURL {
    constructor (input: string | LightURLParts, base?: string | LightURL | null)
    protocol: string | null
    hostname: string | null
    pathname: string | null
    search: string | null
    hash: string | null
    username: string | null
    password: string | null
    port: string | null
    version: string | null
    slashes: string | null

    host: string
    href: string
    versionedHref: string

    toString (): string
    toJSON (): string
  }
}

export = lightURL