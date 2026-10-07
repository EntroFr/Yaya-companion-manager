截图统一放在此目录，使用以下文件名：
download-page.png（步骤1 下载软件）
portable-folder.png（步骤2 解压）
dashboard.png（步骤3 启动）
add-boss.png（步骤5 添加老板）
recharge.png（步骤7 充值）
active-order.png（步骤8 开始订单）
history.png（步骤13 历史）
statistics.png（步骤14 统计）
data-management.png（步骤15 Excel、步骤16 备份共用）
active-order.png（步骤8、9、10、11 共用）
tip.png（步骤12 打赏）
uninstall.png（保留资源，不接入官网教程）

已有 download-page.png 为官网实际截图；dashboard、add-boss、recharge、active-order、history、statistics、data-management、tip、uninstall 已由隔离 Electron + 临时 SQLite 演示环境自动截图（1920×1080）。portable-folder.png 尚缺，需要真实文件资源管理器截图。数据管理图的临时路径已隐藏；卸载图仅停在确认页，未执行卸载。
没有文件或加载失败时仍显示占位，其他未配置的步骤同样保持占位。
建议 960×540 或 1920×1080；页面按16:9区域等比容纳，支持点击放大。
可直接替换同名 PNG，新增文件后重启 dev server 并重新 build。
更换文件名或格式时，同步修改 src/content.js 中对应步骤的 screenshot。
公开软件截图请使用虚构资料，不要包含真实账务、个人信息或文件路径。

统一演示命名规范
所有官网截图、演示图和占位示例，人物昵称只使用“丫丫”；带 ID 时统一为“YAYA-01 丫丫”。请使用独立测试资料，不要为了截图修改真实数据库。

截图拍摄与替换清单
portable-folder.png：完整解压后的文件资源管理器，展示 YayaDiary.exe、resources 等同级文件；隐藏个人用户名和私人路径。
dashboard.png：首页工作台，包含左侧导航、当前订单和快捷操作，展示提示音开关。
add-boss.png：新增老板弹窗，展示 ID YAYA-01、昵称丫丫、单价输入和保存按钮。
recharge.png：丫丫的充值弹窗，展示当前余额、充值金额、备注和确认按钮。
active-order.png：进行中的当前订单卡片，展示服务时长、实时消费、预计余额、剩余时间和暂停/结束按钮。
history.png：老板管理的历史区域，展示日期筛选、订单历史、余额流水及展开按钮；使用虚构历史数据。
statistics.png：收入统计页面，展示今日/本周/本月切换和核心指标，避免真实账务信息。
data-management.png：数据管理页面，展示数据库信息、备份/恢复、每日自动备份、Excel 状态和打开目录按钮；隐藏个人路径。
tip.png：记录打赏弹窗，展示 YAYA-01 丫丫、虚构金额20.00、发生时间和备注。
uninstall.png 保留，但官网教程不再提供卸载步骤。

建议所有新截图为1920×1080或960×540，保持文字清晰；尽量截完整窗口，弹窗连同必要背景一起截。不要裁掉操作按钮、警告或重要金额。组件使用等比容纳，非16:9图片也不会被拉伸或裁切关键内容。

test-mode.png（步骤6 测试模式）：隔离临时SQLite演示环境，新增老板弹窗开启测试模式，示例YAYA-01 丫丫。
