# Yaya的陪玩日记

## 当前稳定开发基线：1.1.2

日常使用和开发验证的推荐运行方式：

```powershell
pnpm electron:local:formal
```

该命令构建本地页面并通过现有 Electron 运行环境启动 SQLite 正式模式，不需要 Vite localhost。正式数据库位于 `%APPDATA%\Yaya-companion-manager\sqlite\yaya-companion.db`，独立于源码和程序目录。数据库、依赖、构建产物和发布包不属于 Git 备份；请在“数据管理”中单独备份账目。

当前安装包及 Portable 未签名 EXE 可能被 Windows 11 Smart App Control / Code Integrity 阻止。当前阶段暂停安装逻辑、Portable 发布、安全策略与代码签名工作，以源码开发运行方式为主。下文相关发布与失败验收说明为历史记录。

完整检查：`pnpm test`、`pnpm lint`、`pnpm build`、`pnpm electron:test`。Electron 集成检查使用隔离测试数据库验证正式模式、备份恢复和刷新持久化，不操作正式业务数据。只读检查正式库可运行 `node scripts/check-formal-database.mjs`；该脚本不创建、迁移或修改数据库。

本次基线提交完成后，后续新功能从 `v1.1.2-stable` 创建新分支；版本仍为1.1.2。本阶段不重新打包安装程序。

React + TypeScript + Vite 本地单用户 Windows 应用，支持浏览器与 Electron 桌面运行，当前版本 1.1.2。
已完成老板资料、余额充值/调整、只读余额流水、订单生命周期、计时、结束订单一次性结算、打赏和今日/本周/本月统计。开发时保留三种独立数据源；Windows 安装版默认使用 SQLite 正式库，首次启动创建空库。已有旧资料需要自行导出并在“数据迁移”校验后导入，原资料不会被删除。以下阶段记录包含历史行为，以文末 1.1.0 说明为准。

## 启动与检查

建议使用 Node.js 24 LTS 和新版 Chrome/Edge，在项目目录运行：

```powershell
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm build
```

浏览器打开终端打印的网址。日常应用通常为 http://127.0.0.1:5173/；请持续使用同一浏览器、主机名和端口，localStorage 按来源区分。清除浏览器数据会丢失资料。
如果没有 pnpm，安装 Node.js 后可执行 `npm install --global pnpm`。
Codex 提供的 pnpm 不在 PATH，可以用下面的完整路径，将 dev 替换为 test、lint、build 等：

```powershell
& 'C:\Users\Administraror\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' dev
```

## 数据与结构

- src/features/storage/appStore.ts：统一 v3 存储、迁移和数据一致性校验。当前键为 `yaya-diary:app:v3`。
- src/features/storage/dataLock.ts：所有数据变更共用浏览器 Web Locks 互斥锁，防止多标签页结算或充值互相覆盖。
- src/features/bosses/types.ts、bossRepository.ts：老板资料、整数分余额、流水和负余额清零接口。
- src/features/balance/BossBalance.tsx：余额、充值、调整、欠费清零二次确认与流水。
- src/features/orders/types.ts：订单、暂停和结算字段。
- src/features/orders/orderTime.ts：时间戳推导有效服务时长。
- src/features/orders/billing.ts：集中计费、累计舍入、结算周期及超时换算。
- src/features/orders/orderRepository.ts：生命周期、每15分钟结算与结束补结算。
- src/features/orders/orderStorage.ts：迁移前 v1 订单的读取与生命周期格式校验。
- src/features/orders/useOrders.ts：应用级数据恢复、自动结算检查与跨页同步。
- src/features/orders/CurrentOrder.tsx：当前订单、费用、余额、欠费提示及结束确认。
- src/features/orders/BossOrderHistory.tsx：只读订单历史、最终费用、结束余额和原因。
- src/pages/bosses/BossesPage.tsx：老板列表与详情，数据变更后同步余额。
- src/pages/dashboard/Dashboard.tsx、src/app/App.tsx、src/components/layout/AppLayout.tsx：首页与公共页面结构。
- src/utils/money.ts、src/styles/global.css：统一金额显示、粉白色设计变量与响应式布局。
- tests/*.test.mts：老板、余额、订单、计费、数据管理及打赏测试，共72项。
- tests/fixtures/billing-restore.html：仅限隔离端口5175的快速恢复测试夹具，不进入生产构建。

已有 v1 老板、v2 账户及 v1 订单会自动迁移；旧键保留作为迁移前备份，并非实时备份。第四阶段已结束订单保留为「阶段四历史订单（未计费）」，不追扣费用，结束余额显示未记录。迁移时尚未结束的订单按原始开始/暂停记录补齐应结算费用。
老板 ID 手动输入、去首尾空格、区分大小写，创建后锁定。已有流水或订单的老板不能直接删除。

## 计费规则

1. 订单使用开始时保存的单价快照；修改老板当前单价不影响本单。新单仍要求余额和单价大于零。
2. 有效服务时长 = 当前/结束时间 − 开始时间 − 暂停区间总时长。计费使用完整秒数（不足1秒不计入）。setInterval只刷新显示和检查已到达的结算点，不累加真实时长。
3. 每累计900秒有效服务结算一次。未打开页面时没有后台程序扣费，恢复时依据时间戳补齐所有未结算周期。暂停期间不产生新的有效秒数。
4. 统一累计费用 = 四舍五入(单价分 × 有效服务秒数 ÷ 3600)。使用BigInt整数运算，中点进1分；本次扣费 = 新累计费用 − 已结算费用。避免各段独立舍入产生误差。
5. 订单保存settledServiceSeconds及settledAmountCents。余额、订单标记和消费流水放在同一个v3对象中，一次setItem提交；读写共享同一把锁。刷新、多个页面检查都不会重复结算。
6. 订单消费允许余额为负数，仍继续计时和15分钟结算，不自动暂停或结束。金额始终为安全整数分，并校验溢出。手动扣除沿用余额不足拦截，充值和手动增加可以直接补负余额。
7. 手动结束先补齐所有15分钟点，再结算不足15分钟的剩余部分；记录最终费用、结束时余额和「用户手动结束」。不清零欠费。
8. 超时分钟 = 欠费分 ÷ 本单单价分 × 60，按已入账的负余额换算。卡片的预计总消费含尚未入账的费用；预计还能服务时间扣除了这些未结算费用。
9. 清零只在余额为负数时可用，经确认生成debt_clear流水（前余额、正调整额、后余额零、时间、备注）。后续充值、清零不改写订单历史中的结束余额。
10. 每次结算生成order_consumption流水，含老板ID、订单ID、前后余额、金额变化、结算到的秒数、时间与备注。极低单价导致某周期费用为0分时仍保留流水和进度。

## 详细手动测试

1. 新增老板A，单价¥35.00/小时，充值¥5.00；从详情开始订单。
2. 有效服务满15分钟后，已结算金额应为¥8.75，余额为-¥3.75，订单仍进行，显示超时提示。按余额换算超时约6.43分钟。
3. 刷新或切换页面，余额不应再次被扣，流水只有一条15分钟消费。
4. 暂停约1分钟，观察服务时长、预计费用和结算倒计时不变；继续后恢复计时。暂停时间不能用于凑满15分钟。
5. 把老板当前单价改成¥70.00，本单仍为¥35.00。有效服务满30分钟时累计结算¥17.50，只新增第二段¥8.75流水。
6. 单独开一笔订单，服务23分钟时手动结束（可暂停后再确认，固定有效秒数）。单价35时总消费应为¥13.42，若已扣¥8.75，补扣¥4.67。结束历史显示最终有效时间、原单价、费用、结束时余额和原因。
7. 结束时如果欠费，检查负余额没有被清零。充值或手动增加直接加回余额，例如-¥10.00充值¥20.00后为¥10.00。
8. 对仍有欠费的老板点击「清零负余额」，先取消，余额不变；再确认，余额归零并新增「欠费清零」流水。刷新后流水仍在，历史结束余额保持原值。
9. 开始一单后关闭页面超过30分钟，再打开。应补齐所有未执行15分钟点，分别留流水；再次刷新不重复收费。
10. 订单历史和余额流水没有编辑或删除入口；已有未结束订单不能开始第二单。

### 快速恢复测试（无需等待15分钟）

仅在隔离端口使用测试夹具，日常5173资料不受影响：

```powershell
pnpm dev --host 127.0.0.1 --port 5175 --strictPort
```

打开 http://127.0.0.1:5175/tests/fixtures/billing-restore.html ，点击准备测试订单。夹具通过注入开始时间模拟已服务23分钟，不修改系统时间。应用恢复后立即补结算15分钟，余额从¥5.00变成-¥3.75；可继续测试暂停、刷新、结束补结算、充值及清零。由于实际操作经过数秒，最终消费会略高于恰好23分钟的¥13.42。

后续SQLite迁移应将余额、流水和订单结算放在同一个数据库事务中，保持订单ID、唯一ID和流水关联约束。

## 老板昵称与搜索

老板 ID 仍必填、唯一且创建后锁定；昵称选填并允许重复，空昵称显示「未填写昵称」。老板列表的搜索同时匹配 ID 和原始昵称，忽略大小写并支持部分文字匹配；清空搜索恢复全部列表，详情及充值、订单操作不受搜索影响。操作按钮提示包含老板 ID，避免重复昵称混淆。首页已改为日常工作台，提供快捷开始、充值、新增和老板快速搜索。

测试：创建两个相同昵称和一个无昵称老板；分别搜索 ID 片段、昵称片段及大小写不同的英文；确认无结果提示及清空搜索恢复。刷新后无昵称资料应保留，充值、开始订单仍正常。


## 首页工作台

主要组件：

- src/pages/dashboard/Dashboard.tsx：日常工作台、快捷操作及老板快速搜索。
- src/features/bosses/BossPicker.tsx：首页快速搜索和两个快捷操作共用的老板选择器，调用原searchBosses函数。
- src/features/bosses/BossForm.tsx：从老板页面抽出的新增/编辑表单，首页与老板管理共用。
- src/features/balance/RechargeForm.tsx：首页和老板详情共用的充值表单，仍通过bossRepository.changeBalance生成原有流水。
- src/components/dialog/Modal.tsx：粉白色公共弹窗，支持Esc关闭及键盘焦点约束。
- src/app/navigation.ts：通过编码后的唯一老板ID进入详情，支持中文、斜杠等特殊字符。
- src/app/App.tsx、src/pages/bosses/BossesPage.tsx：识别详情地址、自动选择并滚动到老板详情。
- src/features/orders/CurrentOrder.tsx：首页没有订单时显示空状态；已有订单继续使用原卡片。
- src/features/orders/useOrders.ts：开始订单返回成功标记，让快捷弹窗只在成功时关闭；原状态校验和计费逻辑不变。
- tests/navigation.test.mts：验证详情ID编码和刷新地址恢复。

手动测试：

1. 进入首页，无订单时应显示「当前没有进行中的订单」。
2. 点击「新增老板」，自定义ID，昵称可以留空；保存后首页搜索能找到该老板。重复ID应提示错误。
3. 点击「老板充值」，用ID或昵称片段搜索（英文忽略大小写），选择老板，检查当前余额，输入70及备注，确认充值。
4. 在首页搜索点击该老板，直接打开对应详情；检查余额与充值流水。刷新详情地址应恢复同一老板；详情里的充值、开始订单、手动调整均保留。
5. 返回首页点击「开始订单」，搜索选择老板，先检查确认信息再开始；选中本身不会开始订单。
6. 余额为零、单价为零或已有未结束订单时，确认开始应显示现有中文校验错误，弹窗保持打开。
7. 成功后首页显示当前订单；暂停、继续、结束确认、15分钟结算仍采用原逻辑。刷新恢复当前订单，结束后首页显示空状态。
8. 用重复昵称、空昵称和中文/特殊字符ID检查搜索及详情跳转，清空搜索恢复全部结果。

首页提供订单、充值、新增老板和记录打赏快捷入口，提供今日概览和收入统计入口，未接入SQLite。
# 老板删除与开发数据管理

老板没有 active 或 paused 订单时，可以确认删除当前资料。历史订单、充值、消费及其他余额流水保留在老板管理页的「全部历史记录」中，支持刷新后查看。存在进行中的订单时，存储层禁止删除。

每份新老板资料拥有独立的内部 `profileId`；用户自定义 ID 仍必填且在当前老板列表中唯一。删除后重建相同 ID 会生成新的内部标识，初始余额为零，新详情不会混入旧资料的账目。历史订单和流水保存老板 ID、昵称快照及原有金额、时间。旧流水首次兼容时补齐可获取的昵称；过去未记录且无法获取的昵称显示「未填写昵称」。

「开发/测试数据管理」的「清除所有测试数据」必须确认后执行。集中逻辑位于 `src/features/storage/testData.ts`，开关 `ENABLE_TEST_DATA_MANAGEMENT` 可用于正式发布时隐藏入口。清理当前统一存储以及旧版本老板、账户、订单备份键，不清理其他应用的存储。清理后首次读取会创建空存储，所有老板、订单和流水均为空。

手动验证：创建老板并充值，开始订单后尝试删除应被阻止；暂停后也应被阻止。结束订单后删除应成功，在全部历史记录中检查原老板 ID、昵称和账目。重新创建同 ID 后检查余额为零、详情没有旧账，并确认全部历史记录仍保留旧数据。最后测试清理弹窗取消不改变数据；确认后所有资料和当前订单消失，刷新仍为空。


# 第六阶段：打赏记录管理

打赏保存在统一 localStorage 的独立 `tips` 集合，使用专门的打赏仓库操作，不调用余额充值或扣费方法，不生成余额流水。金额为正整数分，所有展示保留两位小数。

每条记录保存唯一 ID、内部 `profileId`、老板 ID 和昵称快照、金额、`receivedAt`、备注、创建和最后修改时间。旧资料内部标识仍使用兼容的 `legacy:<老板ID>`；新资料使用独立随机标识。删除老板不删除打赏，同 ID 重建不会继承旧记录。历史打赏仍可修改金额、发生时间、备注或经确认删除，但无法更换老板。

时间输入使用电脑本地日期时间，默认当前时间，允许补录。保存为带时区的 ISO 时间字符串，展示时转换回本地时间。列表按 `receivedAt` 倒序；后续收入统计必须依据 `receivedAt`，不能使用 `createdAt`。新旧存储兼容：没有打赏集合的旧数据补入空数组，其余账目保持不变。清除测试数据删除整个统一存储，因此同时清除打赏。

主要新增文件位于 `src/features/tips/`：`types.ts` 定义结构，`tipRepository.ts` 实现 CRUD 与累计金额，`tipTime.ts` 转换本地时间，`TipForm.tsx` 共用新增/修改表单，`TipRecords.tsx` 共用详情与全部历史列表。首页使用原 BossPicker 选老板，再打开同一 TipForm。老板详情与全部历史共用 TipRecords。

手动验证步骤：

1. 新建测试老板并充值70元。在首页点击记录打赏，以ID或昵称搜索，选择老板，输入20元和备注，保存；余额仍为70元，余额流水没有新增。
2. 打开老板详情，检查累计打赏20元。点击记录打赏，再记录10元，将发生时间改为今天下午或昨天，累计应为30元，记录按发生时间倒序。
3. 修改10元记录为15元，并修改发生时间、备注；累计应为35元，发生时间重新排序，老板关联不可修改。
4. 点击删除20元记录，先取消，数据不变；再确认删除，累计应为15元，余额仍70元。
5. 尝试新增0元、负数、三位小数金额，应拒绝；刷新页面应保留有效打赏。
6. 修改老板昵称，旧打赏仍显示原昵称。确认删除老板资料后，在全部打赏历史检查原ID、昵称、金额与时间仍在；历史仍可修改和确认删除。
7. 重建相同老板ID，详情累计为0，旧打赏仅在全部历史中保留。
8. 最后在开发/测试数据管理中确认清除所有测试数据，检查打赏、老板、订单、余额流水全部清空，刷新仍为空。


# 第七阶段：收入与工作统计

侧边栏「收入统计」以及首页今日概览的「查看收入统计」入口打开 `#statistics`。支持今日、本周、本月切换，均截至当前电脑系统时间。今日从本地零点开始；本周从本地周一零点开始（至周日结束，但未来时间不提前计入）；本月从自然月1日零点开始。采用本地日历计算边界，而不是用固定24小时或7天毫秒数回退，以适应时区和夏令时。

服务收入按每笔订单的真实有效服务区间与统计周期的交集计算。订单按暂停/恢复时间戳分成多个服务区间；跨午夜、周一、月初时，仅统计落在当前周期的部分。active计算至当前时间，paused计算至暂停开始，completed计算至结束。每秒刷新只更新显示，不累加保存统计数据。

金额复用 `billing.chargeCents` 的整数分四舍五入规则：周期收入 = 截至周期末的订单累计费用 - 周期开始前的订单累计费用，整秒处理也沿用累计有效时长向下取整。这使跨日分摊金额之和仍等于订单总费用，某个日期可能承接1分钱舍入尾差。阶段四未计费历史订单按用户定义的实际服务时长与当时单价参与服务收入统计，不补扣余额。

充值收款只取类型recharge的余额流水，以流水时间归属周期；手动增减、欠费清零、订单消费均排除。打赏依据receivedAt，增删改后统计自动刷新。收款合计=充值+打赏；实际收入=服务收入+打赏。预充值属于收款，陪玩服务才形成服务收入，两者不可重复累计。当前订单未结算服务同样计入收入，消费流水不作为额外收入重复计入。

统计从历史订单、流水和打赏直接读取，不依赖老板列表。因此删除老板或重新创建同ID不会影响历史统计。统计结果不单独保存，刷新后从原始记录重新计算。

主要文件：`src/features/statistics/statistics.ts` 纯计算；`useStatistics.ts` 读取数据、监听变化和刷新时间；`StatisticsCards.tsx` 共用指标卡片；`src/pages/statistics/StatisticsPage.tsx` 独立统计页。导航、App、Dashboard和全局样式接入页面及今日概览。`tests/statistics.test.mts` 覆盖跨天暂停、日期边界、活动订单、打赏发生日期和金额舍入等。

手动测试：

1. 无订单的测试老板充值70元、记录今日打赏20元。今日应显示充值70、打赏20、收款合计90、实际收入20，服务时间为零。
2. 手动增加10元，今日充值及实际收入不变。
3. 开始35元/小时订单，观察有效服务时间和服务收入随实际时间增长，尚未到15分钟也参与统计。
4. 暂停并停留一段时间，统计服务时长/收入不变；继续后恢复增长。
5. 有效服务15分钟时，服务收入应为8.75，实际收入28.75，收款合计仍90；自动结算不能把8.75再次加入收入。
6. 手动结束并刷新，服务时长及收入保持最终值。删除老板后同样保持统计。
7. 修改今日打赏为昨日发生，今日打赏减少20元；若昨日还在本周/本月，其周/月打赏仍包含这条记录。删除打赏后相关周期统计更新。
8. 切换本周、本月，核对展示的起点分别是周一零点和月初零点。
9. 跨午夜验证可在23:50开始，次日00:30结束，次日应只有30分钟服务；本周/本月若包含两日应合计40分钟。若23:55暂停、00:10继续，次日仅20分钟，两日合计25分钟。自动测试已覆盖，不必修改电脑时钟。
10. 确认清理测试数据后，所有统计应归零。


# Phase 8A：统一数据访问架构

本阶段只整理代码依赖，不安装 Electron、SQLite 或其他依赖，不执行新数据迁移、不改变现有存储键、version:3 或字段格式。已有旧数据兼容仍由原 appStore 负责。

调用结构：React页面/组件/hook → `features/data/dataAccess.ts` → 异步Repository/Service接口 → LocalStorage实现 → appStore。现有计时、计费、金额舍入、统计、跨日拆分与搜索纯函数继续独立。

`src/features/data/contracts.ts` 定义老板资料、余额流水、订单、暂停、打赏、全部历史、统计数据、变更通知及开发数据清理接口。历史和统计读取同一时刻的orders/entries/tips快照，不向UI暴露存储版本或键。余额操作复用现有保存逻辑，暂停和继续仍走订单生命周期，不能单独编辑暂停记录。

`src/features/storage/localStorageDataAccess.ts` 装配现有仓库并实现一致快照读取、暂停查询、余额接口、数据订阅与清理。`dataAccess.ts` 是唯一装配入口，未来实现同一DataAccess接口的Electron IPC适配器，在React挂载前调用configureDataAccess切换。所有UI仍调用相同方法，界面计算逻辑保持不变；时间、金额字段转换由未来适配层处理。

原直接读取位置：ArchivedHistory和useStatistics。原存储事件/键依赖：BossesPage、useOrders、TipRecords。原身份辅助依赖：TipForm、TipRecords、BossOrderHistory和BossesPage。它们现在通过数据接口订阅读取，身份逻辑改用独立bossIdentity模块。BossForm、RechargeForm、BossBalance等也统一使用dataAccess，不导入具体仓库单例。

新纯模块bossIdentity.ts承载profileId/legacy标识兼容，tipMetrics.ts承载累计打赏；原模块保留重导出以兼容已有测试和旧入口。development.ts独立控制测试管理入口，清理逻辑由dataAccess.development.clear调用。

原68项测试保留通过。dataAccess.test.mts新增4项测试验证接口联动、暂停查询、一致历史/统计快照、装配替换、同页/跨窗口数据通知及取消订阅，并自动检查UI和React hook不直接依赖localStorage、appStore或具体仓库。总计72项。

## Phase 8B：Electron 桌面运行

本阶段完成桌面外壳，业务与 LocalStorageDataAccess 保持不变；没有 SQLite、数据库迁移或正式 Windows 安装包。已有依赖不需要重复安装。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 只启动浏览器 Vite 开发服务器，默认端口5173 |
| `pnpm electron:dev` | 一个终端启动 Vite（固定127.0.0.1:5177）和 Electron，支持 React 热更新 |
| `pnpm electron:local` | 先进行 TypeScript 检查和 Vite 构建，再让 Electron 加载 dist/index.html，不启动服务器 |
| `pnpm electron:test` | 使用独立临时数据目录验证业务、安全配置、本地路由及真实页面刷新；先运行 pnpm build |

在项目目录执行以上命令。桌面窗口名称为“Yaya的陪玩日记”，默认1200×800、最小760×600，保留原生标题栏。关闭窗口结束桌面运行；终端 Ctrl+C 可以停止开发启动脚本及其子进程。修改 Main 或 Preload 后需要重启桌面命令。

主要文件与职责：

- electron/main.cjs：Main 负责应用生命周期、单实例、数据目录及窗口创建。
- electron/window.cjs：统一窗口、安全限制和开发地址/本地文件加载。
- electron/preload.cjs：Preload 保留最小隔离结构，目前不暴露 Node 或数据库 API。
- src/：Renderer 是现有 React 页面，通过 dataAccess 使用现有 localStorage；业务逻辑没有重写。
- scripts/electron-dev.mjs、electron-local.mjs：协调一键启动和退出。
- forge.config.cjs：最小 Electron Forge 配置，复用标准启动工具，为后续打包留入口；当前没有配置安装包 maker。
- vite.config.ts：相对资源路径适配 file://，生产构建加入内容安全策略。
- tests/electron/ 与 scripts/electron-smoke.mjs：桌面集成检查；测试数据不会写入日常应用目录。
- pnpm-workspace.yaml：使用 hoisted 布局以兼容 Forge 启动，不影响数据格式。

Renderer 配置为 contextIsolation:true、nodeIntegration:false，同时启用 sandbox 和 webSecurity。页面不能使用 window.require 获取完整 Node API；新窗口、外部导航、webview 和权限请求均受限制。现有 hash 路由可在 file:// 下跳转和刷新，无需服务器 fallback。

数据位置：Electron 开发模式位于 `%APPDATA%\Yaya-companion-manager\development`；本地构建模式位于 `%APPDATA%\Yaya-companion-manager\local-build`。两种模式刻意隔离；浏览器还有自己的用户资料目录与来源空间，因此三者不是同一份 localStorage。Electron 不会自动读取、修改或删除原浏览器数据。未来将通过专门导出/导入迁移处理真实数据。

手动验收：

1. 运行 pnpm dev，浏览器原页面和资料应正常；保留此服务也不影响桌面模式。
2. 运行 pnpm electron:dev，确认标题、粉白色 Dashboard 和侧边导航。
3. 新建测试老板，充值70元；进入老板详情，检查搜索和资料修改。
4. 开始订单，暂停、继续、确认结束，检查历史订单和余额流水。
5. 记录20元打赏，检查余额不因打赏增加；进入收入统计检查充值与打赏。
6. 在 Dashboard、老板列表、老板详情、收入统计分别按 Ctrl+R，确认路由和已保存数据保留。
7. 按 Ctrl+Shift+I 打开开发工具，在 Console 输入 typeof window.require、typeof window.process，两者应为 undefined；不要使用主进程控制台进行此检查。
8. 关闭开发窗口，再运行 pnpm electron:local。此模式使用独立数据空间，初次为空属于正常现象；重复上述步骤并刷新。
9. 本地模式不需要 Vite 服务，也不需要网络；停止浏览器开发服务后，本地窗口仍能刷新与跳转。关闭再重开相同模式，已保存资料应保留。
10. 回归检查：pnpm test、pnpm lint、pnpm build；桌面集成检查再运行 pnpm electron:test。

## Phase 8C：独立 SQLite 测试数据库

本阶段仅接入独立测试库。原浏览器/桌面 localStorage 数据不导入、不删除，LocalStorageDataAccess 与旧版本兼容逻辑继续保留。一个窗口只装配一个 DataAccess，不双写。SQLite 开发和本地模式共用测试库，请关闭当前桌面窗口后再切换命令。

### 驱动与位置

使用 Electron 内置的 node:sqlite / DatabaseSync，无新增第三方驱动依赖，无原生模块重建。实际 Windows Electron44.5.1 内含 Node24.21.0、SQLite3.53.4，已通过 scripts/sqlite-probe.cjs 和 Electron 集成检查。该接口仍随 Node 演进，因此当前固定现有运行环境，后续升级 Electron 时重新运行驱动探测和专项测试。

测试库始终位于 app.getPath('userData') 下。当前电脑的实际路径：

`C:\Users\Administraror\AppData\Roaming\Yaya-companion-manager\sqlite-test\yaya-companion-test.db`

SQLite WAL 模式可能同时出现 .db-wal 和 .db-shm 文件，属于数据库正常组成。没有在源码、dist 或安装目录保存业务数据库。自动测试使用系统临时目录中的独立测试库，不操作上述日常测试库。

### 模式开关

```powershell
pnpm electron:dev          # 原桌面 localStorage，Vite 开发模式
pnpm electron:local        # 原桌面 localStorage，本地构建模式
pnpm electron:dev:sqlite   # SQLite 测试库，Vite 开发模式
pnpm electron:local:sqlite # SQLite 测试库，本地文件模式
```

SQLite 模式顶部显示“SQLite 测试模式”提示。Main 只接受 local-storage / sqlite-test 两种 YAYA_STORAGE_MODE 值，未知值停止启动。测试库打开失败会显示启动失败，不自动覆盖或重建已有数据。普通 pnpm dev 浏览器模式继续使用原存储。

### 数据层和安全边界

React 页面 → 现有 dataAccess → electronDataAccess Promise 适配器 → contextBridge 中的明确业务方法 → ipcMain → SQLiteService → SQLite。

Preload 只公开老板、余额、订单、暂停、打赏、历史、统计读取、测试清理和变更订阅。没有公开任意 channel 调用、任意 SQL、数据库路径选择或文件系统 API。Main 校验请求来自已注册窗口的顶层页面及允许地址；参数继续接受业务校验，SQL 使用绑定参数。SQLite 模式只在成功提交且实际变更数据后发送通知，重复结算无变更不会造成刷新循环。Renderer 的 nodeIntegration:false、contextIsolation:true、sandbox:true 保持不变。

计时、计费舍入、统计、跨天拆分和搜索仍复用原纯函数。老板资料和打赏输入校验抽出共享 inputValidation.ts，避免两套规则。UI 仍使用原有接口；SQLite 存储中的整数毫秒在接口边界转换为原有 ISO 字符串或数值时间字段，不改变 UI 契约。

### 表结构与迁移

schema.ts 维护按版本追加的 schema migration，执行记录存入 schema_migrations。建表和登记版本在事务内完成；每个连接开启 foreign_keys，启用 WAL、FULL 同步与 busy timeout。重复打开不会重复建表或重置数据；不属于本应用或版本超出支持范围的数据库停止打开。

- boss_identities：永久 profile_id 主键、初始自定义ID、创建时间。
- boss_profiles：当前资料，profile_id 为主键并关联永久身份；当前 boss_id 唯一，昵称、整数分单价和余额、备注、创建时间。
- orders：订单主键、永久身份关联、老板ID/昵称/单价快照、状态、起止时间、有效时长快照、结算进度和金额、最终消费/结束余额/原因。
- order_pauses：订单ID与序号组成主键，暂停/恢复整数毫秒，未恢复为 NULL。
- balance_entries：流水主键、永久身份、老板ID/昵称快照、可选订单ID、类型、整数分变化前后余额/差额、结算进度、时间、备注。
- tips：打赏主键、永久身份和老板快照、正整数分金额、received_at、创建/更新时间、备注。
- schema_migrations：已执行的结构版本、名称、时间。
- import_batches：预留未来导入批次表；本阶段不执行任何真实数据导入。

历史外键指向 boss_identities，删除当前资料不删永久身份，不级联删除历史。相同自定义ID重建使用新随机 profileId，不继承旧订单、余额或打赏。金额均为 INTEGER 分，允许订单消费产生负余额；时间均为 UTC Unix INTEGER 毫秒，未结束/未恢复为 NULL。STRICT 表拒绝浮点金额，约束限制状态、正打赏、单一 active/paused 订单；唯一索引限制同一订单同一结算进度的消费流水。

### 事务

SQLiteService 的写业务操作统一 BEGIN IMMEDIATE → 操作 → COMMIT，异常 ROLLBACK；事务内没有 await。订单在事务中读取最新进度、按统一 chargeCents 计算差额、写消费流水、更新余额、更新进度，结束时再写最终结果。充值/手动调整/欠费清零的余额和流水同事务；删除资料的活动订单检查与删除同事务。历史/统计使用读取事务得到一致快照。原手动扣除不足余额的限制不变，订单消费继续允许负数。

### 检查与主要文件

```powershell
pnpm test
pnpm lint
pnpm build
pnpm electron:test
```

新增 electron/sqlite/schema.ts、service.ts、electron/ipc.cjs、src/features/data/electronDataAccess.ts、inputValidation.ts、scripts/build-electron.mjs、sqlite-probe.cjs、tsconfig.electron.json 和 tests/sqlite.test.mts。修改 Main/Preload/窗口、dataAccess 装配入口、两种桌面启动脚本、package.json、桌面集成检查与顶部模式提示。构建脚本额外检查并生成独立 Main 服务 bundle（.electron-main），数据库驱动不会打入 Renderer。

专项测试覆盖 schema、资料与身份隔离、充值/负余额、订单暂停恢复、15分钟及结束结算、重复扣费保护、打赏、历史/统计、重开库和各写入步骤故障回滚。Electron 检查依次验证原 localStorage、SQLite、第二个进程重新打开同一隔离 SQLite 测试库，并检查真实 dist 的 hash 路由与刷新；SQLite Renderer 检查 localStorage 未被写入。

### 手动验收

1. 先运行普通 pnpm electron:dev，确认原资料正常，关闭窗口。运行 pnpm electron:dev:sqlite，确认顶部测试提示；首次测试库为空属于正常现象。
2. 新建测试老板 TEST-A，昵称可以为空，单价35元/小时；重复ID应给中文提示。另建 TEST-B。
3. 给 TEST-A 充值70元、手动增加10元、扣除5元，检查余额75元与三条流水；刷新仍保留。
4. 给 TEST-A 记录20元打赏，余额应仍为75元；修改发生时间、金额和备注，检查打赏及统计更新，再测试确认删除。
5. 开始 TEST-A 订单，再尝试 TEST-B 应被阻止；删除 TEST-A 应提示先结束订单。暂停也应占用订单名额。
6. 暂停等待，再继续，检查暂停期间有效时间不增长。有效服务15分钟时消费8.75元；连续刷新不会再次扣8.75元。修改老板当前单价，当前订单仍按35元快照计费。
7. 有效服务23分钟结束时总消费13.42元（15分钟后补4.67元）；检查历史、流水、结束余额和“用户手动结束”。自动测试用受控时钟覆盖，不需要改电脑时钟。
8. 另用余额5元的老板开始35元/小时订单；15分钟后余额-3.75元，订单继续。结束后充值或欠费清零，检查正确余额及对应流水。
9. 订单结束后删除老板，全部历史仍有订单/流水/打赏；重建相同ID，应余额0、详情没有旧历史。
10. 关闭桌面，运行 pnpm electron:local:sqlite。同一个 SQLite 测试库应仍在；刷新 Dashboard、老板详情、统计均正常，且不需要 localhost。
11. 再关闭并运行普通 pnpm electron:local 或浏览器 pnpm dev，检查原 localStorage 空间保持独立，SQLite 测试资料不会混进去。
12. 最后仅在 SQLite 测试模式中确认“清除所有测试数据”，资料/当前订单/历史/流水/打赏归零，schema保留；原 localStorage 不受影响。故障回滚用自动测试验证，界面不提供故障注入。

Phase 8C 最终验证：原72项测试继续通过，新增22项SQLite专项测试，共94项通过；lint、build通过。Electron原localStorage、SQLite及独立进程重启检查均通过。两个SQLite一键启动命令已在Windows实际打开，测试窗口已关闭。没有迁移真实数据、删除原存储实现或制作安装包。

## Phase 8D：一次性正式迁移与验收

增加侧边栏“数据迁移”页面（#migration）。本阶段提供完整流程，但不会自动替用户导入真实数据。原存储和旧兼容键保留；SQLite测试库与正式库互不覆盖。正式模式隐藏并在Main中禁止“清除所有测试数据”，避免误清正式账目。

### 三种数据源及启动

| 数据源 | 开发命令 | 本地文件命令 |
| --- | --- | --- |
| 原localStorage | pnpm electron:dev | pnpm electron:local |
| SQLite测试 | pnpm electron:dev:sqlite | pnpm electron:local:sqlite |
| SQLite正式 | pnpm electron:dev:formal | pnpm electron:local:formal |

浏览器pnpm dev仍使用原浏览器来源的数据。在原浏览器的同一地址、端口和用户资料中导出，才能取得原浏览器资料；Electron不能自动读取外部浏览器localStorage。

正式库路径：`%APPDATA%\Yaya-companion-manager\sqlite\yaya-companion.db`。本机为`C:\Users\Administraror\AppData\Roaming\Yaya-companion-manager\sqlite\yaya-companion.db`。
测试库仍为`%APPDATA%\Yaya-companion-manager\sqlite-test\yaya-companion-test.db`。
两个模式的用户数据目录也分离。没有通过验收的正式库不能启动；正式命令不会自动创建空正式库。启用正式库后需要关闭当前测试窗口，再用正式命令启动；当前窗口不会悄悄切换或双写。

### 导出格式与校验

迁移文件为明确版本的JSON：format为yaya-diary-migration、formatVersion为1、dataVersion为3；包含capturedAt毫秒时间、rawKeys原始文本、data完整业务快照、fingerprint。

rawKeys完整保存以下四个键的原始JSON字符串或null：yaya-diary:app:v3、yaya-diary:accounts:v2、yaya-diary:bosses:v1、yaya-diary:orders:v1。旧键只作保留，不重复叠加到当前v3状态。旧资料兼容转换只在内存副本进行，不写回源存储。缺少profileId的旧记录使用现有确定性legacy:<老板ID>规则，已有profileId、记录ID和历史快照不重新生成。

导出/导入检查版本、JSON、内部身份关联与当前身份唯一、自定义ID、安全整数金额、时间、状态与暂停区间、最多一个active/paused、余额流水链、当前余额、结算进度与累计费用、打赏正金额。严重不一致拒绝导出/导入。文件大小上限20MB。

SHA-256针对规范化业务内容和原始键的JSON语义生成：对象键排序，老板/订单/打赏按ID排序，流水保留原插入顺序；排版及导出时刻不改变同一份业务状态的指纹。导出时使用Web Crypto，Main重新计算指纹，并独立核对rawKeys与data的一致性。修改内容而不匹配指纹会被拒绝。每笔导入登记import_batches.source_digest，唯一约束和业务检查阻止重复导入。

### 临时库、对账和正式启用

选择文件后，在当前Electron用户数据目录的migration-staging创建随机命名的新临时库。不会把记录写入当前测试库或正式库。全量INSERT在事务中复制身份、资料、订单、暂停、流水和打赏；不调用充值、订单结算或打赏创建业务，不重算历史最终金额。原迁移文件完整保存在import_batches.source_document供追溯。

导入后使用原导出时刻及电脑本地时区计算双方的今日/本周/本月统计，避免active订单随时钟增长引入差异。对账包括：当前老板、永久身份（含已删除）、全部订单及三种状态数量、流水、打赏、各老板余额、总充值、总订单消费、总打赏、最终订单费用合计；三个周期各6项指标。同时逐条核对ID、profileId、昵称/单价快照、金额、暂停及时间，并执行SQLite完整性/外键校验。结果可在页面查看并下载。

全部一致才显示可用的“确认启用正式库”按钮。确认后再次对账和检查导入批次，关闭数据库并截断WAL、刷盘，再使用同卷原子硬链接创建正式文件：目标存在即失败，绝不覆盖。临时路径随后移除，正式文件独立保留。尚未确认时可以取消；页面切换/刷新可恢复本次待验收报告。关闭应用会废弃当前未启用的临时库，重新导入即可；异常终止留下的临时文件不被当作正式库自动启用。

导入事务任一步失败全部回滚并废弃临时库；对账失败也废弃，原localStorage及当前SQLite库保持不变。启用前失败不创建正式库，可以重试。当前没有提供合并或覆盖已有正式库的功能。

SQLite结构版本2追加legacy_unbilled支持，并允许旧未计费订单保留未知的结束余额NULL。结构升级在事务中保留v1数据，重建订单表期间暂时关闭外键，事务内做完整外键检查并在连接返回前恢复开启。legacyUnbilled仍是已完成历史，不补扣费用。

### 进行中订单与回退

active/paused订单完整复制开始时间、暂停、单价快照、状态、已结算时长/金额。导入阶段不会结算；正式启动后仅由原订单系统补齐新跨过的15分钟点，已经结算的部分不会重复。active关闭期间继续按系统时间计时，paused停留在暂停时刻。建议正式迁移前结束订单。

原localStorage一直保留，可关闭正式窗口并使用原命令/浏览器查看迁移前状态。它不是正式库的实时镜像；正式模式产生的新订单、充值、打赏不会回写旧源。验收之后请固定使用正式模式记账，避免两份独立数据产生分歧。

### 完整手动迁移步骤

1. 在拥有原数据的浏览器地址（例如127.0.0.1:5173）或原Electron localStorage模式打开“数据迁移”。先检查老板、历史、余额、打赏及统计，建议结束当前订单。
2. 点击“导出迁移数据”。保存yaya-migration-v1-*.json，原数据不会被清理。若校验失败，请按中文提示检查源资料，不修改文件来绕过校验。
3. 关闭当前Electron窗口，运行pnpm electron:local:sqlite（或开发测试命令）。确认顶部测试数据源提示，进入“数据迁移”。
4. 选择导出的JSON。检查临时库对账报告，尤其是身份数量、余额、消费/充值/打赏合计和三周期指标；保存对账结果。此时当前测试库没有被导入文件替换。
5. 可先点击“取消本次迁移”，确认原数据和测试数据仍在，再重新导入。尝试修改文件内容、非法JSON或重复文件，应被明确拒绝。
6. 所有项目一致后，点击“确认启用正式库”并确认弹窗。正式库创建完成后，关闭测试窗口。
7. 运行pnpm electron:local:formal，确认顶部“SQLite正式数据源”；检查Dashboard、搜索、老板详情、全部历史、余额流水、打赏和统计，与报告逐项核对。
8. 进行一笔测试充值/打赏或修改备注，刷新并关闭重开正式模式，确认新记录持久化；核对打赏仍不影响余额，订单仍按快照计费。
9. 若迁移了active订单，检查已结算金额不会再次扣除，新的服务周期正常补结算；paused订单刷新后仍暂停。15分钟、23分钟和多结算点恢复由自动测试覆盖，无需调整系统时钟。
10. 关闭正式窗口，回到原浏览器/原Electron模式，确认迁移前资料仍保留；然后回到正式模式继续日常使用。不要在两边分别记账。
11. 重新选择同一文件应被重复保护阻止；已有正式库也不能被其他文件覆盖。保留迁移JSON和对账报告，后续备份/恢复将在单独阶段实现。

主要新增文件：src/features/migration/format.ts、src/pages/migration/MigrationPage.tsx、electron/sqlite/migration.ts与index.ts、tests/migration.test.mts。修改DataAccess契约和适配器、存储只读校验入口、Main/Preload、schema版本2、服务快照读取、三模式启动命令、导航及模式提示。React业务页面继续调用统一DataAccess，不执行SQL。

检查命令：pnpm test、pnpm lint、pnpm build、pnpm electron:test。桌面检查使用系统临时目录，验证原localStorage导出、SQLite测试IPC导入及对账启用、正式模式恢复/写入/再次重启，以及三个模式的hash路由、刷新和Node隔离；不接触真实正式库。

Phase 8D 验证结果：全部116项tests通过，lint与build通过；Electron localStorage、SQLite测试、SQLite正式三模式检查通过，包含实际对账页面、正式模式写入和再次重启持久化。测试仅使用临时目录，没有迁移或切换当前真实数据。

## Phase 8E：Windows 1.0.0 安装版与正式备份

安装程序：`out/make/squirrel.windows/x64/YayaDiary-1.0.0-Setup.exe`。
同目录的 `YayaDiary-1.0.0-full.nupkg` 和 `RELEASES` 是安装/更新资源。完整未安装的应用位于 `out/Yaya的陪玩日记-win32-x64/`，其中 `YayaDiary.exe` 可以用于检查构建。

双击 Setup.exe，为当前 Windows 用户安装；从桌面或开始菜单打开“Yaya的陪玩日记”。安装版自带 Electron，不需要安装 Node.js 或 pnpm。面向 Windows 10/11 x64，暂用默认图标，尚未配置代码签名。

### 正式资料与首次启动

- 安装版强制使用 SQLite 正式数据源，忽略开发存储模式环境变量，不需要选择数据源。
- 首次启动自动创建空正式数据库：`%APPDATA%/Yaya-companion-manager/sqlite/yaya-companion.db`。本机通常是 `C:/Users/Administraror/AppData/Roaming/Yaya-companion-manager/sqlite/yaya-companion.db`。
- 应用文件在 `%LOCALAPPDATA%/YayaDiary/`；数据库不在安装目录。Squirrel 安装/卸载事件只处理快捷方式，不删除用户数据。卸载和重装保留数据库。更新继续使用同一数据目录；更新前建议另外备份。
- 原浏览器和 Electron 网页存储仍保留，两者不会自动与正式库同步。首次导入旧资料：在原模式“数据迁移”导出 JSON，在安装版“数据管理 → 导入旧资料”选择文件，检查对账并二次确认。
- 仅尚未记账、没有历史身份或导入批次的空正式库允许首次导入。切换前保留关闭并刷盘的空库副本，失败回滚；已有账目的正式库不能通过迁移覆盖。
- 正式版不显示清除测试数据、测试模式提示和迁移调试指纹/开发命令。保留正式迁移入口。

### 备份与恢复操作

1. 打开“数据管理”，查看应用版本 1.0.0、数据库版本 3、数据位置与记录数量。
2. 点击“备份数据”，在原生保存窗口选择位置。默认名称包含电脑本地日期时间，例如 `yaya-backup-2026-10-07-143000.db`。请选择新文件名，应用不覆盖已有备份。
3. 完成后查看时间、位置、大小、老板/订单/流水/打赏数量。建议另存至其他磁盘或移动硬盘。
4. 恢复前结束当前进行中或暂停订单。点击“恢复备份”，选择 `.db`，核对校验摘要与记录数量，再点击“确认恢复备份”并确认弹窗。
5. 校验阶段只操作独立临时副本，不改当前资料或原备份。检查 SQLite 格式、schema、完整性、外键、已知表/触发器及业务账目一致性；旧 schema 只在临时副本升级，未来版本拒绝。
6. 确认后自动使用在线备份在数据目录 `backups/before-restore-*.db` 保存当前资料，再关闭并刷盘、切换正式库。失败自动回滚原库，自动备份保留；下次启动也会检查中断保护记录并优先回到原库。
7. 若备份含未结束订单，会显示提示：恢复保留原时间和结算进度，active 订单按实际经过时间继续计费，请确认符合实际情况。
8. 恢复完成后检查老板余额、历史订单、流水、打赏和统计；关闭重开再次核对。恢复前自动备份会在“最近备份”显示，仍可恢复。
9. 点击“打开数据文件夹”可在资源管理器查看数据库、自动备份及保护文件。日常使用“备份数据”保存一致性快照，不要在应用运行时单独复制主库文件。

备份使用 Node `node:sqlite.backup()` 对应 SQLite Online Backup API，包含已提交的 WAL 数据，不粗暴复制正在写入的主库。Main 将业务 IPC 串行处理，备份和恢复期间不会交错写账。Renderer 仅调用明确方法，不能执行 SQL 或访问任意文件路径；文件选择和打开目录在 Main 执行。

### 开发与构建命令

```powershell
pnpm dev                    # 浏览器开发，原网页存储
pnpm electron:dev           # Vite + Electron，独立网页存储
pnpm electron:dev:formal    # Vite + Electron，正式 SQLite
pnpm electron:local:formal  # 构建后加载本地文件，正式 SQLite
pnpm test
pnpm lint
pnpm build
pnpm electron:test          # 全部三模式集成检查，隔离临时目录
pnpm package:win            # 构建 Windows x64 应用目录
pnpm make:win               # 构建 Windows x64 Squirrel 安装程序
```

Windows 安装包在 Windows 开发机器上制作。Forge 8 使用 maker-squirrel；`electron-squirrel-startup` 处理安装/更新/卸载事件。依赖安装时仅允许 electron-winstaller 必需的 7-Zip 架构选择脚本。

主要文件：`electron/sqlite/maintenance.ts`（在线备份、校验、恢复与中断保护）、`electron/management.cjs`（受限文件选择 IPC）、`src/pages/data/DataManagementPage.tsx`（数据管理与确认）、`tests/maintenance.test.mts`（备份恢复故障测试）。Main、Preload、IPC、DataAccess、schema、迁移入口和 Forge 配置配套调整；原业务计算规则未变。

自动化安装验收脚本 `scripts/installed-app-check.mjs` 不包含在安装包中。它通过 Electron Main 调试入口在第一行暂停并将 appData 指向系统临时目录，验证真实安装产物、业务 IPC、备份恢复、打开文件夹、路由、刷新和重启，避免操作真实账目。

Phase 8E 检查：128 项 tests、lint、build 通过；三种 Electron 数据源集成检查通过。Windows x64 安装包成功生成，已安装应用启动及重启、在线备份恢复、数据目录打开、卸载重装保留隔离数据库通过。另以临时 1.0.1 副本实测跨版本升级，数据库哈希不变、升级后的应用仍能正常读取全部资料；最终交付版本为 1.0.0。安装验收只使用临时资料；原网页资料及真实正式库没有被迁移、删除或用于测试。本机为 Windows 11 x64（build 26200），Windows 10 尚未实机测试。

## 1.1.0：订单结束结算与余额耗尽提醒

新的安装包：`out/make/squirrel.windows/x64/YayaDiary-1.1.0-Setup.exe`，数据库 schema 版本 4。本次没有增加依赖。

订单进行中和暂停中不自动扣余额，不生成周期消费流水。界面每秒只根据开始、暂停、恢复时间计算有效时长；统一 `chargeCents()` 四舍五入到整数分。`useOrders` 只在资料变化、窗口恢复可见或用户操作时重新读取数据，没有每秒数据库结算任务。兼容接口 `orders.settle()` 现在只读。

新订单标记 `billingModel: on-completion`。结束时同一 SQLite transaction 写入一条消费流水、扣正式余额、更新结算进度、最终时长、最终金额、结束余额及状态。任一失败全部回滚。零秒或四舍五入为零的订单也保留一条零金额最终流水。3小时 × ¥35/h = ¥105.00，只生成一条消费流水；23分钟最终消费 ¥13.42。

新订单实时预计余额 = 正式余额 − 本单实时消费。充值后立即重新计算。负预计余额不会结束或暂停订单；显示预计欠费和按单价换算的超时时间。

升级不会清理旧流水。schema 4 给旧订单保留 legacy-periodic 标记、原结算进度与金额；旧完成订单业务字段不变。旧 active/paused 订单不再周期扣费，结束时仅扣 `最终消费 − 已扣金额`。旧订单预计余额也只减未扣部分；例如正式余额已扣875分，则不会再次减去这875分。若结束时没有未收费差额，不添加重复进度流水。旧订单可能仍有多条历史消费流水，这是保留原账目所需；一单一条规则只针对1.1.0新订单。

提示音通过 Web Audio 在本地合成两个带淡入淡出的短音，无网络依赖、不循环。开始操作时的用户交互解锁音频。提醒状态记录在当前订单组件中，仅从正预计余额跨到零或负数时触发；持续欠费不重复，充值回正后重新允许一次提醒。刷新/重启首次读取到已欠费状态只显示警告，不把页面恢复误判为新的跨越；系统静音或音频未解锁时视觉提示仍显示。

时间戳、暂停区间、状态、单价快照持久化，重启仍按真实时间恢复服务时长；paused 订单保持暂停。恢复订单不会执行扣费。收入统计继续按真实有效时间及快照计费，与结算发生时间无关。备份、恢复、迁移保留新计费标记，也兼容旧schema 3备份：只在临时副本升级，原备份不改变。schema 4不能由1.0.0打开，若需要回退旧应用，应使用升级前备份。

### 手动检查

1. 在测试资料中创建单价¥35/h老板并充值¥0.01，开始订单；约1秒后预计余额耗尽，只响一次短提示，订单继续。正常记录业务前请换回真实余额。
2. 观察正式余额仍为¥0.01，消费流水尚未出现；充值¥0.02，预计余额回正，再耗尽时可再响一次，之后不循环。
3. 暂停后服务时间与实时消费停止增长；继续后增长。结束并二次确认，检查正式余额允许负数、历史费用准确且只有一条订单消费流水。
4. 用有余额的测试老板开始订单，关闭重开，检查恢复时间及实时消费，仍没有消费流水；暂停后关闭重开仍暂停。
5. 旧订单若已经扣过875分，检查界面“旧订单已扣费用”显示，结束只扣差额，旧流水ID/金额/备注不变。
6. 核对收入统计，并在“数据管理”备份、恢复测试资料。3小时、23分钟以及升级场景由自动测试覆盖，无需改变电脑系统时钟。

验证结果：131项自动测试通过，包含schema 3旧active/paused/completed、旧备份恢复与旧快照迁移；lint、build通过。Electron三模式集成检查和正式计费/真实离线提示音检查通过，测得订单期间零数据库写入、两次耗尽各一次提醒。

Windows x64安装包已成功生成，但本机 Windows 应用控制策略阻止新的打包程序启动（“应用程序控制策略已阻止此文件”）。因此本次打包产物启动验收尚未通过，不代表已完成可安装验收；需要有效代码签名及允许该应用的 Windows 环境后再验收。本次没有修改 Windows 安全策略，也没有安装1.1.0覆盖本机1.0.0。
# 1.1.0 品牌图片更新

侧栏头像已替换为用户提供的图片，删除顶部“把每一份陪伴，好好记录。”小字。业务规则、数据格式和版本号保持 1.1.0。

品牌资源集中在 `public/brand`：原始 `avatar.webp` 用于页面；`app-icon.png` 为 256 像素预览；`app-icon.ico` 含 16/24/32/48/64/128/256 像素，用于 Electron 窗口、Windows EXE 和 Setup 安装程序。页面头像显示为 44 × 44 圆角图片，不拉伸。

`electron/window.cjs` 开发时从 `public/brand` 加载窗口图标，打包后从 `dist/brand` 加载。`forge.config.cjs` 的 `packagerConfig.icon` 设置应用 EXE 图标，Squirrel 的 `setupIcon` 设置安装程序图标。Windows 控制面板的远程 `iconUrl` 未设置，因为没有公开图标地址；本地 EXE、安装程序和窗口不依赖网络获取图标。

重新生成图标：`node_modules/.bin/electron.cmd scripts/generate-brand-icons.cjs`。重新构建安装包：`pnpm make:win`。输出仍为 `out/make/squirrel.windows/x64/YayaDiary-1.1.0-Setup.exe`，本次会替换同名旧构建文件。

手动检查：运行 `pnpm dev` 查看左上角头像和文案；运行 `pnpm electron:local` 查看窗口左上角及任务栏；在文件资源管理器中查看 `out/Yaya的陪玩日记-win32-x64/YayaDiary.exe` 和安装程序图标。若已固定旧快捷方式，退出应用后取消固定并从新版本重新固定，避免旧图标缓存。升级安装前先备份正式数据。本机此前的 Windows 应用控制策略限制仍不能视为已经解除。


## 1.1.1 版本更新

本版本只更新应用版本号，不修改业务逻辑。页面、package.json、Electron 应用信息及 Forge 打包版本统一为 1.1.1。安装包输出为 out/make/squirrel.windows/x64/YayaDiary-1.1.1-Setup.exe。
# 1.1.2 安装修复

安装事件改为在快捷方式任务完成后退出，安装/升级/卸载/淘汰钩子不初始化数据库或业务窗口；首次启动正常进入应用。业务和正式数据库结构不变。安装包为 `out/make/squirrel.windows/x64/YayaDiary-1.1.2-Setup.exe`。

137项测试、lint、build、Electron检查及打包通过；完整普通Setup升级测试受到Windows应用控制拦截，尚未通过最终安装验收。详细证据和复测方式见 `docs/install-validation/README.md`，不能把仅返回0的静默安装视为完整成功。

# 1.1.2 Windows Portable

发布文件：`out/portable/YayaDiary-1.1.2-Portable.zip`。完整解压后双击 `YayaDiary-1.1.2/YayaDiary.exe`，无需 Node.js、pnpm 或安装程序。不要只复制 EXE，应保留同目录所有文件。当前图标保留，默认使用 SQLite 正式数据源，不提供 localStorage / SQLite Test / 开发模式选择。

正式数据库位置为 `%APPDATA%/Yaya-companion-manager/sqlite/yaya-companion.db`；同一 Windows 用户的安装版和 Portable 共用这份正式数据。程序目录不存账目，更换或删除程序目录不会自动删除数据库。换电脑或换 Windows 用户请通过备份和恢复转移数据。

升级前先在“数据管理”备份并退出旧程序；解压新版到另一目录，启动新 EXE，确认数据正常后再删除旧程序目录。不要同时运行两个版本，也不要将整个数据目录覆盖到新程序目录。

开发者可运行 `pnpm make:portable` 重新构建并生成 ZIP 和 SHA256 校验文件。发布脚本使用现有 Forge package 及 Windows 原生 ZIP API，不修改 Squirrel 安装逻辑，不添加依赖。Portable 的 app.asar 清单移除开发 scripts、devDependencies 和 Forge config，Main 与业务代码保持不变。

验收：ZIP 解压、内容一致性和正式模式配置核对通过；现有 Electron 运行环境中的业务、备份恢复、重启和更换代码目录读取同一隔离数据库通过。**本机应用控制仍阻止解压 EXE 直接启动，不能宣称 Portable 直接运行已验收通过。** Portable 不绕过 SmartScreen、未签名程序限制或企业应用控制，不更改安全策略。

