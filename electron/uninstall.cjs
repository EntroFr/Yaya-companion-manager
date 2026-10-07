const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

function noLinks(target) {
  let current = path.resolve(target)
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('卸载路径不能经过链接目录。')
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}
function validatePlan(plan) {
  const program = path.resolve(plan.programDirectory), data = path.resolve(plan.dataDirectory)
  const expected = path.join(path.resolve(plan.appData), 'Yaya-companion-manager')
  const lowerProgram = program.toLowerCase(), lowerData = data.toLowerCase()
  if (data.toLowerCase() !== expected.toLowerCase() || lowerProgram === lowerData || lowerData.startsWith(lowerProgram + path.sep) || lowerProgram.startsWith(lowerData + path.sep)) throw Error('卸载目录范围不安全。')
  const protectedPaths = [plan.appData, plan.home, plan.desktop, plan.temp, ...(plan.protectedDirectories ?? []), process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => path.resolve(p).toLowerCase())
  if (program === path.parse(program).root || protectedPaths.some(p => p === program.toLowerCase() || p.startsWith(program.toLowerCase() + path.sep))) throw Error('不能删除系统目录或共享目录。')
  if (path.basename(plan.exe).toLowerCase() !== 'yayadiary.exe' || path.resolve(plan.exe) !== path.join(program, 'YayaDiary.exe')) throw Error('不是独立 Portable 程序目录。')
  if (fs.existsSync(path.join(program, 'Update.exe')) || fs.existsSync(path.join(path.dirname(program), 'Update.exe'))) throw Error('安装器版本不能使用 Portable 卸载。')
  noLinks(program); noLinks(data)
  const manifest = JSON.parse(fs.readFileSync(path.join(program, 'resources', 'app.asar', 'package.json'), 'utf8'))
  if (manifest.name !== 'yaya-companion-manager' || manifest.main !== 'electron/main.cjs') throw Error('无法确认 Portable 程序身份。')
  return { ...plan, programDirectory: program, dataDirectory: data }
}

function helperScript(plan) {
  const encoded = Buffer.from(JSON.stringify(plan), 'utf8').toString('base64')
  return `$ErrorActionPreference = 'Stop'
$plan = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$failures = New-Object 'System.Collections.Generic.List[string]'
function Log($text) { Add-Content -LiteralPath $plan.logFile -Value ((Get-Date -Format o) + ' ' + $text) -Encoding UTF8 }
function Assert-NoLink($target) {
  $cursor = [IO.Path]::GetFullPath($target)
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '路径存在重解析点，拒绝删除' }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }; $cursor = $parent
  }
}
function Delete-Directory($target) {
  if (-not (Test-Path -LiteralPath $target)) { return }
  Assert-NoLink $target
  $links = Get-ChildItem -LiteralPath $target -Force -Recurse | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
  if ($links) { throw '目录中存在链接，已停止删除以保护其他文件' }
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try { Remove-Item -LiteralPath $target -Recurse -Force; Log ('已删除 ' + $target); return }
    catch { if ($attempt -eq 4) { throw }; Start-Sleep -Milliseconds 1000 }
  }
}
try {
  $expected = [IO.Path]::Combine([IO.Path]::GetFullPath($plan.appData), 'Yaya-companion-manager')
  if ([IO.Path]::GetFullPath($plan.dataDirectory) -ne $expected) { throw '用户数据目录校验失败' }
  if ([IO.Path]::GetFullPath($plan.exe) -ne [IO.Path]::Combine([IO.Path]::GetFullPath($plan.programDirectory), 'YayaDiary.exe')) { throw '程序目录校验失败' }
  $program = [IO.Path]::GetFullPath($plan.programDirectory).TrimEnd('\\')
  $data = [IO.Path]::GetFullPath($plan.dataDirectory).TrimEnd('\\')
  if ($program -eq [IO.Path]::GetPathRoot($program).TrimEnd('\\') -or $program -eq $data -or $program.StartsWith($data + '\\', [StringComparison]::OrdinalIgnoreCase) -or $data.StartsWith($program + '\\', [StringComparison]::OrdinalIgnoreCase)) { throw '删除范围校验失败' }
  foreach ($protected in @($plan.home, $plan.desktop, $plan.temp, $plan.appData, $env:SystemRoot, $env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) + @($plan.protectedDirectories)) {
    if ($protected) {
      $full = [IO.Path]::GetFullPath($protected).TrimEnd('\\')
      if ($program -eq $full -or $full.StartsWith($program + '\\', [StringComparison]::OrdinalIgnoreCase)) { throw '共享目录不能卸载' }
    }
  }
  Assert-NoLink $plan.programDirectory; Assert-NoLink $plan.dataDirectory
  Set-Content -LiteralPath ($plan.logFile + '.ready') -Value 'ready' -Encoding UTF8
  if ($plan.requireActivation) {
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path -LiteralPath ($plan.logFile + '.go'))) {
      if ((Get-Date) -gt $deadline) { throw '主程序未确认 helper 就绪，未执行删除' }
      Start-Sleep -Milliseconds 100
    }
  }
  $parent = Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue
  Log ('等待进程 ' + $plan.parentPid + '，开始时间 ' + $(if ($parent) { $parent.StartTime.ToUniversalTime().Ticks.ToString() } else { '已退出' }) + '，预期 ' + $plan.parentStarted)
  if ($parent -and $parent.StartTime.ToUniversalTime().Ticks.ToString() -eq $plan.parentStarted) {
    if (-not $parent.WaitForExit(180000)) { throw '应用尚未退出，未执行删除，请关闭应用后重试' }
  }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @($plan.desktop, $plan.startMenu) + @($plan.additionalShortcutDirectories)) {
    if (-not $folder) { continue }
    if (Test-Path -LiteralPath $folder) {
      Assert-NoLink $folder
      foreach ($shortcut in (Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -Force)) {
        try {
          if ($shell.CreateShortcut($shortcut.FullName).TargetPath -eq $plan.exe) {
            Remove-Item -LiteralPath $shortcut.FullName -Force; Log ('已删除快捷方式 ' + $shortcut.FullName)
          }
        } catch { $failures.Add('快捷方式：' + $_.Exception.Message) }
      }
      foreach ($name in @('YayaDiary', 'Yaya的陪玩日记', '丫丫的陪玩日记')) {
        $ownFolder = Join-Path $folder $name
        if (Test-Path -LiteralPath $ownFolder) {
          Assert-NoLink $ownFolder
          foreach ($shortcut in (Get-ChildItem -LiteralPath $ownFolder -Filter '*.lnk' -File -Force)) {
            if ($shell.CreateShortcut($shortcut.FullName).TargetPath -eq $plan.exe) { Remove-Item -LiteralPath $shortcut.FullName -Force }
          }
        }
      }
    }
  }
  foreach ($target in @($plan.programDirectory, $plan.dataDirectory)) {
    try { Delete-Directory $target } catch { $failures.Add($target + '：' + $_.Exception.Message) }
  }
} catch { $failures.Add($_.Exception.Message) }
if ($failures.Count -gt 0) {
  Log ($failures -join [Environment]::NewLine)
  if (-not $plan.silent) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(('部分文件未能删除，请关闭占用程序后手动处理。日志：' + $plan.logFile + [Environment]::NewLine + ($failures -join [Environment]::NewLine)), '卸载未完全完成') | Out-Null
  }
  exit 1
}
Log '卸载完成'
exit 0`
}

function launchHelper(plan, spawnProcess = spawn) {
  const script = helperScript({ ...plan, requireActivation: true })
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const commandFile = plan.logFile + '.command.txt'
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  if (encoded.length > 28000) throw Error('卸载路径过长，已停止以保护资料。')
  fs.writeFileSync(commandFile, encoded, 'ascii')
  const bootstrap = `Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',(Get-Content -LiteralPath '${commandFile.replaceAll("'", "''")}' -Raw))`
  return new Promise((resolve, reject) => {
    let timer, timeout, finished = false
    function finish(error) { if (finished) return; finished = true; clearInterval(timer); clearTimeout(timeout); if (error) reject(error); else { child.unref(); resolve() } }
    // 用 Windows 的 Start-Process 建立独立 helper，避免主程序退出时被连带结束。
    const child = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' })
    child.once('error', finish)
    child.once('exit', code => { if (code !== 0) finish(Error(`卸载 helper 未就绪（${code}），未退出应用。`)) })
    child.once('spawn', () => {
      timer = setInterval(() => { if (fs.existsSync(plan.logFile + '.ready')) { try { fs.writeFileSync(plan.logFile + '.go', 'go'); finish() } catch (error) { finish(error) } } }, 100)
      timeout = setTimeout(() => { child.kill(); finish(Error('卸载 helper 启动超时，未退出应用。')) }, 10000)
    })
  })
}
function registerUninstallIPC({ app, ipcMain, whenIdle, quit = () => app.quit(), launch = launchHelper, makePlan, parentStart }) {
  let client, pending = false
  const plan = () => validatePlan(makePlan ? makePlan() : { programDirectory: path.dirname(process.execPath), exe: process.execPath, appData: app.getPath('appData'), dataDirectory: path.join(app.getPath('appData'), 'Yaya-companion-manager'), home: app.getPath('home'), desktop: app.getPath('desktop'), temp: app.getPath('temp'), startMenu: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), protectedDirectories: ['downloads', 'documents', 'pictures', 'music', 'videos'].map(name => app.getPath(name)), additionalShortcutDirectories: [process.env.PUBLIC && path.join(process.env.PUBLIC, 'Desktop'), process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')].filter(Boolean) })
  function status() {
    if (!app.isPackaged || process.platform !== 'win32') return { available: false, message: '仅打包后的 Windows Portable 可以执行卸载，开发模式只供预览。' }
    try { plan(); return { available: true, message: '' } } catch (error) { return { available: false, message: error.message } }
  }
  for (const method of ['status', 'execute']) ipcMain.handle('yaya:uninstall:' + method, async event => {
    try {
      if (!client || client.contents !== event.sender || event.senderFrame !== event.sender.mainFrame) throw Error('无权执行卸载。')
      const url = new URL(event.senderFrame.url)
      if (url.origin !== client.url.origin || url.pathname !== client.url.pathname || url.search !== client.url.search) throw Error('无权执行卸载。')
      if (method === 'status') return { ok: true, value: status() }
      const current = status(); if (!current.available) throw Error(current.message)
      if (pending) throw Error('卸载已经启动，请稍候。')
      pending = true
      await whenIdle()
      const validated = plan()
      const helperDirectory = fs.mkdtempSync(path.join(app.getPath('temp'), 'yaya-uninstall-'))
      const parentStarted = parentStart ? parentStart() : require('node:child_process').execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`], { windowsHide: true, encoding: 'utf8' }).trim()
      await launch({ ...validated, parentPid: process.pid, parentStarted, logFile: path.join(helperDirectory, 'uninstall.log') })
      setTimeout(quit, 200)
      return { ok: true, value: null }
    } catch (error) { pending = false; console.error('卸载：', error.message); return { ok: false, message: error.message || '卸载启动失败，应用和资料保持不变。' } }
  })
  return { attach(win, target) { client = { contents: win.webContents, url: new URL(target) } }, dispose() { for (const method of ['status', 'execute']) ipcMain.removeHandler('yaya:uninstall:' + method) } }
}
module.exports = { validatePlan, helperScript, launchHelper, registerUninstallIPC }
