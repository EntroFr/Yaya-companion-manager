# 1.1.2 安装修复验收

## 修改

`electron/main.cjs` 原先在 `electron-squirrel-startup` 正在异步创建快捷方式时又立即调用 `app.quit()`，没有等待子任务完成。现在使用 `electron/squirrel-lifecycle.cjs`，在初始化单实例锁、SQLite、IPC和窗口之前处理安装/升级/卸载/淘汰事件；快捷方式子任务结束后退出，失败非零退出，子任务最长等待10秒，避免超过 Squirrel 15秒钩子期限。`--squirrel-firstrun` 正常启动。

包名 `YayaDiary`、EXE名、AUMID、正式数据目录和业务代码保持不变。版本为1.1.2。

## 证据与限制

- 137项自动测试、lint、build、Windows打包和既有Electron集成检查通过。
- 原1.1.0两次普通安装日志包含 `Finished Squirrel Updater`；原1.1.1日志止于 `Squirrel Enabled Apps`，没有完整异常堆栈，不能仅据此断定原故障唯一根因。
- 早期临时包只改NuGet元数据：旧1.1.1安装及1.1.2升级均完成快捷方式任务和 `Finished Squirrel Updater`。发现EXE元数据仍导致覆盖原快捷方式后，已用原Update.exe恢复原快捷方式，并完善隔离脚本。
- 最终测试副本同时隔离包名、EXE名称元数据和appData：Squirrel CLI返回0并完成收尾，但日志出现被忽略的安装钩子阻止错误，**不能算完整验收通过**。
- 完整旧Setup→新Setup普通安装测试，在 `invokePostInstall` 首次启动阶段收到 `应用程序控制策略已阻止此文件`，失败弹窗导致Setup超时。Windows Code Integrity事件3077确认测试EXE未满足签名策略。本机Codex/MSIX测试环境的拦截不能直接等同于用户手动运行环境的根因。
- `isolated-cli-install.log`、`isolated-cli-update.log`、`isolated-setup-policy.txt` 保存上述隔离测试证据。
- 正式SQLite未读取或修改；真实1.1.1应用未升级或终止。隔离测试使用临时账目。

**状态：代码修复及打包完成，完整普通安装验收受系统应用控制阻止。不能宣称安装器已不再报错。**

下一步应使用满足目标Windows策略的有效代码签名，或在允许该应用的独立测试环境中重跑；不关闭或绕过应用控制策略。Forge支持Windows代码签名：https://www.electronforge.io/guides/code-signing/code-signing-windows 。本次没有可用签名证书。

复测：`scripts/squirrel-upgrade-check.ps1 -OldPackage <旧版full.nupkg> -NewPackage <新版full.nupkg>`。脚本在副本中修改品牌元数据及appData并自动关闭测试窗口，正式安装包不含这些替换；原1.1.0包当前未保留，不能宣称已使用原1.1.0二进制完整复测1.1.0→1.1.1。
