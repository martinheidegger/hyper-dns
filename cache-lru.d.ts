import { Cache } from './resolve'

declare function createCacheLRU (options?: createCacheLRU.Options): createCacheLRU.CacheLRU

namespace createCacheLRU {
  interface CacheLRU extends Cache {
    clear (): Promise<void>
    clearName (name: string): Promise<void>
    close (): Promise<void>
    flush (): Promise<void>
  }
  interface Options {
    maxSize?: number
  }
}

export = createCacheLRU
