param([string]$OldPackage, [string]$NewPackage)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('yaya-squirrel-check-' + [Guid]::NewGuid().ToString('N'))
$testName = 'YayaInstallCheck' + [DateTime]::Now.ToString('yyyyMMddHHmmss')
$stage = Join-Path $testRoot 'SquirrelTemp'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../node_modules/electron-winstaller/vendor/Squirrel.exe') -Destination (Join-Path $stage 'Update.exe')
function Prepare-Package([string]$InputFile, [string]$Folder) {
  New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  $base = [IO.Path]::GetFileName($InputFile)
  $version = [regex]::Match($base, '(\d+\.\d+\.\d+)').Value
  if (-not $version) { throw '测试包版本缺失。' }
  $target = Join-Path $Folder "$testName-$version-full.nupkg"
  Copy-Item -LiteralPath $InputFile -Destination $target
  $archive = [IO.Compression.ZipFile]::Open($target, [IO.Compression.ZipArchiveMode]::Update)
  try {
    # 快捷方式名称来自 EXE 元数据，不是 NuGet title；必须同时隔离。
    $fixture = Join-Path $testRoot "fixture-$version"
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    $exeEntry = $archive.GetEntry('lib/net45/YayaDiary.exe')
    $asarEntry = $archive.GetEntry('lib/net45/resources/app.asar')
    $exePath = Join-Path $fixture 'YayaDiary.exe'; $asarPath = Join-Path $fixture 'app.asar'
    [IO.Compression.ZipFileExtensions]::ExtractToFile($exeEntry,$exePath,$true)
    [IO.Compression.ZipFileExtensions]::ExtractToFile($asarEntry,$asarPath,$true)
    node (Join-Path $PSScriptRoot 'isolate-squirrel-fixture.mjs') $exePath $asarPath $testRoot $testName
    if ($LASTEXITCODE -ne 0) { throw '隔离 EXE / appData 失败。' }
    $exeEntry.Delete(); $asarEntry.Delete()
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$exePath,'lib/net45/YayaDiary.exe') | Out-Null
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$asarPath,'lib/net45/resources/app.asar') | Out-Null
    $entry = @($archive.Entries | Where-Object FullName -Like '*.nuspec')[0]
    $reader = [IO.StreamReader]::new($entry.Open()); $xml = [xml]$reader.ReadToEnd(); $reader.Dispose()
    $xml.package.metadata.id = $testName
    $xml.package.metadata.title = $testName
    $xml.package.metadata.authors = $testName
    $manifestName = $entry.FullName
    $entry.Delete()
    $writer = [IO.StreamWriter]::new($archive.CreateEntry($manifestName).Open())
    $writer.Write($xml.OuterXml); $writer.Dispose()
  } finally { $archive.Dispose() }
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash
  $size = (Get-Item -LiteralPath $target).Length
  Set-Content -LiteralPath (Join-Path $Folder 'RELEASES') -Value "$hash $testName-$version-full.nupkg $size" -Encoding ascii
  return $version
}
$oldSource = Join-Path $testRoot 'old'; $newSource = Join-Path $testRoot 'new'
$oldVersion = Prepare-Package $OldPackage $oldSource
$newVersion = Prepare-Package $NewPackage $newSource
# 静默安装仍执行 install 钩子及完整收尾，但不自动启动正常业务应用。
$install = Start-Process -FilePath (Join-Path $stage 'Update.exe') -ArgumentList @('--install', $oldSource, '--silent') -WindowStyle Hidden -PassThru
if (-not $install.WaitForExit(60000)) { Stop-Process -Id $install.Id; throw "旧版隔离安装超时：$testRoot" }
if ($install.ExitCode -ne 0) { throw "旧版隔离安装失败 $($install.ExitCode)：$testRoot" }
$installed = Join-Path $testRoot $testName
if (-not (Test-Path -LiteralPath (Join-Path $installed "app-$oldVersion/YayaDiary.exe"))) { throw '安装路径未严格隔离，停止测试。' }
node (Join-Path $PSScriptRoot 'squirrel-fixture-data.cjs') $testRoot seed
if ($LASTEXITCODE -ne 0) { throw '隔离账目准备失败。' }
$update = Start-Process -FilePath (Join-Path $installed 'Update.exe') -ArgumentList @('--update', $newSource) -WindowStyle Hidden -PassThru
if (-not $update.WaitForExit(60000)) { Stop-Process -Id $update.Id; throw "新版隔离升级超时：$testRoot" }
if ($update.ExitCode -ne 0) { throw "新版隔离升级失败 $($update.ExitCode)：$testRoot" }
$logs = Get-ChildItem -LiteralPath $stage,$installed -Filter 'Squirrel-*.log'
$text = ($logs | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
if ($text -notmatch 'Finished Squirrel Updater' -or $text -notmatch 'fixPinnedExecutables' -or -not (Test-Path -LiteralPath (Join-Path $installed "app-$newVersion/YayaDiary.exe"))) { throw "升级收尾校验失败：$testRoot" }
if ($text -match "Couldn't run Squirrel hook|应用程序控制策略已阻止|Finished with unhandled exception") { throw "隔离升级包含钩子或系统拦截错误，不能按退出码0判定通过：$testRoot" }
# 构建临时测试 Setup，覆盖有界面的最后首次启动阶段；名称、快捷方式和 appData 都已隔离。
foreach ($fixtureVersion in @($oldVersion,$newVersion)) {
  $bootstrap = Join-Path $testRoot "bootstrap-$fixtureVersion"
  $source = if ($fixtureVersion -eq $oldVersion) { $oldSource } else { $newSource }
  New-Item -ItemType Directory -Path $bootstrap -Force | Out-Null
  $rawPackage = Join-Path $testRoot "$testName-$fixtureVersion.nupkg"
  Copy-Item -LiteralPath (Join-Path $source "$testName-$fixtureVersion-full.nupkg") -Destination $rawPackage
  $maker = Start-Process -FilePath (Join-Path $PSScriptRoot '../node_modules/electron-winstaller/vendor/Squirrel.exe') -ArgumentList @('--releasify',$rawPackage,'--releaseDir',$bootstrap,'--no-msi','--no-delta') -WindowStyle Hidden -PassThru
  if (-not $maker.WaitForExit(120000)) { Stop-Process -Id $maker.Id; throw '隔离 Setup 构建超时。' }
  if ($maker.ExitCode -ne 0) { throw "隔离 Setup 构建失败：$testRoot" }
}
# Setup 自身仍使用 Windows 正常的 SquirrelTemp，唯一测试包名避免访问正式安装目录。
$oldSetup = Start-Process -FilePath (Join-Path $testRoot "bootstrap-$oldVersion/Setup.exe") -ArgumentList '--silent' -WindowStyle Hidden -PassThru
if (-not $oldSetup.WaitForExit(60000)) { Stop-Process -Id $oldSetup.Id; throw '旧版隔离 Setup 超时。' }
if ($oldSetup.ExitCode -ne 0) { throw '旧版隔离 Setup 失败。' }
$setup = Start-Process -FilePath (Join-Path $testRoot "bootstrap-$newVersion/Setup.exe") -WindowStyle Hidden -PassThru
if (-not $setup.WaitForExit(60000)) { Stop-Process -Id $setup.Id; throw "隔离 Setup 运行超时：$testRoot" }
if ($setup.ExitCode -ne 0) { throw "隔离 Setup 运行失败：$testRoot" }
Start-Sleep -Seconds 25
node (Join-Path $PSScriptRoot 'squirrel-fixture-data.cjs') $testRoot verify
if ($LASTEXITCODE -ne 0) { throw '升级后隔离账目不一致。' }
[pscustomobject]@{ root=$testRoot; name=$testName; old=$oldVersion; new=$newVersion; installExit=0; updateExit=0; setupExit=0; finished=$true; realApplicationDataOpened=$false; isolatedDataRetained=$true; fixtureOverrides='临时副本只替换包名、EXE名称元数据和appData，首次启动20秒后自动正常退出' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'result.json')
Get-Content -LiteralPath (Join-Path $testRoot 'result.json')
