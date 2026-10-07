// 只改临时验收副本的名称和 appData；正式产物不调用此脚本。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as PE from 'pe-library'
import * as RE from 'resedit'
import { createRequire } from 'node:module'
const asar = createRequire(import.meta.url)('@electron/asar')
const [exeFile, asarFile, root, title] = process.argv.slice(2)
if (!fs.realpathSync.native(root).toLowerCase().startsWith(path.join(fs.realpathSync.native(os.tmpdir()), 'yaya-squirrel-check-').toLowerCase())) throw Error('只允许临时验收目录。')
const exe = PE.NtExecutable.from(fs.readFileSync(exeFile))
const resources = PE.NtExecutableResource.from(exe)
for (const info of RE.Resource.VersionInfo.fromEntries(resources.entries)) {
  info.setStringValues({lang:1033,codepage:1200}, {FileDescription:title, ProductName:title, CompanyName:title})
  info.outputToResourceEntries(resources.entries)
}
resources.outputResource(exe)
fs.writeFileSync(exeFile, Buffer.from(exe.generate()))
const extracted = fs.mkdtempSync(path.join(root, 'asar-fixture-'))
asar.extractAll(asarFile, extracted)
const mainFile = path.join(extracted, 'electron/main.cjs')
const appData = path.join(root, 'isolated-app-data')
fs.mkdirSync(appData,{recursive:true})
const prefix = `require('electron').app.setPath('appData',${JSON.stringify(appData)}); require('electron').app.once('ready',()=>{setTimeout(()=>require('electron').app.quit(),20000)});\n`
fs.writeFileSync(mainFile,prefix+fs.readFileSync(mainFile,'utf8'))
await asar.createPackage(extracted, asarFile)
