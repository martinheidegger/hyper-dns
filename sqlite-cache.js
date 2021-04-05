const Database = require('better-sqlite3')
const fs = require('fs')

const Q_CREATE_TABLE = 'CREATE TABLE IF NOT EXISTS $table (name TEXT PRIMARY KEY NOT NULL, key TEXT, expires INTEGER NOT NULL)'
const Q_WRITE = 'REPLACE INTO $table (name, key, expires) VALUES ($name, $key, $expires)'
const Q_CLEAR_NAME = 'DELETE FROM $table WHERE name = $name'
const Q_CLEAR = 'DELETE FROM $table'
const Q_READ = 'SELECT key, expires from $table WHERE name = $name'
const Q_FLUSH = 'DELETE FROM $table WHERE expires < $now'

function createDB (file, table, debug) {
  debug('opening database %s: %s', file, table)
  const db = new Database(file)
  const query = Q_CREATE_TABLE.replace('$table', table)
  const s = db.prepare(query)
  debug(s.source)
  s.run()
  db.count = 0
  db.prepared = {}
  db.closeTimeout = null
  db.clearTimeout = () => {
    if (db.closeTimeout == null) {
      return
    }
    clearTimeout(db.closeTimeout)
    db.closeTimeout = null
  }
  return db
}

class SQLiteCache {
  constructor (opts = {}) {
    this.opts = {
      table: 'names',
      autoClose: 5000,
      debug: () => {},
      maxWalSize: 10 * 1024 * 1024, // 10 MB
      walCheckInterval: 5000, // 5s
      ...opts
    }
    this.db = null
  }

  exec (handler) {
    let { db } = this
    const { file, table, debug, autoClose } = this.opts
    if (db === null || !db.open) {
      debug('opening db')
      db = createDB(file, table, debug)
      db.pragma('journal_mode = WAL')
      const _close = db.close
      db.close = () => {
        debug('closing db')
        db.clearTimeout()
        process.off('exit', db.close)
        _close.call(db)
        clearInterval(walClearInterval)
        debug('closed')
        return db
      }
      // See https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/performance.md
      const walClearInterval = setInterval(fs.stat.bind(null, `${file}-wal`, (err, stat) => {
        if (!err && stat.size > this.opts.maxWalSize) {
          db.pragma('wal_checkpoint(RESTART)')
        }
      }), this.opts.walCheckInterval)
      process.on('exit', db.close)
      this.db = db
    }
    db.clearTimeout()
    db.count++
    try {
      return handler(db)
    } finally {
      db.count--
      if (db.open && db.count === 0 && db.closeTimeout === null) {
        db.closeTimeout = setTimeout(db.close, autoClose)
      }
    }
  }

  execStatement (query, handler) {
    return this.exec(db => {
      let statement = db.prepared[query]
      if (statement === undefined) {
        statement = db.prepare(query.replace(/\$table/g, this.opts.table))
        db.prepared[query] = statement
      }
      return handler(statement)
    })
  }

  run (query, args) {
    const { debug } = this.opts
    this.execStatement(
      query,
      statement => {
        debug('%s -- %s', statement.source, args)
        statement.run(args)
      }
    )
  }

  get (query, args) {
    const { debug } = this.opts
    return this.execStatement(
      query,
      statement => {
        debug('%s -- %s', statement.source, args)
        return statement.get(args)
      }
    )
  }

  async clear () {
    this.run(Q_CLEAR, {})
  }

  async clearName (name) {
    this.run(Q_CLEAR_NAME, { name })
  }

  async read (name) {
    return this.get(Q_READ, { name })
  }

  async write (cacheEntry) {
    this.run(Q_WRITE, cacheEntry)
  }

  async flush () {
    this.run(Q_FLUSH, { now: Date.now() })
  }

  async close () {
    const { db } = this
    if (db !== null && db.open) {
      db.close()
    }
  }
}

module.exports.SQLiteCache = SQLiteCache
