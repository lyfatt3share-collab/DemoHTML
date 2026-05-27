

WASHFLOW - Development Notes
=============================


must do:
所有第三方系统集成（Zoho / Xero），
必须通过异步任务处理（Processor），
主业务 API 不允许直接调用外部服务。


API Requirements:
-----------------

1. GET /api/server-time
   - 创建订单时获取服务器当前日期时间（不依赖客户端时钟）
   - Response: { "datetime": "2026-05-12T10:30:00+08:00" }
   - 前端以只读方式显示，不可手动修改

2. GET /api/outlets/{outletId}/sales-advisors
   - 根据 outlet 获取该分行的 Sales Advisor 列表
   - 每个 outlet 的 advisor 由后台管理（可随时增减）
   - Response: { "advisors": ["Ali Bin Ahmad", "Siti Nurhaliza", ...] }

3. POST /api/CreateTaskSubmit
   - 创建洗车任务
   - Request body:
     {
       "outlet": "puchong",
       "salesAdvisor": "Ali Bin Ahmad",
       "serviceDateTime": "2026-05-12 10:30:00",
       "vehicleType": "registration" | "chassis",
       "vehicleIdentifier": "B 1234 ABC",
       "plate": "B 1234 ABC",          // vehicleType=registration 时填入
       "chassisNumber": "",             // vehicleType=chassis 时填入
       "ownerName": "Tan Ah Kow",
       "ownerPhone": "012-345 6789",
       "model": "Honda City",
       "color": "White",
       "services": ["1", "2"],          // service code 数组
       "remark": "客户特殊要求"
     }
   - Response: { "jobId": "J005", "status": "pending" }


=============================
Offline-First PWA 架构设计
=============================

目标：网络不稳定时仍可正常创建任务、查看工单、执行流程。

1. Local DB
   - 使用 IndexedDB（通过 Dexie.js 封装）
   - Schema:
     * jobs        — 工单数据（与后端结构一致）
     * syncQueue   — 待同步操作队列（create / update / status change）
     * outlets     — 分行列表缓存
     * advisors    — Sales Advisor 列表缓存（按 outlet 分组）
     * services    — 服务项目列表缓存

2. 写入流程
   - 用户提交 → 写入 IndexedDB（立即可用）
   - 同时写入 syncQueue（syncStatus: 'pending'）
   - Online → 立即 POST 后端 → 成功后标记 synced
   - Offline → 注册 Background Sync → 恢复网络时自动重试

3. 读取流程
   - Dashboard / Detail 从 IndexedDB 读取
   - Online 时定期拉取后端最新数据并更新本地
   - 未同步的工单显示“待同步”标记

4. Service Worker 扩展
   - 静态资源：Cache-first（HTML/CSS/JS/图片）
   - API 请求：Network-first，失败时回退本地数据
   - Background Sync：注册 sync event 处理 syncQueue

5. 冲突处理
   - 策略：last-write-wins（以服务器时间戳为准）
   - 同步失败的记录保留在 syncQueue，下次重试
   - 冲突时提示用户手动解决（后期可加）

6. 实施顺序（UI 确认后）
   Step 1: 引入 Dexie.js，建立 schema
   Step 2: create.html 提交写 IndexedDB
   Step 3: dashboard.html 从 IndexedDB 读取工单列表
   Step 4: detail.html 状态变更写 IndexedDB
   Step 5: sw.js 扩展 Background Sync + 完整缓存策略
   Step 6: 同步管理器（监听 online 事件，逐条推送 pending 任务）


=============================
开店 / 闭店 & 结算流程
=============================

--- 业务规则 ---

1. 开店 (Open Shift)
   - 触发者：admin / 店长
   - 验证：PIN 码（具体方案待客户确认）
   - 记录：outlet, operator, openTime, deviceId

2. 闭店 (Close Shift)
   - 触发者：仅 admin / 店长
   - 验证：PIN 码
   - 前端检查：是否有未完成工单（提示但不阻止闭店）
   - 触发后端异步结算

3. 强制闭店 (Auto Close)
   - Cutoff time: 每晚 22:00
   - 如果店长未手动闭店，系统自动触发 settlement
   - 后台 cron job 执行

4. 结算范围
   - 按 shift 时间窗口（openTime → closeTime）内的 job
   - 工单完成判定：status = ready 即算完成（洗完未提车也算）
   - Invoice 归属日期 = 洗完时间（washCompletedAt）
   - 未完成工单可跨天，不纳入当天结算

5. Invoice 规则
   - 每个 job 生成一张 Zoho Invoice
   - 同一 dealer 的多张 invoice 合并为一个 PDF 文件发送
   - 合并工具：pdf-lib（后端 Processor 执行）
   - 发送渠道：Email

6. Commission
   - 闭店结算为整店结算（不分 advisor）
   - Advisor commission 事后另行计算（后台报表功能）

--- API 设计 ---

POST /api/shift/open
  Request:  { outlet, operatorId, pin, openTime, deviceId }
  Response: { shiftId, pendingJobs: [...] }

POST /api/shift/close
  Request:  { shiftId, outlet, operatorId, pin, closeTime }
  Response: { status: "processing", settleId }
  // 后台异步 Processor 开始结算

GET /api/shift/{shiftId}/settlement
  Response: {
    status: "settled" | "processing" | "error",
    summary: {
      totalJobs, totalAmount,
      invoicesGenerated, invoicesSent
    },
    invoices: [{ jobId, invoiceId, dealer, amount, pdfUrl }]
  }

--- 后台 Processor 流程 (Close Shift) ---

1. 查询 shift 时间窗口内所有 status=ready/completed 的 job
2. 逐单调用 Zoho Invoice API 生成 invoice
3. 按 dealer 分组，下载各 invoice PDF
4. 同一 dealer 的 PDF 用 pdf-lib 合并为一个文件
5. 通过 Email 发送给 dealer / 客户
6. 更新 shift 状态为 settled
7. 失败时重试 3 次，仍失败则标记 error 并通知管理员

--- Cron: 强制闭店 ---

每天 22:00 检查所有 outlet:
  - 如果当天有 open shift 且未 close → 自动触发 /api/shift/close
  - closeTime = 22:00
  - 记录为“系统自动闭店”

--- 待确认 ---

- [ ] PIN 码方案：每人一个 PIN？还是整店一个管理员 PIN？（待客户确认）
- [ ] Zoho 合并 PDF vs 批量导出（倒向 pdf-lib 合并）

