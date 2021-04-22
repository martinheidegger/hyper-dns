import { Cache } from './resolve'

declare function createCacheSQLite (options?: createCacheSQLite.Options): createCacheSQLite.CacheSQLite

namespace createCacheSQLite {
  interface CacheSQLite extends Cache {
    clear (): Promise<void>
    clearName (name: string): Promise<void>
    close (): Promise<void>
    flush (): Promise<void>
  }
  interface Options {
    maxSize?: number
    table?: string
    autoClose?: number
    maxWalSize?: number
    walCheckInterval?: number
    file?: string
  }
}

export = createCacheSQLite
