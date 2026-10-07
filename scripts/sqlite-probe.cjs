const { app } = require('electron')
app.whenReady().then(() => {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, sqlite: db.prepare('SELECT sqlite_version() AS version').get().version }))
  db.close(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
