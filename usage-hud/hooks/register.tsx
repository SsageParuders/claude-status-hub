import type { Register } from 'claude-code'
import { crabSvg, dashSvg, deskLayout } from './desktop'
import {
  FRAME_MS,
  JUMP_FRAMES,
  SPRITE_W,
  MINI_W,
  WARN,
  toolKind,
  dw,
  clip,
  encode,
  scenePx,
  miniPx,
  type Mood,
  type Scene,
} from './sprites'
import {
  CRAB_GAP,
  COMPACT_AT,
  KEEP_ENDED,
  ACCENT,
  GOOD,
  AMBER,
  safe,
  dur,
  durShort,
  big,
  easeStep,
  toolLabel,
  paceOf,
  moodOf,
  hasFiveFrom,
  receiptText,
  panelView,
  agentsPaneView,
  dashData,
  deskCrab,
  type Pace,
  type Limit,
  type Act,
  type Part,
  type PanelCell,
  type PanelInfo,
} from './panel'

// usage-hud v0.5: 用量面板 (终端版 + 客户端版)
//
// 客户端 (桌面 app 的 Code 标签页): 输入框上方一张卡片, 左边 SVG 像素螃蟹 (动作由 SMIL 动画循环播放),
//   右边 SVG 仪表盘 (自带深色底板), 下面一行可点的链接; 绘制代码在 ./desktop.ts
//
// 位置 (终端, v0.16 起固定): 面板在输入框下方 (画在提示行 PromptHint 里, 引擎自己的提示行保留在最下面);
//       螃蟹在面板左边 (v0.17.3 起回到旧排法, 散步道删掉了; /hud crab 开关); /hud top|bottom 只回一句话
//       螃蟹的像素画在 sprites.ts
//
// 完整版是左边一只螃蟹 + "3 行 x 3 列" 的对齐网格, 每列起点在三行里完全一致:
//   模型   Opus 5.5 ▁▂▃▅▇ medium   项目   my-app main               会话   6d18h   $199.91
//   上下文 ━━━━━━━━  14% 140k/1.0M   5小时  ━━━━━━│━━━━━━  14% 3h05m    本周   ━━│━━━━━━━━━━  43% 1d18h
//   状态   ▃▅▂ 读文件        12s     工具   Bash 12  Read 4         子代理 2 个运行中
//
// 螃蟹动画 (全部用像素画, 不用可能宽度不一的符号):
//   思考 -> 眼睛往右看 + 冒出思考点点      读/搜 -> 看一页纸, 扫描线上下移动
//   改/写 -> 右钳子敲击 + 纸上逐渐写满字    跑命令 -> 双钳交替敲键盘 + 终端光标闪烁
//   上网 -> 旋转的小地球                   子代理在跑 -> 道具区右下角一只横着迈步的小螃蟹
//   其他工具 -> 转动的小齿轮               一轮结束 -> 举钳跳跃 + 金色闪光
//   闲置 -> 眨眼 / 左右张望 / 偶尔挥手      5 分钟没动 -> 闭眼呼吸 + 冒泡泡
//   上下文 >=80% -> 变红冒汗, >=95% -> 红色闪烁报警
//   数字变化时会滚动过渡; 工作时上下文条有流光; 5小时/本周 >=90% 时用量条呼吸闪烁
//
// 可点击: 模型名 -> /model, 项目名 -> 打开项目文件夹, 上下文 -> /context, 5小时/本周 -> /usage
// /hud: 完整 -> 精简(1 行) -> 隐藏 循环; /hud agents 子代理看板; /hud crab 开关螃蟹
//
// v0.12 新增:
//   配速预警: 按 5小时/本周 窗口已过的时间算 "应该用到多少", 预计重置前会用完时, 用量条后面改成红色 "约40m后用完"
//   螃蟹情绪: 取 5小时 和 本周 里更紧张的那个 -> 正常 / 冒汗 (汗滴) / 慌张 (举钳 + "!")
//     (以前还有 "悠闲" 戴墨镜, v0.17.4 去掉了)
//   每轮收据: 每轮结束那行 (Crunched for 9m 6s) 后面追加 "· $0.42 · 改 3 个文件 +120 -30 · 工具 12 次"
//   一键压缩: 上下文 >=75% 时 "上下文" 那格出现 [压缩] 按钮 -> /compact; 额度重置后弹一次 "已恢复" 提示
//   子代理看板: /hud agents 或点状态格里的 "+N代理" -> 侧边面板, 列出每个子代理的时长/最后动静/工具/状态
//   点档位文字 -> /effort 打开档位滑块
//
// v0.13 改动:
//   时间刻度: 5小时/本周 的用量条上画一道亮色 │, 位置 = 窗口已过时间 / 窗口长度; 彩色段超过刻度 = 用得比时间快
//   文字缩短: 平时只写重置倒计时 "1h54m" (暗色); 会用完时百分比变红, 文字写红色的 "40m用完"
//     (v0.13.1: 预计用完的时间一定带 "用完"; 放不下就换 "4d用完", 再放不下照常写暗色的重置倒计时)
//     完整版 5小时/本周 的附加那段从 11 列缩到 7 列, 省下的给用量条; 中等版三根条仍然一样长
//
// v0.14-v0.16: 螃蟹搬到输入框上方的 "散步道" 里来回走 (Client 模块 walkway.tsx), 终端面板里没有螃蟹; v0.17.3 删掉, 见 git 历史
//
// v0.16.3 (按第三次实测改):
//   后台子代理的结果在主线程闲着时送回来, 不经过 prompt.submit, 直接是一个没有 prompt.submit 的 turn.start:
//     这种 turn.start 算 "结果送到了一次"; 已经庆祝过的提问再来这种段, 只记账不再庆祝
//   收据: 引擎那行 (TurnDuration) 的外层是 width 100%, 和收据并排时两边按比例挤, 收据被推到最右边还截短;
//     现在按引擎那行字的宽度给它定宽, 收据紧跟在后面, 放不下先省 "改 N 个文件", 最后才截
//
// v0.16.4 (按第四次实测改):
//   收据: 引擎节点的祖先 Box 不能带 width / height / minWidth / minHeight / display / overflow / position /
//     top / left / right / bottom (带了引擎就拒绝整棵树, 自己画, 收据全没了). 现在引擎那行原样放着, 收据放进
//     旁边一个 flexShrink 0 的 Box, 靠右; 先挑一种写法保证 "引擎那行字的宽 + 收据宽 <= 列数"
//   "搞定" 改成纯防抖: 主线程一段结束、$.agent.list() 里没有在跑的子代理 -> 等 2 秒; 这 2 秒里来了 turn.start
//     或 prompt.submit 就取消; 这一段结束前 2 秒内有子代理刚结束 -> 多等 2 秒 (只延一次); 不再记 "欠几次通知"
//   调试: 环境变量 USAGE_HUD_DEBUG=1 时, 把提问 / 每段 / 子代理 / prompt.submit / 防抖的事件带时间写进 debug 日志
//
// v0.17:
//   没有 5 小时限制的账号 (2026-10 起通过验证的 Ultra): rateLimits 里只有 seven_day -> 不画 5小时 那格
//     完整版第 2 行 = 上下文 | 本周 | 重置 (周几 时:分 + 配速); 中等版右列 = 上下文 / 本周 / 本会话; 精简版去掉 5小时 那段
//     客户端仪表盘同样是 上下文 | 本周 | 重置; 判定存进 store (noFive), 下次启动第一次回复之前就按它画; five_hour 一出现就恢复
// v0.17.3: 删掉螃蟹散步道 (v0.14-v0.16 的输入框上方横栏, Client 模块 walkway.tsx). 输入框一高横栏就被挤成 1 行半截, 也多占行;
//   螃蟹回到面板左边 (v0.15 及以前的排法: 15x3 像素画, 右边 3 列是道具; 精简版 8x1 小螃蟹), 不额外占行;
//   一轮结束: 面板螃蟹举钳跳 + 状态格 "✓ 上一轮 …"; 散步道才有的气泡 (搞定 / 慢点 / 等你点头 ...) 一起去掉. /hud crab off 不画螃蟹
//   上方横栏终端什么都不画 (留给引擎和别的 mod)
// v0.17.4: 散步道那些功能搬回面板, 不多占一行:
//   状态格的事件 (以前的气泡): 搞定 / 慢点！…用完 / 上下文快满了 / 压缩完了 / 额度刷新了, 亮 5 秒 (noteNow); 干活时只换工具名
//   子代理小螃蟹: 道具区右下角, 道具上移缩成 3 行高; 都结束后 1.5 秒淡出 (kidByeAt)
//   你发出消息 -> 跳一下 (jumpAt); 后台结果送回不跳
//   很短的工具: 至少拿着道具 TOOL_HOLD_MS (600ms), 工具之间不闪回 "思考中" (mainTool.until)
//   没搬的: 悬停 (面板里拿不到指针) / 粒子和溜达 (螃蟹不走路) / "等你点头" (引擎不告诉我们你什么时候点了允许, 会一直挂着)
// v0.17.5: 子代理小螃蟹换回 0.13 的 3x2 蹦跳画法; 打字时螃蟹不动 (只叫醒睡着的); needsFrame 不再抄 sprites 的帧号,
//   改为算出这一帧的螃蟹和上次画的比 (lastCrab), 变了才重画
//
// 螃蟹各种状态怎么叠 (从高到低, 只有一个能决定 "姿势"; 2-7 的先后在 sprites.ts 的 crabPose, 终端和客户端共用):
//   1. 跳一下 (你刚发出消息)   -> 蹲 / 腾空 / 落地, 约 0.6 秒
//   2. 庆祝 (一轮刚结束)       -> 举钳跳 + 闪光, 情绪标记暂时不画
//   3. 工作中 (按工具做动作)   -> 动作照常; 情绪只叠小标记: 冒汗 = 头边汗滴, 慌张 = 头边汗滴和红色 "!" 交替闪
//   4. 闲置 + 慌张             -> 双钳举起 + 左右发抖 + 右侧大 "!" (慌张会把睡着的螃蟹叫醒)
//   5. 子代理在跑              -> 看着右下角的小螃蟹, 隔一会儿举钳给它加油打气
//   6. 睡觉 (5 分钟没动)       -> 闭眼呼吸 + 泡泡 (冒汗时照样有汗滴)
//   7. 闲置                    -> 眨眼/张望/挥手
//   身体颜色永远只表示上下文 (>=80% 变红, >=95% 闪); 上下文 >=80% 也冒汗, 和情绪的汗滴是同一颗
//   右侧 3 列是道具区 (道具 / 泡泡 / 闪光 / 大 "!"), 有子代理时下面三行给小螃蟹: 细节见 sprites.ts 的 scenePx

const LAYOUTS = ['full', 'compact', 'off'] as const
type Layout = (typeof LAYOUTS)[number]

const SLEEP_AFTER_MS = 5 * 60_000
const PRESS_GAP_MS = 800 // 双击只算一次
const COST_MILESTONES = [5, 10, 20, 50, 100, 200, 500, 1000]
const USAGE_URL = 'https://claude.ai/settings/usage'
const AGENTS_PANE = 'hud-agents'

// ---------------- 会话状态 (模块变量) ----------------
let layout: Layout = 'full'
let engineWorking = false
let turnStartedAt = 0
let lastTurnMs = 0
let lastTurnTools = 0
let turnTools = 0
let totalTools = 0
let toolCounts: Record<string, number> = {}
let effort = ''
let modelId = ''
let cwd = ''
let project = ''
let branch = ''
let dirty = 0
let celebrateUntil = 0
// ---- 面板螃蟹的小动作 + 状态格里的事件 (v0.17.4: 散步道那些功能搬回面板) ----
const TOOL_HOLD_MS = 600 // 每个工具至少做这么久的动作 (只跑几十毫秒的 Glob / Read 也看得见), 工具之间也不闪回 "思考"
const NOTE_MS = 5000 // 状态格里的事件亮多久
const KID_BYE_MS = 1500 // 子代理都结束后, 小螃蟹淡出多久
// 主线程的工具: 在跑时 until = Infinity; 做完后 until = max(开始 + TOOL_HOLD_MS, 结束 + 2 帧), 到点前照样拿着道具
let mainTool: { name: string; until: number } | undefined
let jumpAt = -Infinity
let kidByeAt = -Infinity
// 终端面板上次画的螃蟹 (精简版那只 / 完整版那只 + encode 出来的 cells); needsFrame 拿它比这一帧会不会变. 没画螃蟹时 undefined
let lastCrab: { mini: boolean; cells: string } | undefined
let crabOn = true // /hud crab 开关 (存进 store): 关了面板里不画螃蟹, 网格占满整行
type Note = { text: string; color: string; bold?: boolean; until: number }
let note: Note | undefined
const wasRunOut: Record<string, boolean> = {}
const saidRunOut = new Set<string>() // 每个额度窗口只说一次 "慢点"
let saidCtxFull = false
let lastActive = 0
const asleep = (now: number) => lastActive > 0 && now - lastActive > SLEEP_AFTER_MS // 螃蟹睡着了 (5 分钟没动静)
let lastPct = 0
// 客户端横栏的宽度 (格数), 记进 store 方便按实际截图校准像素换算
let lastDesktopCols = 0
let savedDesktopCols = 0
// 这个会话有没有终端在显示: 只有终端需要每 0.15 秒重画来放像素动画;
// 只有客户端时只在数据变化时重画 (客户端的螃蟹动画由 SVG 自己播放, 频繁重画反而会闪)
let hasTerminal = true
// 自动更新: 客户端会话不会热重载, 发现磁盘上的版本号变了就自己执行一次 /reload-plugins
let loadedVersion = ''
let reloadAsked = false
// token 统计 = 会话记录里的历史 (启动时用脚本数一遍) + 之后每次请求的实时累加
type Tok = { input: number; output: number; cacheRead: number; cacheWrite: number }
const zeroTok = (): Tok => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
let tokBase: Tok = zeroTok()
let tokLive: Tok = zeroTok()
let tokState: 'idle' | 'counting' | 'ready' | 'failed' = 'idle'
let transcriptPath = ''
let resumeCtx: number | undefined
let agentsNow = 0
let frame = 0
let costMilestone = 0
let milestonePrimed = false
let warnedContext = false
let nightNoticed = false
let tweening = false
const lastPress: Record<string, number> = {}
const shown: Record<string, number> = {}
let mood: Mood = 'normal'
let tick = 0 // 定时器跳了几次 (面板隐藏时 frame 不走, 额度提醒照样要查)

// ---- 每轮收据 ----
// 只算主线程的回合 (turn.start 只有主线程有; turn.complete 带 agentId 的是子代理的回合)
// 工具次数和改文件包括子代理在这一轮里做的
type TurnRun = { turnId: string; startedAt: number; usd0?: number; files: Set<string>; add: number; del: number; tools: number }
// pending: 这一段结束时引擎那行可能写成 "Waiting for N background agents to finish" 的 N 的上限
//   (这次提问里跑过的子代理个数; 0 = 一定不是 Waiting). 只用来估宽, 宁可估宽
type Receipt = { turnId: string; startedAt: number; completedAt: number; durationMs: number; usd?: number; files: number; add: number; del: number; tools: number; boundTo?: string; pending?: number }
let turnRun: TurnRun | undefined
// 最近一段的收据: seg = 这一段, cum = 从提问开始的累计; 只有最近一段能被配对, 一对只配一行
type ReceiptPair = { seg: Receipt; cum: Receipt; startedAt: number; completedAt: number; boundTo?: string }
let lastReceipt: ReceiptPair | undefined

// ---- 一次提问 (v0.16.1 / v0.16.2) ----
// Claude Code 2.1.289 起 Agent 子代理默认放到后台跑: 一次提问里主线程会结束好几段 (每段一个不带 agentId 的
//   turn.complete); 子代理结束后, 它的结果送回主线程, 有两条路 (v0.16.3 按录像和会话记录核实):
//     主线程正在跑: 塞进这一段, 走 prompt.submit (origin.kind = 'task-notification', 带 turnId)
//     主线程闲着: 引擎从队列里取出来另起一段, 不经过 prompt.submit, 直接 turn.start (前面没有 prompt.submit)
//   最后一段结束那行引擎写的是整次提问的时长 ("Churned for 34s")
// 怎么划分 "一次提问" (v0.16.2 起看 prompt.submit 的来源, 不看 turn.start 带不带字):
//   origin 不是 task-notification (用户回车 / 手机 / SDK / 定时任务 / 别的会话 ...) = 新提问, 上一次没做完的作废
//   task-notification = 同一次提问的延续; 前面没有 prompt.submit 的 turn.start = 引擎自己接着跑 (闲着时送回的结果), 也是延续
// 什么时候算做完 (v0.16.4 起纯防抖, 不再记 "欠几次通知"): 主线程结束一段、$.agent.list() 里没有在跑的子代理
//   -> 等 END_WAIT_MS (2 秒); 这段时间里来了 turn.start 或 prompt.submit 就取消, 接着等下一段; 开始等的时候
//   前 2 秒内有子代理刚结束 (它的结果可能还在路上) -> 再多等 END_WAIT_MS (只延一次); 什么都没来才算做完 ->
//   只庆祝一次, "搞定 N" 的 N = 从用户发出这条提问到最后一段结束
//   已经庆祝过的提问又来了迟到的一段: 接着记账, 不再庆祝
// 收据: 每一行 TurnDuration 同时拿去比 "这一段的时长" 和 "从提问开始的累计时长", 对上累计的显示整次提问的合计
const END_WAIT_MS = 2000
type Ask = {
  startedAt: number
  usd0?: number
  files: Set<string>
  add: number
  del: number
  tools: number
  mainTools: number
  segments: number
  bgKids: Set<string> // 这次提问里跑过的子代理 (估引擎那行会不会写成 "Waiting for N background agents")
  lastEndAt: number // 主线程最后一段结束的时间
  celebrated: boolean
}
const newAsk = (at: number, usd0?: number): Ask => ({
  startedAt: at,
  usd0,
  files: new Set(),
  add: 0,
  del: 0,
  tools: 0,
  mainTools: 0,
  segments: 0,
  bgKids: new Set(),
  lastEndAt: 0,
  celebrated: false,
})
let askFromNext = false // 用户在主线程跑着时打了字 (排队): 下一个 turn.start 才算新提问开始
let submitSinceTurn = '' // 上一个 turn.start 之后来过的 prompt.submit 的来源 ('' = 没有)
let endToken = 0 // "提问做完" 的防抖: 每次取消 / 重排都换一个号
let endArmed = 0 // 正在等的那个号 (0 = 没在等)
let mainOpen = false // 主线程的一段正在跑 (只由 turn.start / turn.complete 改; 渲染时的 isWorking 不算, 免得测试或时序把它冲掉)
let agentsBusy = 0 // $.agent.list() 里在跑 (running) 的子代理; 防抖只看它
let lastKidEndAt = -Infinity // 最近一个子代理结束的时间 (防抖开始时 2 秒内有子代理刚结束 -> 多等 2 秒)
// 调试: 环境变量 USAGE_HUD_DEBUG=1 时把事件带时间写进 debug 日志 ($.ui.log, to: debug); 不设就什么都不写
let debugOn = false
let ask: Ask | undefined
const receiptOf: Record<string, Receipt | null> = {} // TurnDuration 行的 requestId -> 收据 (null = 确定不配)
// 子代理的 token: 只算主线程和认得的子代理 (和会话记录一样); 引擎自己的分叉 (压缩 / 记忆 ...) 的 id 谁也不认得,
// 不算. 认出来之前先记在这里, 认出来 (SubagentStart / $.agent.list()) 时再加进去
const tokPending = new Map<string, Tok>()
const rowSeenAt: Record<string, number> = {} // TurnDuration 行第一次画出来的时间
// 配上了收据的行: 引擎那行多宽、收据写哪种, 按列数记下 (面板动画每 0.15 秒让所有行重画, 不必每次重算)
const fitOf: Record<string, { cols: number; fit: { engineW: number; text: string; width?: number } | undefined }> = {}

// ---- 额度恢复提醒 ----
type Watch = { armed: boolean; resetAt: number }
const watch: Record<string, Watch> = {}

// ---- 子代理看板 ----
type Kid = {
  id: string
  ran?: boolean // 见过它在跑 (结束时才算一次 "子代理结束")
  endNoted?: boolean // 这次结束已经记过
  type: string
  desc: string
  startedAt: number
  lastAt: number
  lastTool: string
  tools: number
  status: string
  endedAt?: number
  note: string
  known: boolean // SubagentStart 或 $.agent.list() 认过; 只从 tool.call 看到的 id (引擎自己的分叉) 不显示
  listed: boolean
}
const kids = new Map<string, Kid>()

// 颜色、格式化 (时长 / 大数 / 模型名)、配速和情绪、工具中文名、面板排版都在 panel.ts (纯函数, README 动图也直接用)

// ---------------- 没有 5 小时限制的账号 (v0.17) ----------------
// 2026-10 起通过验证的 Ultra 账号没有 5 小时窗口, rateLimits 里只剩 seven_day; Max / Pro 照旧有
// 判定规则在 panel.ts 的 hasFiveFrom (README 动图也用); 判定存进 store, 下次启动第一次回复之前就按上次的排法画, 不会先画一格 "--" 再收掉
let noFive = false
function hasFive($: any, limits: Limit[]): boolean {
  const v = !hasFiveFrom(limits, !noFive)
  if (v !== noFive) {
    noFive = v
    Promise.resolve($.store.set('noFive', v)).catch(() => {})
  }
  return !noFive
}

function addTok(t: Tok, u: any) {
  t.input += u?.input_tokens || 0
  t.output += u?.output_tokens || 0
  t.cacheRead += u?.cache_read_input_tokens || 0
  t.cacheWrite += u?.cache_creation_input_tokens || 0
}
function tokSum(): Tok {
  return {
    input: tokBase.input + tokLive.input,
    output: tokBase.output + tokLive.output,
    cacheRead: tokBase.cacheRead + tokLive.cacheRead,
    cacheWrite: tokBase.cacheWrite + tokLive.cacheWrite,
  }
}
const tokTotal = (t: Tok) => t.input + t.output + t.cacheRead + t.cacheWrite
// 数字滚动过渡
function ease(key: string, target: number | undefined): number | undefined {
  if (target === undefined) return undefined
  const nxt = easeStep(shown[key] ?? 0, target)
  shown[key] = nxt
  if (nxt !== target) tweening = true
  return nxt
}

// ---------------- 颜文字 (终端以外的界面用; 工具分类 toolKind 在 sprites.ts, 中文名 toolLabel 在 panel.ts) ----------------
const KAOMOJI: Record<string, string> = {
  idle: '(o_o)',
  blink: '(-_-)',
  work: '(o_o)/',
  work2: '\\(o_o)',
  hot: '(;o_o)',
  jump: '\\(^o^)/',
  sleep: '(-_-)zZ',
  panic: '\\(O_O)/!',
}
function kaomoji(s: Scene): string {
  const md = s.mood ?? 'normal'
  if (s.celebrating) return KAOMOJI.jump
  if (s.working) return Math.floor(frame / 2) % 2 ? KAOMOJI.work : KAOMOJI.work2
  if (md === 'panic') return KAOMOJI.panic
  if (s.pct >= 80 || md === 'sweat') return KAOMOJI.hot
  if (s.sleeping) return KAOMOJI.sleep
  return frame % 30 === 0 ? KAOMOJI.blink : KAOMOJI.idle
}

// ---------------- 调用 $ 的动作 (必须是顶层函数) ----------------
function redraw($: any) {
  $.ui.invalidate('ui.render')
}

async function pressOk($: any, key: string): Promise<boolean> {
  const now = await $.clock.now()
  if (now - (lastPress[key] ?? 0) < PRESS_GAP_MS) return false
  lastPress[key] = now
  return true
}

function utf16Base64(s: string): string {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    bytes.push(c & 255, c >> 8)
  }
  return new Uint8Array(bytes).toBase64()
}

// ---- 跨平台 (html-shelf 里有同样一份; 带 $ 的函数必须写在本文件里, 不能 import) ----
type OS = 'windows' | 'mac' | 'linux'

// 按工作目录缓存: 同一个目录只判断一次, 换了目录 (或测试里换了系统) 再判断
let knownOS: { key: string; os: OS } | undefined

// 判断顺序: 环境变量 OS=Windows_NT (Windows 自带) → 路径像 C:\ → 有 /System/Library/CoreServices 就是 macOS → 其余按 Linux
async function detectOS($: any, dir: string): Promise<OS> {
  if (knownOS && knownOS.key === dir) return knownOS.os
  let found: OS = 'linux'
  try {
    if ((await $.env.get('OS')) === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test(dir)) found = 'windows'
    else if (await $.fs.exists('/System/Library/CoreServices')) found = 'mac'
  } catch {}
  knownOS = { key: dir, os: found }
  return found
}

const sepOf = (sys: OS) => (sys === 'windows' ? '\\' : '/')

// 用户主目录: Windows 用 USERPROFILE, 其余用 HOME
async function homeDir($: any, sys: OS): Promise<string> {
  const h = (sys === 'windows' ? await $.env.get('USERPROFILE') : '') || (await $.env.get('HOME')) || ''
  return h.replace(/[\\/]+$/, '')
}

// Claude Code 的配置目录: 设置了 CLAUDE_CONFIG_DIR 就用它, 否则 ~/.claude
async function claudeDir($: any, sys: OS): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/[\\/]+$/, '')
  const home = await homeDir($, sys)
  return home ? home + sepOf(sys) + '.claude' : ''
}

// 跑一个命令, 退出码 0 算成功; 命令不存在会抛错, 也算失败
async function ranOk($: any, argv: string[]): Promise<boolean> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })
    return r.exitCode === 0
  } catch {
    return false
  }
}

// WSL 里一般没有 Linux 的浏览器和文件管理器: 交给 Windows 那边的默认程序.
// 先试 wslview (wslu 包), 再经 wslpath 把路径转成 Windows 写法交给 explorer.exe
// (explorer.exe 成功也常返回 1, 所以 exit 0); 网址直接交给 explorer.exe
function wslTries(target: string): string[][] {
  const viaExplorer = /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
    ? ['sh', '-c', 'explorer.exe "$1"; exit 0', 'sh', target]
    : ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', target]
  return [['wslview', target], viaExplorer]
}

// macOS / Linux: 用系统默认程序打开 (文件夹 → 文件管理器, 网址 → 浏览器); 都不行就抛错
async function openPosix($: any, target: string, sys: OS): Promise<void> {
  const tries: string[][] = []
  if (sys === 'mac') tries.push(['open', target])
  else {
    if (await $.env.get('WSL_DISTRO_NAME')) tries.push(...wslTries(target))
    tries.push(['xdg-open', target], ['gio', 'open', target])
  }
  for (const argv of tries) if (await ranOk($, argv)) return
  throw new Error('没能打开, 试过: ' + tries.map(a => (a[0] === 'sh' ? 'explorer.exe' : a[0])).join(' / '))
}
// ---- 跨平台 完 ----

// 项目根目录 ($.session.root): 会话开始的地方, Claude 在终端里 cd 进子目录不会改它;
// 拿不到 (老版本引擎) 再用当前目录 ($.session.cwd)
async function projectDir($: any): Promise<string> {
  try {
    const r = await $.session.root()
    if (r) return r
  } catch {}
  return await $.session.cwd()
}

// Windows: Claude Code 启动子进程时把窗口设成隐藏, 直接跑 explorer.exe 打开的文件夹窗口也会是隐藏的;
// 经 cmd 的 start 转一手, 新窗口按正常方式显示 (已在本机验证). macOS 用 open, Linux 用 xdg-open
async function openProject($: any) {
  if (!(await pressOk($, 'project'))) return
  try {
    const here = cwd || (await projectDir($))
    const sys = await detectOS($, here)
    if (sys !== 'windows') {
      await openPosix($, here, sys)
    } else {
      const dir = here.replace(/\//g, '\\')
      if (/^[^&^|<>()%!"]+$/.test(dir)) {
        await $.process.run(['cmd.exe', '/d', '/c', 'start', 'usage hud', dir], { timeoutMs: 10_000 })
      } else {
        const script = "Start-Process -FilePath '" + dir.replace(/'/g, "''") + "'"
        await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', utf16Base64(script)], {
          timeoutMs: 20_000,
        })
      }
    }
    $.ui.toast('已打开项目文件夹')
  } catch (err) {
    $.ui.toast('打开失败: ' + String(err))
  }
}

async function runSlash($: any, command: string, fallbackUrl?: string) {
  if (!(await pressOk($, 'cmd-' + command))) return
  try {
    await $.command.run({ command })
  } catch (err) {
    if (fallbackUrl) {
      try {
        const sys = await detectOS($, cwd || (await projectDir($)))
        if (sys === 'windows') await $.process.run(['cmd.exe', '/d', '/c', 'start', 'usage hud', fallbackUrl], { timeoutMs: 10_000 })
        else await openPosix($, fallbackUrl, sys)
      } catch {}
    } else {
      $.ui.toast('/' + command + ' 运行失败: ' + String(err))
    }
  }
}

// ---- 额度恢复提醒 ----
// 5小时 (本周同理) 用到 >=30% 后 "上膛"; 之后 resetsAt 已过, 或用量从高位掉到 <5%, 就提醒一次并退膛
// 用量是最后一次 API 回复带回来的: 闲着的时候读数不变, 所以主要靠 "resetsAt 已过" 来发现
// 已经过了重置时刻的旧读数不会再上膛, 所以不会重复提醒
const WATCHED: Array<[string, string]> = [
  ['five_hour', '5 小时'],
  ['seven_day', '本周'],
]
function checkResets($: any, limits: Limit[], now: number) {
  for (const [kind, name] of WATCHED) {
    const l = limits.find(x => x.kind === kind)
    if (!l) continue
    const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    const w = (watch[kind] ??= { armed: false, resetAt: NaN })
    if (w.armed && ((isFinite(w.resetAt) && now >= w.resetAt) || l.percentUsed < 5)) {
      w.armed = false
      $.ui.toast(`${name}额度已恢复，可以继续了`, { timeoutMs: 8000 })
      noteNow($, '✓ ' + name + '额度刷新了', GOOD, now)
      celebrateUntil = Math.max(celebrateUntil, now + 1000)
    }
    if (l.percentUsed >= 30 && !(isFinite(at) && at <= now)) {
      w.armed = true
      w.resetAt = at
    }
  }
}

async function watchLimits($: any) {
  try {
    const u = await $.session.usage()
    checkResets($, (u.rateLimits ?? []) as Limit[], await $.clock.now())
  } catch {}
}

// ---- 子代理看板 ----
function kidOf(id: string, now: number): Kid {
  let k = kids.get(id)
  if (!k) {
    k = { id, type: '', desc: '', startedAt: now, lastAt: now, lastTool: '', tools: 0, status: 'running', note: '', known: false, listed: false }
    kids.set(id, k)
  }
  return k
}
// 已结束的只留最近 10 个; 没人认领的 id (引擎自己的分叉) 只留最近 50 个
function pruneKids() {
  const ended = [...kids.values()].filter(k => k.endedAt !== undefined).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  for (const k of ended.slice(KEEP_ENDED)) kids.delete(k.id)
  const strays = [...kids.values()].filter(k => !k.known).sort((a, b) => b.lastAt - a.lastAt)
  for (const k of strays.slice(50)) kids.delete(k.id)
}
// 用 $.agent.list() 补上描述、类型、状态; 列表里消失了的当作已结束; 同时更新运行中个数
async function refreshAgents($: any, now: number) {
  let list: any[]
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const seen = new Set<string>()
  for (const a of list ?? []) {
    if (!a?.id) continue
    seen.add(a.id)
    const k = kidOf(a.id, now)
    kidKnown(k)
    k.listed = true
    if (a.description) k.desc = safe(String(a.description))
    if (a.type) k.type = safe(String(a.type))
    if (a.status) k.status = String(a.status)
    if (k.status === 'running') {
      k.endedAt = undefined
      if (!k.ran) dbg($, now, `子代理在跑 ${k.id} (列表)`)
      k.ran = true
      if (ask) ask.bgKids.add(k.id)
    } else if (k.endedAt === undefined) {
      k.endedAt = now
      kidEnded($, k, now, '列表 ' + k.status)
    }
  }
  for (const k of kids.values()) {
    if (k.listed && !seen.has(k.id) && k.endedAt === undefined) {
      k.endedAt = now
      if (k.status === 'running') k.status = 'completed'
      kidEnded($, k, now, '列表里没了')
    }
  }
  const before = agentsNow
  agentsNow = (list ?? []).filter((a: any) => a?.status === 'running').length
  if (before > 0 && agentsNow === 0) {
    kidByeAt = now // 子代理都结束了: 小螃蟹淡出
  }
  agentsBusy = (list ?? []).filter((a: any) => BUSY.has(String(a?.status))).length
  pruneKids()
}
// 只认 running (任务书: "没有在跑的子代理"); pending / waiting 不算: 列表里可能一直挂着别的会话留下的条目, 算了会永远不庆祝
const BUSY = new Set(['running'])
// 同步子代理, 再看要不要开始 "提问做完" 的防抖 (最后一个子代理刚结束、主线程闲着)
async function syncAgents($: any, now: number) {
  await refreshAgents($, now)
  armEnd($, now, false)
}

// 子代理认出来了: 先前记下的 token 加进去
function kidKnown(k: Kid) {
  k.known = true
  const t = tokPending.get(k.id)
  if (t) {
    tokPending.delete(k.id)
    tokLive.input += t.input
    tokLive.output += t.output
    tokLive.cacheRead += t.cacheRead
    tokLive.cacheWrite += t.cacheWrite
  }
}
// 一个子代理结束了: 记下时间 (防抖开始时 2 秒内有子代理刚结束, 它的结果可能还在路上 -> 多等 2 秒)
function kidEnded($: any, k: Kid, now: number, how: string) {
  if (!k.ran || k.endNoted) return
  k.endNoted = true
  lastKidEndAt = now
  dbg($, now, `子代理结束 ${k.id} (${how})`)
}

// "提问做完" 的防抖: 主线程闲着、$.agent.list() 里没有在干活的子代理时才排; force = 主线程刚结束一段 (重新计时)
// 等 2 秒; 开始等的时候前 2 秒内有子代理刚结束 -> 等 4 秒 (只延这一次)
function armEnd($: any, now: number, force: boolean) {
  const q = ask
  if (!q || q.celebrated || mainOpen) return
  if (agentsBusy > 0) return // 还有子代理在跑: 等它们
  if (!force && endArmed) return
  const late = now - lastKidEndAt < END_WAIT_MS
  const wait = END_WAIT_MS + (late ? END_WAIT_MS : 0)
  const token = ++endToken
  endArmed = token
  dbg($, now, `防抖开始 等 ${wait}ms` + (late ? ' (2 秒内有子代理刚结束, 多等 2 秒)' : '') + (force ? ' (一段刚结束)' : ''))
  $.clock.after(wait, () => void endAsk($, token))
}
function cancelEnd($: any, now: number, why: string) {
  if (endArmed) dbg($, now, `防抖取消 (${why})`)
  endToken += 1
  endArmed = 0
}
// 等够了, 什么都没来: 这次提问做完, 庆祝一次
async function endAsk($: any, token: number) {
  if (token !== endToken) return
  endArmed = 0
  const q = ask
  if (!q || q.celebrated || mainOpen) return
  const now = await $.clock.now()
  await refreshAgents($, now)
  if (token !== endToken || mainOpen) return
  if (agentsBusy > 0) {
    dbg($, now, '防抖到点, 但又有子代理在跑: 不庆祝, 等它们')
    return
  }
  q.celebrated = true
  lastTurnMs = (q.lastEndAt || now) - q.startedAt
  lastTurnTools = q.mainTools
  celebrateUntil = now + (lastTurnMs > 180_000 ? 2600 : 1400)
  noteNow($, '✓ 搞定 ' + dur(lastTurnMs), GOOD, now) // (它会重画)
  dbg($, now, `防抖触发: 搞定 ${dur(lastTurnMs)} (从提问开始到最后一段结束 ${lastTurnMs}ms)`)
  // 庆祝结束时再画一次, 让只有客户端的会话也能回到平常的样子
  $.clock.after(celebrateUntil - now + 100, () => redraw($))
}

// 调试日志: "[usage-hud] 2026-10-07T12:01:16.533Z 防抖开始 等 2000ms"; 不开就什么都不写
function dbg($: any, now: number, text: string) {
  if (!debugOn) return
  let at = String(now)
  try {
    at = new Date(now).toISOString()
  } catch {}
  try {
    $.ui.log(`[usage-hud] ${at} ${text}`, { to: 'debug' })
  } catch {}
}

async function openAgents($: any, fromPress: boolean) {
  if (fromPress && !(await pressOk($, 'agents'))) return
  try {
    const r = await $.ui.open({ id: AGENTS_PANE, title: '子代理', focus: true, closeOnEscape: true })
    if (r && r.isPlaced === false) $.ui.toast('子代理看板等终端再宽一点才能显示: ' + String(r.reason ?? ''))
  } catch (err) {
    $.ui.toast('子代理看板打不开: ' + String(err))
  }
}

async function refreshRepo($: any) {
  try {
    // 项目名和分支都按项目根目录算, Claude 在终端里 cd 进子目录也不变
    cwd = await projectDir($)
    project = safe(cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd)
    const b = await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 5000 })
    branch = b.exitCode === 0 ? safe(b.stdout.trim()) : ''
    dirty = 0
    if (branch) {
      const s = await $.process.run(['git', 'status', '--porcelain', '-uno'], { cwd, timeoutMs: 5000 })
      dirty = s.exitCode === 0 ? s.stdout.split('\n').filter((l: string) => l.trim()).length : 0
    }
  } catch {
    branch = ''
  }
}

async function readEffortFromSettings($: any, force: boolean) {
  if (effort && !force) return
  try {
    const s: any = await $.settings.read()
    const v = s?.modelSettings?.[modelId]?.effortLevel ?? s?.effortLevel
    if (typeof v === 'string' && v) effort = v
  } catch {}
}

async function loadPrefs($: any) {
  try {
    const [l, crab, five] = await Promise.all([$.store.get('layout'), $.store.get('crab'), $.store.get('noFive')])
    if (LAYOUTS.includes(l)) layout = l
    // v0.16: 终端版面板固定在输入框下方, store 里以前存的 position (测试曾写进过 above) 一律不读
    // 螃蟹默认开; store 里没有记录也当开 (不沿用上一个会话模块里的值)
    crabOn = crab !== false
    noFive = five === true
  } catch {}
}

async function checkMilestones($: any) {
  try {
    const u = await $.session.usage()
    const usd = u.cost?.usd ?? 0
    const hit = COST_MILESTONES.filter(x => usd >= x).pop() ?? 0
    if (!milestonePrimed) {
      milestonePrimed = true // 第一次只记下当前档位: 恢复的老会话不补发提示
      costMilestone = hit
    } else if (hit > costMilestone) {
      costMilestone = hit
      $.ui.toast(`本会话已花 $${hit}，螃蟹替你记着账`)
    }
    checkResets($, (u.rateLimits ?? []) as Limit[], await $.clock.now())
    const pct = u.context.percent ?? 0
    if (pct >= 80 && !warnedContext) {
      warnedContext = true
      $.ui.toast(`上下文已用 ${pct}%，螃蟹开始冒汗了，可以考虑 /compact`)
    }
    if (pct < 50) warnedContext = false
  } catch {}
}

// 会话记录文件: ~/.claude/projects/<工作目录里非字母数字都换成 ->/<会话 id>.jsonl (设置了 CLAUDE_CONFIG_DIR 就在它下面)
// 会话记录按"启动时的目录"存放; 中途 cd 过的话这里猜错, 统计脚本会再按会话 id 去各项目目录里找
type Where = { guess: string; id: string; root: string }
async function guessTranscript($: any): Promise<Where> {
  try {
    const id = await $.session.id()
    const here = await projectDir($)
    const sys = await detectOS($, here)
    const sep = sepOf(sys)
    const base = await claudeDir($, sys)
    const root = base ? base + sep + 'projects' : ''
    const dir = here.replace(/[^a-zA-Z0-9]/g, '-')
    return { guess: root ? root + sep + dir + sep + id + '.jsonl' : '', id, root }
  } catch {
    return { guess: '', id: '', root: '' }
  }
}

// 用 scripts/count-tokens.js 把会话记录 (含子代理) 里已有的 token 数一遍; 实时累加从这一刻重新开始
async function countTokens($: any, where: Where) {
  if (!where.guess && !where.id) {
    tokState = 'failed' // 找不到会话记录: 只显示本次启动以来的实时累计
    return
  }
  transcriptPath = where.guess
  tokState = 'counting'
  tokLive = zeroTok()
  try {
    const sep = sepOf(await detectOS($, cwd || (await projectDir($))))
    const script = $.plugin.root.replace(/[\\/]+$/, '') + sep + 'scripts' + sep + 'count-tokens.js'
    const r = await $.process.run(['node', script, where.guess, where.id, where.root], { timeoutMs: 120_000 })
    const j = JSON.parse(r.stdout)
    if (!j.found) throw new Error('transcript not found')
    if (j.path) transcriptPath = j.path
    tokBase = { input: j.input || 0, output: j.output || 0, cacheRead: j.cacheRead || 0, cacheWrite: j.cacheWrite || 0 }
    tokState = 'ready'
  } catch {
    tokBase = zeroTok()
    tokState = 'failed'
  }
  redraw($)
}

function showTokenDetail($: any) {
  const t = tokSum()
  const scope = tokState === 'ready' ? '本会话（含子代理）' : '本次启动以来'
  $.ui.toast(
    `${scope}共 ${big(tokTotal(t))} token：读缓存 ${big(t.cacheRead)}，写缓存 ${big(t.cacheWrite)}，新输入 ${big(t.input)}，输出 ${big(t.output)}。读缓存最便宜，单价约为新输入的十分之一。`,
    { timeoutMs: 9000 },
  )
}

async function diskVersion($: any): Promise<string> {
  try {
    const pj = JSON.parse(await $.fs.read($.plugin.root.replace(/[\\/]+$/, '') + '/.claude-plugin/plugin.json'))
    return String(pj.version ?? '')
  } catch {
    return ''
  }
}

// 只在客户端会话里做 (终端会话的插件目录本来就会被监视, 改了自动重载)
// 重载后新模块会重新记下版本号, 所以不会反复重载
async function checkForUpdate($: any) {
  if (reloadAsked || hasTerminal || !loadedVersion) return
  const v = await diskVersion($)
  if (v && v !== loadedVersion) {
    reloadAsked = true
    try {
      await $.command.run({ command: 'reload-plugins' })
    } catch {
      reloadAsked = false
    }
  }
}

// 状态格的事件 (以前是散步道的气泡): 亮 NOTE_MS, 新的顶掉旧的; 到点再画一次让它收起来
function noteNow($: any, text: string, color: string, now: number, bold = false) {
  note = { text, color, bold, until: now + NOTE_MS }
  $.clock.after(NOTE_MS + 50, () => redraw($))
  redraw($)
}
const noteOn = (now: number) => (note && now < note.until ? note : undefined)
// 配速第一次变成 "会用完" (每个窗口只说一次) / 上下文第一次到 COMPACT_AT -> 事件; 刚启动时第一次读数不算 "变成"
function noteTalk($: any, now: number, pct: number | undefined, pairs: Array<[Limit | undefined, Pace | undefined]>) {
  for (const [l, p] of pairs) {
    if (!l || !p) continue
    const prev = wasRunOut[l.kind]
    wasRunOut[l.kind] = p.willRunOut
    const key = l.kind + '|' + (l.resetsAt ?? '')
    if (p.willRunOut && prev === false && p.runOutIn !== undefined && !saidRunOut.has(key)) {
      saidRunOut.add(key)
      noteNow($, '慢点！' + durShort(p.runOutIn) + '用完', WARN, now, true)
    }
  }
  if (pct === undefined) return
  if (pct >= COMPACT_AT && !saidCtxFull) {
    saidCtxFull = true
    noteNow($, '上下文快满了，可以压缩', AMBER, now)
  }
  if (pct < 50) saidCtxFull = false
}
// 正在做 (或刚做完, 还在 TOOL_HOLD_MS 里) 的主线程工具
const shownTool = (now: number) => (mainTool && now < mainTool.until ? mainTool.name : '')
// 面板螃蟹这一帧的处境 (终端和客户端共用)
function sceneOf(working: boolean, now: number): Scene {
  const hop = now - jumpAt
  const bye = now - kidByeAt
  return {
    working,
    kind: toolKind(shownTool(now)),
    pct: lastPct,
    celebrating: now < celebrateUntil,
    sleeping: !working && asleep(now),
    agents: agentsNow,
    mood,
    hop: hop >= 0 && hop < JUMP_FRAMES * FRAME_MS ? Math.floor(hop / FRAME_MS) : undefined,
    kidBye: agentsNow === 0 && bye >= 0 && bye < KID_BYE_MS ? bye / KID_BYE_MS : undefined,
  }
}

// 终端面板的螃蟹这一帧画成什么 (精简版 1 行那只 / 完整版 15x3 那只)
const crabCells = (s: Scene, mini: boolean) => (mini ? encode(miniPx(s, frame), MINI_W, 1) : encode(scenePx(s, frame), SPRITE_W, 3))
// buildView 画终端螃蟹时走这里, 顺便记下画了什么
function termCrab(s: Scene, mini: boolean): string {
  const cells = crabCells(s, mini)
  lastCrab = { mini, cells }
  return cells
}

function needsFrame(now: number): boolean {
  // 只有客户端: 每 15 秒刷新一次时钟, 其余靠事件 (工具开始/结束、一轮结束、用量变化) 触发
  if (!hasTerminal) return frame % 100 === 0
  if (engineWorking || tweening) return true
  // 螃蟹: 直接算这一帧会画成什么, 和上次画的不一样才重画 (眨眼、挥手、泡泡、跳一下、小螃蟹、汗滴 ... 的节奏都只在 sprites.ts 里)
  if (lastCrab && crabCells(sceneOf(false, now), lastCrab.mini) !== lastCrab.cells) return true
  if (agentsNow > 0) return frame % 2 === 0 // 状态格的跳动条两帧走一相
  return frame % 13 === 0
}

// ---------------- 画面 ----------------
// 终端版和客户端版共用的一次取数: 面板和客户端卡片的数据 (panel.ts 的 PanelInfo) + 螃蟹这一帧的处境
async function snapshot($: any, working: boolean): Promise<{ info: PanelInfo; scene: Scene }> {
  const now = await $.clock.now()
  engineWorking = working
  tweening = false
  let u: any = { context: { window: 0 }, rateLimits: [] }
  try {
    u = await $.session.usage()
  } catch {}
  const ctxWindow: number | undefined = u.context?.window || undefined
  const ctxTokens: number | undefined = u.context?.tokens ?? resumeCtx
  const pct: number | undefined =
    u.context?.percent ?? (resumeCtx !== undefined && ctxWindow ? Math.min(100, Math.round((resumeCtx / ctxWindow) * 100)) : undefined)
  lastPct = pct ?? 0
  await syncAgents($, now)
  const limits = (u.rateLimits ?? []) as Limit[]
  const showFive = hasFive($, limits)
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  const p5 = paceOf(five, now)
  const pw = paceOf(week, now)
  mood = moodOf(p5, pw)
  noteTalk($, now, pct, [
    [five, p5],
    [week, pw],
  ])
  const tk = tokSum()
  const info: PanelInfo = {
    now,
    working,
    tool: shownTool(now),
    lastTurnMs,
    lastTurnTools,
    note: noteOn(now),
    modelId,
    effort,
    project,
    branch,
    dirty,
    startedAt: u.startedAt,
    usd: u.cost ? u.cost.usd : undefined,
    pct,
    ctxTokens,
    ctxWindow,
    five,
    week,
    showFive,
    turnStartedAt,
    agents: agentsNow,
    toolCounts,
    tokens: { state: tokState, total: tokTotal(tk), output: tk.output },
  }
  return { info, scene: sceneOf(working, now) }
}

// ---------------- 客户端 (桌面 app) 版 ----------------
async function buildDesktop($: any, els: any, cols: number, working: boolean) {
  const { Box, Svg } = els
  const s = await snapshot($, working)
  // 卡片上写什么 (dashData)、螃蟹摆什么样 (deskCrab)、卡片多宽 (deskLayout) 都是纯函数, README 动图也用它们
  const data = dashData(s.info)
  lastDesktopCols = cols
  const { compact, dashW, crabScale, crabSize } = deskLayout(cols, layout === 'compact')
  // 螃蟹直接画在卡片上 (没有底板/边框); 当普通图片显示, SMIL 动画照样会动
  const crab = crabSvg(deskCrab(s.scene), crabScale)
  const dash = dashSvg(data, { compact, width: dashW })
  return (
    <Box key="hud-d-row" flexDirection="row" alignItems="center" columnGap={2}>
      <Box key="hud-d-crab" flexShrink={0}>
        <Svg key="crab-svg" source={crab} alt="用量面板的小螃蟹" width={crabSize.w} height={crabSize.h} />
      </Box>
      {/* 估计的宽度偏大时, 这个容器允许仪表盘等比缩小, 不会被截断 */}
      <Box key="hud-d-dash" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Svg key="dash-svg" source={dash} alt={`上下文 ${data.ctx.pct ?? '--'}%，` + (data.five ? `5小时 ${data.five.pct ?? '--'}%，` : '') + `本周 ${data.week.pct ?? '--'}%`} />
      </Box>
    </Box>
  )
}

// 终端 PromptHint 的用量面板: 取数 (snapshot) -> 排版 (panel.ts 的 panelView, 纯函数, README 动图也用它) -> 画成组件
async function buildView($: any, els: any, surface: string, W: number, working: boolean) {
  const { Box, Text, Button } = els
  const isTerm = surface === 'terminal'
  // 取数和终端 / 客户端共用 (snapshot): 用量、上下文、子代理、额度配速、心情、事件、螃蟹的处境
  const { info, scene } = await snapshot($, working)
  // v0.17.2: 终端把螃蟹画在面板左边; /hud crab off 时不画 (别的界面画颜文字)
  const panelCrab = !isTerm || crabOn
  // 这一帧真画了螃蟹, termCrab 会再记上; 没画 (关掉了 / 精简版放不下) 就不用 needsFrame 再比
  if (isTerm) lastCrab = undefined
  // 三根条的数字滚动 (有状态, 所以在这里算好再交给 panelView)
  const eased = { ctx: ease('ctx', info.pct), h5: ease('h5', info.five?.percentUsed), wk: ease('wk', info.week?.percentUsed) }
  const view = panelView({ ...info, W, term: isTerm, crab: panelCrab, compact: layout === 'compact', frame, shown: eased })

  // 片段 -> 组件
  const press: Record<Act, () => void> = {
    model: () => runSlash($, 'model'),
    effort: () => runSlash($, 'effort'),
    context: () => runSlash($, 'context'),
    compact: () => runSlash($, 'compact'),
    usage: () => runSlash($, 'usage', USAGE_URL),
    project: () => openProject($),
    agents: () => openAgents($, true),
    token: () => showTokenDetail($),
  }
  // 螃蟹: 终端是像素画 (精简版 8x1, 完整 / 中等版 15x3, 右边 3 列是道具); 其他界面是颜文字
  const crab = (mini: boolean) =>
    isTerm ? (
      <els.Raster key={mini ? 'crab-mini' : 'crab'} columns={mini ? MINI_W : SPRITE_W} rows={mini ? 1 : 3} cells={termCrab(scene, mini)} />
    ) : (
      <Text key="crab-k" color={ACCENT}>
        {kaomoji(scene)}
      </Text>
    )
  const part = (p: Part, mini: boolean) =>
    p.t === 'text' ? (
      <Text key={p.key} color={p.color} bold={p.bold}>
        {p.text}
      </Text>
    ) : p.t === 'button' ? (
      <Button key={p.key} label={p.label} plain dimColor={p.dim} onPress={press[p.act]} />
    ) : (
      crab(mini)
    )
  const cell = (c: PanelCell, mini = false) => (
    <Box key={c.key} width={c.w} flexShrink={0} flexDirection="row" overflow="hidden">
      {c.parts.map(p => part(p, mini))}
    </Box>
  )

  if (view.layout === 'compact') {
    return (
      <Box key="hud" flexDirection="row" columnGap={view.gap} height={1} paddingLeft={view.marginL} paddingRight={view.marginR}>
        {view.cells.map(c => cell(c, true))}
      </Box>
    )
  }
  const sprite = !view.crab ? null : (
    <Box key="sprite" width={SPRITE_W} flexShrink={0} height={3}>
      {crab(false)}
    </Box>
  )
  return (
    <Box key="hud" flexDirection="row" columnGap={sprite ? CRAB_GAP : 0} paddingLeft={view.marginL} paddingRight={view.marginR}>
      {sprite}
      <Box key="info" flexDirection="column" width={view.width} flexShrink={0}>
        {view.rows.map((cells, r) => (
          <Box key={'r' + (r + 1)} flexDirection="row" columnGap={view.gap} height={1}>
            {cells.map(c => cell(c))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ---------------- 每轮收据 ----------------
function lineCount(s: unknown): number {
  if (typeof s !== 'string' || s === '') return 0
  const n = s.split('\n').length
  return s.endsWith('\n') ? n - 1 : n
}
// 按工具输入粗算 +/-: Edit 新旧字符串的行数, Write 内容的行数 (删掉的旧内容不知道, 不算)
function countEdit(run: { files: Set<string>; add: number; del: number }, e: any) {
  const path = String(e.file_path ?? e.notebook_path ?? '')
  if (path) run.files.add(path)
  switch (String(e.tool)) {
    case 'Edit':
      run.add += lineCount(e.new_string)
      run.del += lineCount(e.old_string)
      break
    case 'MultiEdit':
      for (const ed of Array.isArray(e.edits) ? e.edits : []) {
        run.add += lineCount(ed?.new_string)
        run.del += lineCount(ed?.old_string)
      }
      break
    case 'Write':
      run.add += lineCount(e.content)
      break
    case 'NotebookEdit':
      if (e.edit_mode !== 'delete') run.add += lineCount(e.new_source)
      break
  }
}

// TurnDuration 行和这一轮对上了吗:
//   TurnDuration 的 requestId 是那一行消息的 id, 不是 turnId, 所以按 "什么时候第一次画出来" + 时长对
//   - 只看最近一轮的收据; 一张收据只配一行
//   - 这一行第一次画出来的时间要在这一轮开始之后、结束后 5 秒之内 (更早的行是之前的回合)
//   - 行上的 durationMs 和 turn.complete 的 durationMs 相差不超过 max(2 秒, 5%)
//   - 配上了就按 requestId 钉住 (滚动重画还是同一张)
//   - 确定以后也配不上的行马上记成 "不配": 以后的回合都在现在之后才开始, 只有 "正在跑的这一轮" 和
//     "刚结束这一轮的 5 秒窗口" 还有机会; 面板动画每 0.15 秒会让所有 TurnDuration 行重画, 这样它们都走最省的路
const ROW_LATE_MS = 5000
export function receiptFor(id: string, durationMs: number | undefined, now: number): Receipt | undefined {
  if (!id) return undefined
  if (id in receiptOf) return receiptOf[id] ?? undefined
  const seen = (rowSeenAt[id] ??= now)
  const r = lastReceipt
  const inWindow = !!r && !r.boundTo && seen >= r.startedAt && seen <= r.completedAt + ROW_LATE_MS
  const near = (x: Receipt) => typeof durationMs !== 'number' || Math.abs(durationMs - x.durationMs) <= Math.max(2000, x.durationMs * 0.05)
  // 先比累计 (这一行写的是整次提问的时长 -> 整次提问的合计), 再比这一段
  const hit = r && inWindow ? (near(r.cum) ? r.cum : near(r.seg) ? r.seg : undefined) : undefined
  if (r && hit) {
    r.boundTo = id
    receiptOf[id] = hit
    return hit
  }
  const maybeRunning = !!turnRun && seen >= turnRun.startedAt
  const maybeLast = inWindow && now <= (r?.completedAt ?? 0) + ROW_LATE_MS
  if (!maybeRunning && !maybeLast) receiptOf[id] = null
  return undefined
}
// 引擎 (2.1.289) 写时长的办法, 照抄: 不到 1 分钟 "24s" (秒数向下取整); 再长 "9m 6s" / "1h 2m 3s" / "1d 2h 3m"
export function engineDur(ms: number): string {
  if (ms < 60000) {
    if (ms === 0) return '0s'
    if (ms < 1) return (ms / 1000).toFixed(1) + 's'
    return Math.floor(ms / 1000) + 's'
  }
  let d = Math.floor(ms / 86400000)
  let h = Math.floor((ms % 86400000) / 3600000)
  let m = Math.floor((ms % 3600000) / 60000)
  let s = Math.round((ms % 60000) / 1000)
  if (s === 60) (s = 0), m++
  if (m === 60) (m = 0), h++
  if (h === 24) (h = 0), d++
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}
// 引擎那行占几格: 2 格符号 + "Cooked for 24s · done 8:13 PM"; pending > 0 (这一段可能写成 "Waiting for N
//   background agents to finish") 时取两种写法里宽的那个; clockW = "8:13 PM" 这段的宽度 (0 = 没有 "· done")
// 宁可估宽 (收据少写一点), 不能估窄 (引擎那行被挤短, 字会折到下一行)
export function engineRowWidth(word: string, durationMs: number, pending: number, clockW: number): number {
  const done = 2 + dw(`${word} for ${engineDur(durationMs)}`) + (clockW > 0 ? dw(' · done ') + clockW : 0)
  if (pending <= 0) return done
  return Math.max(done, 2 + dw(`Waiting for ${pending} background agent${pending === 1 ? '' : 's'} to finish`))
}
// 收据放在引擎那行右边 (v0.16.4: 引擎节点的祖先 Box 不能定宽, 收据只能靠右): 引擎那行按整行宽往里缩,
//   收据 Box 不缩; 所以先挑一种写法保证 "引擎那行字的宽 + 收据宽 <= 列数": 整行放得下就全写; 放不下先省
//   "改 N 个文件"; 还放不下就给收据 Box 定宽 (= 剩下的格数) 让 Text 截; 剩下不到 4 格就不放
// 返回引擎那行估的宽、收据的字, 要截时还有收据 Box 的宽
export function receiptFit(r: Receipt, word: string, durationMs: number, cols: number, clockW: number): { engineW: number; text: string; width?: number } | undefined {
  const engineW = engineRowWidth(word, durationMs, r.pending ?? 0, clockW)
  const room = cols - engineW
  const full = receiptText(r)
  if (!full || room < 4) return undefined
  if (dw(full) <= room) return { engineW, text: full }
  const short = receiptText({ ...r, files: 0 }) || full
  if (dw(short) <= room) return { engineW, text: short }
  return { engineW, text: short, width: room }
}
// "done 8:13 PM" 里时间的宽度: 和引擎一样按 LC_ALL / LC_TIME / LANG (都没有就用系统默认) 写成 "8:13 PM";
// 前后各错 2 秒也算一遍取宽的 (引擎记的结束时间和这里差几毫秒, 正好跨过整点时位数会变); 没有 Intl 就按 8 格
let clockLocale: string | undefined
let clockFmt: { locale: string | undefined; f: Intl.DateTimeFormat } | undefined // 同一种语言只建一次
export function clockWidth(at: number): number {
  try {
    if (!clockFmt || clockFmt.locale !== clockLocale) clockFmt = { locale: clockLocale, f: new Intl.DateTimeFormat(clockLocale, { hour: 'numeric', minute: '2-digit' }) }
    const f = clockFmt.f
    return Math.max(...[at - 2000, at, at + 2000].map(t => dw(f.format(new Date(t)))))
  } catch {
    return 8
  }
}
function localeOf(v: string): string | undefined {
  if (!v || v === 'C' || v === 'POSIX') return undefined
  const tag = v.split('.')[0]!.split('@')[0]!.replace(/_/g, '-')
  if (!tag) return undefined
  try {
    new Intl.DateTimeFormat(tag)
    return tag
  } catch {
    return undefined
  }
}
async function readClockLocale($: any) {
  try {
    const v = (await $.env.get('LC_ALL')) || (await $.env.get('LC_TIME')) || (await $.env.get('LANG')) || ''
    clockLocale = localeOf(String(v))
  } catch {
    clockLocale = undefined
  }
}

// ---------------- 子代理看板 (侧边面板) ----------------
// 每一行写什么在 panel.ts 的 agentsPaneView (README 动图也用它); 这里只画成组件
async function buildAgentsPane($: any, els: any, W: number) {
  const { Box, Text } = els
  const now = await $.clock.now()
  await syncAgents($, now)
  const v = agentsPaneView(
    [...kids.values()].filter(k => k.known),
    now,
    W,
  )
  return (
    <Box key="kids" flexDirection="column" width={v.width}>
      {v.lines.map(l =>
        l.bare ? (
          <Text key={l.key} color={l.parts[0].color}>
            {l.parts[0].text}
          </Text>
        ) : (
          <Box key={l.key} flexDirection="row" height={1}>
            {l.parts.map(x => (
              <Text key={x.key} color={x.color} bold={x.bold}>
                {x.text}
              </Text>
            ))}
          </Box>
        ),
      )}
    </Box>
  )
}

// 测试用: 不经过界面, 直接画某个状态下的螃蟹和状态文字
type PreviewOpts = Partial<Omit<Scene, 'kind'>> & { frames?: number }
function previewOne(tool: string, { frames: _, ...opts }: PreviewOpts): Scene {
  return { working: true, pct: 30, celebrating: false, sleeping: false, agents: 0, ...opts, kind: toolKind(tool) }
}
export function previewScene(tool: string, opts: PreviewOpts = {}) {
  const out: string[] = []
  for (let f = 0; f < (opts.frames ?? 24); f++) {
    frame = f
    const s = previewOne(tool, opts)
    out.push(crabCells(s, false), crabCells(s, true))
  }
  frame = 0
  return { label: toolLabel(tool), kind: toolKind(tool), frames: out }
}
// 测试用: 同上, 但给出像素颜色 (-1 = 空), 方便检查小螃蟹画在哪里
export function previewPixels(tool: string, opts: PreviewOpts = {}) {
  const big: number[][][] = []
  const mini: number[][][] = []
  for (let f = 0; f < (opts.frames ?? 24); f++) {
    frame = f
    const s = previewOne(tool, opts)
    big.push(scenePx(s, f))
    mini.push(miniPx(s, f))
  }
  frame = 0
  return { big, mini }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadPrefs($)
    // 状态格的事件和螃蟹的小动作从头开始
    note = undefined
    saidCtxFull = false
    saidRunOut.clear()
    for (const k of Object.keys(wasRunOut)) delete wasRunOut[k]
    mainTool = undefined
    jumpAt = -Infinity
    kidByeAt = -Infinity
    lastCrab = undefined
    // 一次提问的记账从头开始
    ask = undefined
    mainOpen = false
    askFromNext = false
    submitSinceTurn = ''
    lastReceipt = undefined
    endToken += 1
    endArmed = 0
    agentsBusy = 0
    lastKidEndAt = -Infinity
    try {
      debugOn = String((await $.env.get('USAGE_HUD_DEBUG')) ?? '') === '1'
    } catch {
      debugOn = false
    }
    await readClockLocale($)
    loadedVersion = await diskVersion($)
    lastActive = await $.clock.now()
    try {
      modelId = await $.session.model()
    } catch {}
    await readEffortFromSettings($, false)
    await refreshRepo($)
    await checkMilestones($)
    // 在后台数历史 token, 不耽误会话启动
    // classic.SessionStart 先到时它已经开数了, 这里不重复
    if (tokState === 'idle') {
      const where = await guessTranscript($)
      void countTokens($, transcriptPath ? { ...where, guess: transcriptPath } : where)
    }
    $.clock.every(FRAME_MS, async () => {
      tick += 1
      if (tick % 40 === 5) void watchLimits($) // 约每 6 秒看一次额度有没有恢复 (面板隐藏时也看)
      // 提问还没做完、主线程闲着、还没开始防抖 (在等子代理): 约每秒看一次列表, 子代理都结束了就开始防抖
      if (tick % 7 === 3 && ask && !ask.celebrated && !mainOpen && !endArmed) void syncAgents($, await $.clock.now())
      if (layout === 'off') return
      frame += 1
      if (needsFrame(await $.clock.now())) redraw($)
      if (frame % 400 === 7) void checkForUpdate($) // 约每 60 秒
      if (lastDesktopCols && lastDesktopCols !== savedDesktopCols) {
        savedDesktopCols = lastDesktopCols
        try {
          await $.store.set('desktopCols', lastDesktopCols)
        } catch {}
      }
    })
    try {
      await $.command.register({
        name: 'hud',
        description: '用量面板 (固定在输入框下方)：完整 → 精简 → 隐藏 循环；/hud agents 子代理看板，/hud crab 开关螃蟹',
        argumentHint: '[agents|crab]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('usage-hud: /hud 注册失败 ' + String(err))
    }
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()
    // /hud agents: 子代理看板 (不注册顶级的 /agents, 那是内置命令)
    if (/^(agents?|kids?|代理|子代理)/.test(arg)) {
      await openAgents($, false)
      return { text: '已打开子代理看板（Esc 关闭）' }
    }
    // /hud crab [on|off]: 面板左边的螃蟹 (只在终端); 不带参数就切换
    if (/^(crab|蟹|螃蟹)/.test(arg)) {
      const rest = arg.replace(/^(crab|蟹|螃蟹)\s*/, '')
      crabOn = /^(on|开|1)/.test(rest) ? true : /^(off|关|0)/.test(rest) ? false : !crabOn
      await $.store.set('crab', crabOn)
      redraw($)
      return { text: crabOn ? '螃蟹已打开（面板左边）' : '螃蟹已关闭（/hud crab 再打开）' }
    }
    // v0.17: 终端版面板和螃蟹都固定在输入框下方; /hud top|bottom 不再挪面板, 也不写 store
    if (/^(top|above|up|上)/.test(arg) || /^(bottom|below|down|下)/.test(arg)) {
      return { text: '终端版面板和螃蟹都固定在输入框下方' }
    }
    layout = LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length]
    await $.store.set('layout', layout)
    redraw($)
    return { text: '用量面板：' + { full: '完整', compact: '精简', off: '已隐藏（再输入 /hud 打开）' }[layout] }
  })

  // 换模型 / 换档位后马上刷新
  on('command.run', { command: ['model', 'effort'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      modelId = await $.session.model()
    } catch {}
    await readEffortFromSettings($, true)
    redraw($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as any).agentId) {
      engineWorking = true
      turnStartedAt = await $.clock.now()
      lastActive = turnStartedAt
      turnTools = 0
      // 每轮收据: 记下开始时的花费, 结束时取差
      let usd0: number | undefined
      try {
        usd0 = (await $.session.usage()).cost?.usd
      } catch {}
      turnRun = { turnId: String(e.turnId ?? ''), startedAt: turnStartedAt, usd0, files: new Set(), add: 0, del: 0, tools: 0 }
      // 新的一段开始: "提问做完" 的等待取消
      mainOpen = true
      cancelEnd($, turnStartedAt, 'turn.start')
      // 这一段属于哪次提问: 用户排队的提问 -> 新提问从这里开始; 其余 (task-notification, 或前面没有
      //   prompt.submit: 闲着时送回的后台结果就走这条路) -> 延续; 已经庆祝过的提问照样只记账, 不再庆祝
      const via = submitSinceTurn
      submitSinceTurn = ''
      if (askFromNext || !ask) {
        ask = newAsk(turnStartedAt, usd0)
        dbg($, turnStartedAt, '提问开始 (排队的提问开跑)')
      }
      askFromNext = false
      ask.segments += 1
      dbg($, turnStartedAt, `一段开始 ${String(e.turnId ?? '')} (第 ${ask.segments} 段; 前面的 prompt.submit: ${via || '没有'})`)
      const h = new Date().getHours()
      if (h >= 1 && h < 5 && !nightNoticed) {
        nightNoticed = true
        $.ui.toast(`已经凌晨 ${h} 点了，螃蟹陪你干活，也记得早点休息`)
      }
      redraw($)
    }
    return next(e)
  })

  // 每次向模型发请求: 主线程记下模型和档位; 所有线程 (含子代理) 的 token 都累加
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      if (e.effort !== undefined && e.effort !== null) effort = String(e.effort)
      if (e.model) modelId = e.model
    }
    const result = yield* next(e)
    if (result?.usage) {
      // 主线程和认得的子代理才算 (和会话记录一致); 还没认出来的 id 先记着, 引擎自己的分叉一直认不出来就不算
      const id = e.agentId ? String(e.agentId) : ''
      if (!id || kids.get(id)?.known) addTok(tokLive, result.usage)
      else {
        const t = tokPending.get(id) ?? zeroTok()
        addTok(t, result.usage)
        tokPending.set(id, t)
        if (tokPending.size > 50) tokPending.delete(tokPending.keys().next().value as string)
      }
      redraw($)
    }
    return result
  })

  // 启动 / 恢复 / /clear 时拿到会话记录的准确路径; 恢复时顺便拿到当时的上下文大小
  on('classic.SessionStart', async ($, e, next) => {
    const src = String((e as any).source ?? '')
    const path = String((e as any).transcript_path ?? '')
    if (src === 'resume' || src === 'fork') resumeCtx = (e as any).context_tokens
    if (src === 'clear') {
      resumeCtx = undefined
      milestonePrimed = false // 花费从 0 重新算, 里程碑提示也重新开始
      costMilestone = 0
      toolCounts = {}
      totalTools = 0
      lastTurnMs = 0
      lastTurnTools = 0
    }
    if (path && (path !== transcriptPath || src === 'clear' || src === 'resume' || src === 'fork')) void countTokens($, { guess: path, id: '', root: '' })
    return next(e)
  })

  // 子代理看板: 开始 / 结束时间、类型、最后一句话
  on('classic.SubagentStart', async ($, e, next) => {
    const id = String((e as any).agent_id ?? '')
    if (id) {
      const now = await $.clock.now()
      const k = kidOf(id, now)
      if (!k.known) {
        k.startedAt = now
        k.lastAt = now
      }
      kidKnown(k)
      k.status = 'running'
      k.ran = true
      k.endedAt = undefined
      k.endNoted = false
      if (ask) ask.bgKids.add(id)
      dbg($, now, `子代理开始 ${id} (SubagentStart)`)
      if ((e as any).agent_type) k.type = safe(String((e as any).agent_type))
      redraw($)
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const id = String((e as any).agent_id ?? '')
    if (id) {
      const now = await $.clock.now()
      const k = kidOf(id, now)
      kidKnown(k)
      k.ran = true
      if (k.endedAt === undefined) k.endedAt = now
      if (k.status === 'running') k.status = 'completed'
      kidEnded($, k, now, 'SubagentStop')
      if ((e as any).agent_type && !k.type) k.type = safe(String((e as any).agent_type))
      const last = String((e as any).last_assistant_message ?? '')
      if (last) k.note = clip(safe(last.replace(/\s+/g, ' ')), 120)
      pruneKids()
      await syncAgents($, now) // 列表里它也不在跑了、主线程闲着 -> 开始防抖
      redraw($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // 主线程的工具: 至少做 TOOL_HOLD_MS 的动作 (只跑几十毫秒的工具在两帧之间就结束了, 不撑着一帧也画不出来);
    //   开始时刻只取不等 (不推迟工具开始), 做完时再算 until
    const mine = e.agentId ? undefined : (mainTool = { name: e.tool, until: Infinity })
    const t0: Promise<number> | undefined = mine ? $.clock.now() : undefined
    if (mine) turnTools += 1
    totalTools += 1
    toolCounts[e.tool] = (toolCounts[e.tool] ?? 0) + 1
    // 收据: 主线程一轮进行中, 所有线程 (含子代理) 的工具都算这一轮的
    const run = turnRun
    if (run) run.tools += 1
    // 整次提问的合计: 主线程两段之间后台子代理用的工具也算
    const q = ask
    if (q) {
      q.tools += 1
      if (!e.agentId) q.mainTools += 1
    }
    // 看板: 子代理的最后动静 / 最后工具 / 次数
    const kid = e.agentId ? kidOf(e.agentId, await $.clock.now()) : undefined
    if (kid) {
      kid.lastAt = await $.clock.now()
      kid.lastTool = e.tool
      kid.tools += 1
    }
    if (totalTools % 100 === 0) {
      celebrateUntil = (await $.clock.now()) + 1600
      $.ui.toast(`本会话第 ${totalTools} 次工具调用，螃蟹给你鼓掌`)
    }
    redraw($)
    let ran: any
    try {
      ran = await next(e)
      return ran
    } finally {
      // 做完再撑一小会 (连着几个工具之间不闪回 "思考中"); 读时钟不等, 不推迟工具结果
      if (mine && t0) void Promise.all([t0, $.clock.now()]).then(([a, b]) => (mine.until = Math.max(a + TOOL_HOLD_MS, b + 2 * FRAME_MS)))
      if (kid) kid.lastAt = await $.clock.now()
      // 改文件只算真的改成了的 (没被拒、没报错)
      const edited = ran && !ran.deny && !ran.isError && toolKind(String(e.tool)) === 'edit'
      if (run && edited) countEdit(run, e)
      if (q && edited) countEdit(q, e)
      redraw($)
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (!(e as any).agentId) {
      const now = await $.clock.now()
      // 每轮收据: 在 next(e) 之前落到模块变量里, TurnDuration 那行画出来时就能找到
      const run = turnRun
      turnRun = undefined
      let usd1: number | undefined
      try {
        usd1 = (await $.session.usage()).cost?.usd
      } catch {}
      const q = ask
      if (q) q.lastEndAt = now
      if (run && (!e.turnId || !run.turnId || e.turnId === run.turnId)) {
        // 这一段
        const seg: Receipt = {
          turnId: run.turnId,
          startedAt: run.startedAt,
          completedAt: now,
          durationMs: typeof e.durationMs === 'number' ? e.durationMs : now - run.startedAt,
          usd: run.usd0 !== undefined && usd1 !== undefined ? Math.max(0, usd1 - run.usd0) : undefined,
          files: run.files.size,
          add: run.add,
          del: run.del,
          tools: run.tools,
        }
        // 从提问开始的累计 (只有一段时就是这一段)
        const cum: Receipt =
          q && q.segments > 1
            ? {
                turnId: run.turnId,
                startedAt: q.startedAt,
                completedAt: now,
                durationMs: now - q.startedAt,
                usd: q.usd0 !== undefined && usd1 !== undefined ? Math.max(0, usd1 - q.usd0) : undefined,
                files: q.files.size,
                add: q.add,
                del: q.del,
                tools: q.tools,
              }
            : seg
        lastReceipt = { seg, cum, startedAt: run.startedAt, completedAt: now }
      }
      engineWorking = false
      mainOpen = false
      mainTool = undefined
      lastActive = now
      // 这次提问做没做完: 子代理都结束了、等一小会儿没有新的一段才算 (见 armEnd / endAsk)
      await refreshAgents($, now)
      // 引擎那行会不会写成 "Waiting for N background agents to finish": N 的上限 = 这次提问里跑过的子代理个数
      if (lastReceipt && lastReceipt.completedAt === now) {
        const n = q ? q.bgKids.size : 0
        lastReceipt.seg.pending = n
        lastReceipt.cum.pending = n
      }
      dbg($, now, `一段结束 ${String(e.turnId ?? '')} (引擎写 ${typeof e.durationMs === 'number' ? e.durationMs + 'ms' : '?'}; 列表里在跑的子代理 ${agentsBusy})`)
      armEnd($, now, true)
      await refreshRepo($)
      await checkMilestones($)
      redraw($)
    }
    return next(e)
  })

  // 每轮结束那行 (Crunched for 9m 6s · done 12:06 AM) 后面追加收据; 引擎自己那行原样保留
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.surface !== 'terminal' || layout === 'off') return theirs
    const known = receiptOf[e.requestId]
    if (known === null) return theirs // 已确定不配: 最省的路
    const r = known ?? receiptFor(e.requestId, e.props.durationMs, await $.clock.now())
    if (!r || !receiptText(r)) return theirs
    const cols = e.viewport?.columns ?? 80
    let c = fitOf[e.requestId]
    if (!c || c.cols !== cols) c = fitOf[e.requestId] = { cols, fit: receiptFit(r, e.props.word, e.props.durationMs, cols, clockWidth(r.completedAt)) }
    const fit = c.fit
    if (!fit) return theirs
    const { Box, Text } = $.ui.resolve(e)
    // 引擎节点的祖先 Box 一律不带 width / height / minWidth / minHeight / display / overflow / position / 偏移
    //   (带了引擎拒绝整棵树, 0.16.3 实测). 引擎那行外层是 width 100%, 在这一行里往里缩; 收据 Box 不缩, 靠右.
    //   receiptFit 已经保证 "引擎那行字的宽 + 收据宽 <= 列数", 引擎那行不会被挤得折行
    // 底边对齐: 引擎那行上面可能留了空行 (marginTop), 收据跟在字的那一行
    return (
      <Box flexDirection="row" alignItems="flex-end">
        {theirs}
        <Box key="receipt-box" flexShrink={0} {...(fit.width !== undefined ? { width: fit.width } : {})}>
          <Text key="receipt" dimColor wrap="truncate">
            {fit.text}
          </Text>
        </Box>
      </Box>
    )
  })

  // 子代理看板 (终端和客户端都画)
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const els: any = $.ui.resolve(e)
    return buildAgentsPane($, els, (e.props as any).bodyColumns ?? 60)
  })

  on('session.measure', async ($, e, next) => {
    redraw($)
    return next(e)
  })

  // 你在打字: 只算 "有动静", 睡着的螃蟹马上醒 (客户端的螃蟹没有逐帧比较, 所以这里画一次); 时钟只取不等, 不挡按键回显
  on('prompt.edit', async ($, e, next) => {
    void $.clock.now().then((now: number) => {
      const wake = asleep(now)
      lastActive = now
      if (wake) redraw($)
    })
    return next(e)
  })
  // 有消息送进会话 (v0.16.2 看 origin.kind):
  //   task-notification (后台子代理的结果送回来) = 同一次提问的延续; 其他来源 = 新提问, 上一次没做完的作废
  on('prompt.submit', async ($, e, next) => {
    const kind = String((e as any).origin?.kind ?? 'composer')
    const now = await $.clock.now()
    dbg($, now, `prompt.submit origin=${kind}` + ((e as any).turnId ? ` (塞进正在跑的 ${(e as any).turnId})` : ' (闲着时)'))
    cancelEnd($, now, 'prompt.submit ' + kind)
    submitSinceTurn = kind
    if (kind === 'task-notification') {
      // 后台子代理的结果: 同一次提问的延续
    } else if ((e as any).turnId) {
      askFromNext = true // 主线程跑着时打的字: 排在后面, 它那一段开始时才算新提问
    } else {
      let usd0: number | undefined
      try {
        usd0 = (await $.session.usage()).cost?.usd
      } catch {}
      ask = newAsk(now, usd0)
      askFromNext = false
      dbg($, now, '提问开始')
    }
    // 你自己发出的消息 (终端回车 / 手机网页): 螃蟹跳一下; 后台子代理送回的结果不跳
    if (kind === 'composer' || kind === 'bridge') {
      jumpAt = now
      if (crabOn && layout !== 'off') redraw($) // 第 0 帧马上画, 后面几帧由 needsFrame 的逐帧比较接上
    }
    return next(e)
  })

  // 压缩完成 (主会话的; 预先算好备用的 precompute 不算) -> 状态格亮 "压缩完了"
  on('session.compact', async ($, e, next) => {
    const r: any = await next(e)
    if (!(e as any).agentId && e.trigger !== 'precompute' && r && !r.skip) {
      saidCtxFull = false
      noteNow($, '✓ 压缩完了', GOOD, await $.clock.now())
    }
    return r
  })

  // 输入框上方的横栏: 只有客户端用 (客户端专用的 SVG 面板); 终端什么都不画 (面板和螃蟹都在输入框下方)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (layout === 'off' || e.props.hasSurvey || e.surface !== 'desktop') return next(e)
    const els: any = $.ui.resolve(e)
    return buildDesktop($, els, e.props.bodyColumns ?? 100, !!e.props.isWorking)
  })

  // 终端面板固定在输入框下方: 面板在上, 引擎自己的提示行 (auto mode / esc to interrupt) 保留在下
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || layout === 'off') return next(e)
    const theirs = await next(e)
    const els: any = $.ui.resolve(e)
    const { Box } = els
    const cols = Math.max(40, ((e as any).viewport?.columns ?? 100) - 2)
    const view = await buildView($, els, e.surface, cols, !!e.props.isWorking)
    return (
      <Box flexDirection="column">
        {view}
        {theirs}
      </Box>
    )
  })
}
