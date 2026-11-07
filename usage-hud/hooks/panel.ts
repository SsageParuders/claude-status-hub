// usage-hud: 终端用量面板的排版 (纯函数, 不碰 $, 不用 JSX)
//   panelView = 给一份面板数据, 算出用哪种布局、每格多宽、每格里依次放什么 (文字 / 按钮 / 螃蟹, 带颜色)
//   agentsPaneView = 子代理看板的每一行
//   dashData / deskCrab = 客户端 (桌面 app) 卡片上写什么、螃蟹摆什么样 (desktop.ts 照它画 SVG)
//   另外是两边都要用的格式化 (时长 / 大数 / 模型名 ...)、配速和情绪、收据文字
// 谁来画:
//   register.tsx 把结果画成 Box / Text / Button / Raster (终端 PromptHint、侧边面板)
//   README 动图的脚本 (tools/demo) 把同一份结果写进画布格子; render.mjs 去掉类型后放在 /vendor/panel.js
//   所以这里只能引用 sprites.ts / desktop.ts (同样是纯函数), 别引用 register.tsx 或 claude-code
import { DIM, VALUE, WARN, SPRITE_W, MINI_W, heat, mix, isWide, dw, clip, crabPose, type Mood, type Scene } from './sprites'
import { EFFORTS, EFFORT_COLOR, type CrabState, type DashData } from './desktop'

// ---------------- 尺寸和颜色 ----------------
const LABEL_W = 6
const GAP = 3 // 完整版 / 中等版的列间距
const SEG_GAP = 2 // 精简版的段间距
const HPAD = 2 // 面板左右各留的空格数
export const CRAB_GAP = 2 // 完整版 / 中等版: 左边的螃蟹和右边网格之间空的列数
export const COMPACT_AT = 75 // 上下文到这个百分比出现 [压缩] 按钮
const STUCK_MS = 5 * 60_000 // 子代理运行中超过这么久没有工具动作 -> "可能卡住"
export const KEEP_ENDED = 10 // 看板里保留最近结束的子代理个数
const TRACK = 0x3f3f46
const TICK = 0xe5e5e5 // 用量条上的时间刻度 │: 绿/黄/红的彩色段和暗色段里都看得清
export const ACCENT = '#d97757'
const VIOLET = '#a78bfa'
// 档位放不下时的缩写 (档位的先后和颜色在 desktop.ts, 客户端卡片也用)
const EFFORT_SHORT: Record<string, string> = { low: 'low', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' }

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
export const GOOD = hex(heat(0)) // 绿 (用量条冷端的颜色)
export const AMBER = hex(heat(0.6)) // 黄
const TONE_COLOR = { warn: WARN, ok: GOOD, dim: DIM } as const

// ---------------- 格式化 ----------------
// 外部来的名字只留安全字符, 其余换成 ?
export function safe(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63
    out += (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xc0 && cp <= 0x24f) || isWide(cp) ? ch : '?'
  }
  return out
}
const padL = (s: string, n: number) => ' '.repeat(Math.max(0, n - dw(s))) + s
const padR = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - dw(s)))

export function prettyModel(id: string): string {
  const m = id.match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-_.](\d{1,2}))?/i)
  if (!m) return safe(id) || '--'
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  return name + ' ' + m[2] + (m[3] ? '.' + m[3] : '') + (/\[1m\]/i.test(id) ? ' 1M' : '')
}
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}
// 短一点的时长 (重置倒计时 / 预计用完): 40m / 2h41m / 13h / 3d6h
export function durShort(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 10) return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}
// 粗一点的时长, 最多 3 列: 40m / 13h / 4d (往下取整, 宁可说早); 给 "4d用完" 这种放进 7 列用
function durCoarse(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd'
}
// 重置时刻 (本地时间): 今天 21:00 / 明天 05:00 / 周六 05:00
const WEEKDAY = '日一二三四五六'
export function whenAt(at: number, now: number): string {
  const d = new Date(at)
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day0(d) - day0(new Date(now))) / 86400_000)
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  return (days <= 0 ? '今天' : days === 1 ? '明天' : '周' + WEEKDAY[d.getDay()]) + ' ' + hm
}
// 大数: 999 / 12.3k / 4.56M / 345.4M / 2.26B
export function big(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M'
  return (n / 1e9).toFixed(2) + 'B'
}
function tok(n: number | undefined): string {
  if (n === undefined) return '--'
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}
// 状态格前面的跳动条 (3 格, 6 个相位)
function eq(f: number): string {
  const H = '▁▂▃▄▅▆▇'
  const wave = [0, 2, 4, 6, 4, 2]
  return [0, 2, 4].map(o => H[wave[(f + o) % wave.length]]).join('')
}
// 数字滚动过渡的一步: 每帧追上差距的 35%, 差不到 0.6 就直接到位 (插件的 ease 和动图的 easeAt 都用它)
export function easeStep(cur: number, target: number): number {
  return Math.abs(target - cur) < 0.6 ? target : cur + (target - cur) * 0.35
}

// ---------------- 工具名 ----------------
const TOOL_CN: Record<string, string> = {
  Read: '读文件',
  Grep: '搜内容',
  Glob: '找文件',
  Edit: '改文件',
  MultiEdit: '改文件',
  Write: '写文件',
  NotebookEdit: '改笔记本',
  Bash: '跑命令',
  PowerShell: '跑命令',
  WebSearch: '搜网页',
  WebFetch: '读网页',
  Agent: '派子代理',
  Task: '派子代理',
  SendMessage: '发消息',
  TodoWrite: '记待办',
  Skill: '用技能',
  ToolSearch: '找工具',
}
// MCP 工具名是 mcp__<服务>__<工具>, 服务名本身可能带下划线 (Claude_Browser), 所以按 "__" 拆
function mcpParts(t: string): [string, string] | undefined {
  if (!t.startsWith('mcp__')) return undefined
  const rest = t.slice(5)
  const cut = rest.indexOf('__')
  return cut > 0 ? [rest.slice(0, cut), rest.slice(cut + 2)] : [rest, '']
}
// 统计行里的短名: MCP 工具只留服务名
function shortTool(t: string): string {
  return safe(mcpParts(t)?.[0] ?? t)
}
export function toolLabel(t: string): string {
  if (!t) return '思考中'
  if (TOOL_CN[t]) return TOOL_CN[t]
  const m = mcpParts(t)
  return safe(m ? m[0] + ':' + m[1] : t)
}

// ---------------- 配速 (纯函数) ----------------
// 已过时间 = 窗口长度 - (重置时刻 - 现在); 应用量 = 已过 / 窗口 x 100; 配速 = 实际用量 / 应用量
// 预计用完 = 现在 + (100 - 实际用量) / (实际用量 / 已过时间)
// 注意: 线性外推下 "会在重置前用完" 和 "配速 > 1" 是同一件事 (100 x 已过 < 用量 x 窗口)
// elapsedFrac = 窗口已过的比例 (0-1), 用量条上的时间刻度画在这里; 窗口刚开始 (配速不外推) 时也有
export type Pace = { pct: number; ratio?: number; runOutIn?: number; resetIn?: number; elapsedFrac?: number; willRunOut: boolean }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// 有没有 5 小时窗口 (2026-10 起通过验证的 Ultra 账号没有, rateLimits 里只剩 seven_day):
//   有 five_hour -> 有; 只有 seven_day -> 没有; 都没有 (还没回复 / 不是订阅) -> 沿用上次的判定 prev
export function hasFiveFrom(limits: Limit[], prev: boolean): boolean {
  return limits.some(l => l.kind === 'five_hour') ? true : limits.some(l => l.kind === 'seven_day') ? false : prev
}
// 额度窗口长度
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
// 窗口刚开始时外推不可靠, 已过时间不够就不算配速 (不报警、不影响情绪):
//   5小时 = 窗口的 2% (6 分钟); 本周 = 满 1 天 (一周开头几个小时的用量起伏大, 按它外推会早早报警)
const MIN_ELAPSED_FRAC = 0.02
const MIN_ELAPSED_MS: Record<string, number> = { seven_day: 86400_000 }
const PANIC_RUNOUT_MS = 30 * 60_000
// 线性外推下 "配速 > 1" 就等于 "会在重置前用完", 稍微用快一点就报警太吵: 配速到 1.15 才算会用完
const PACE_WARN = 1.15
// 配速低于这个算宽裕: 重置那格的配速写绿色
const PACE_CHILL = 0.8

export function paceOf(l: Limit | undefined, now: number): Pace | undefined {
  if (!l || typeof l.percentUsed !== 'number') return undefined
  const pct = l.percentUsed
  const win = WINDOW_MS[l.kind]
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!win || !isFinite(at)) return { pct, willRunOut: false }
  const resetIn = Math.max(0, at - now)
  const elapsed = Math.min(win, win - resetIn)
  const elapsedFrac = Math.max(0, Math.min(1, elapsed / win))
  const minElapsed = MIN_ELAPSED_MS[l.kind] ?? win * MIN_ELAPSED_FRAC
  if (pct < 1 || elapsed < minElapsed || resetIn <= 0) return { pct, resetIn, elapsedFrac, willRunOut: false }
  const ratio = pct / ((elapsed / win) * 100)
  const runOutIn = pct >= 100 ? 0 : (100 - pct) / (pct / elapsed)
  return { pct, ratio, runOutIn, resetIn, elapsedFrac, willRunOut: runOutIn < resetIn && ratio >= PACE_WARN }
}

const MOOD_RANK: Record<Mood, number> = { normal: 0, sweat: 1, panic: 2 }
function moodOne(p: Pace | undefined): Mood | undefined {
  if (!p) return undefined
  if (p.pct >= 95 || (p.willRunOut && (p.runOutIn ?? Infinity) <= PANIC_RUNOUT_MS)) return 'panic'
  if ((p.ratio ?? 0) >= 1.2 || p.willRunOut) return 'sweat'
  return 'normal'
}
// 5小时 和 本周 里更紧张的那个; 两个都没有读数 (不是订阅账号) 就是 正常
export function moodOf(...paces: Array<Pace | undefined>): Mood {
  const ms = paces.map(moodOne).filter((m): m is Mood => !!m)
  if (!ms.length) return 'normal'
  return ms.reduce((a, b) => (MOOD_RANK[b] > MOOD_RANK[a] ? b : a))
}

// 用量条后面那段. 规矩: 只有一个时间 = 重置倒计时 (暗色); 预计用完的时间一定带 "用完" 两个字 (红色)
//   会用完 -> "4d12h用完", 放不下换粗一点的 "4d用完"; 还放不下就照常写暗色的重置倒计时, 只靠红色百分比提醒
//   (以前放不下时只写红色的 "4d12h", 用户会以为是 4 天半后重置)
function limitExtra(p: Pace | undefined, extraW: number): { text: string; warn: boolean } {
  if (!p || p.resetIn === undefined) return { text: '', warn: false }
  if (p.willRunOut && p.runOutIn !== undefined) {
    for (const d of [durShort(p.runOutIn), durCoarse(p.runOutIn)]) {
      if (dw(d + '用完') <= extraW) return { text: d + '用完', warn: true }
    }
  }
  return { text: durShort(p.resetIn), warn: false }
}
// 时间刻度落在条的第几格: 已过比例 x 条长, 四舍五入, 夹在条里; 没有重置时间 -> -1 (不画)
// 用四舍五入 (和彩色段的格数同一种取整): 用量正好跟上时间时, 彩色段的最后一格正好挨着刻度
function tickCell(p: Pace | undefined, bw: number): number {
  if (p?.elapsedFrac === undefined || bw <= 0) return -1
  return Math.min(bw - 1, Math.max(0, Math.round(p.elapsedFrac * bw)))
}
// 没有 5 小时时 "重置" 那格 (终端和客户端共用): 本周什么时候重置 + 配速
function resetInfo(week: Limit | undefined, pw: Pace | undefined, now: number): NonNullable<DashData['reset']> {
  const at = week?.resetsAt ? Date.parse(week.resetsAt) : NaN
  const r = pw?.ratio
  return {
    when: isFinite(at) ? whenAt(at, now) : '--',
    pace: r === undefined ? '' : '配速 ' + r.toFixed(1) + 'x',
    tone: pw?.willRunOut ? 'warn' : r !== undefined && r < PACE_CHILL ? 'ok' : 'dim',
  }
}

// ---------------- 状态格和收据 ----------------
// 状态格说什么 (终端和客户端共用, 各自再加上跳动条 / 计时 / 子代理个数); note = 正亮着的事件 (搞定 / 慢点 ...), 有它就先显示它
//   color 只有事件才给 (终端和客户端各按 tone 配自己的颜色)
type Status = DashData['status']
function statusFrom(o: PanelInfo): Status {
  const ev = o.note
  const tone = o.working ? 'work' : ev ? 'idle' : o.agents ? 'agents' : 'idle'
  if (ev) return { text: ev.text, tone, color: ev.color, bold: ev.bold }
  if (o.working) return { text: toolLabel(o.tool), tone }
  if (o.agents) return { text: '子代理在跑', tone }
  if (o.lastTurnMs) return { text: '✓ 上一轮 ' + dur(o.lastTurnMs) + '，' + o.lastTurnTools + ' 次工具', tone }
  return { text: '✓ 待命', tone }
}
// " · $0.42 · 改 3 个文件 +120 -30 · 工具 12 次"; 没数据的段省掉, 全没有就是空串
export function receiptText(r: { usd?: number; files: number; add: number; del: number; tools: number }): string {
  const parts: string[] = []
  if (r.usd !== undefined && r.usd >= 0.005) parts.push('$' + r.usd.toFixed(2))
  if (r.files > 0) parts.push('改 ' + r.files + ' 个文件' + (r.add || r.del ? ' +' + r.add + ' -' + r.del : ''))
  if (r.tools > 0) parts.push('工具 ' + r.tools + ' 次')
  return parts.length ? ' · ' + parts.join(' · ') : ''
}

// ---------------- 面板排版 ----------------
// 一格里依次放的东西; key 照搬以前 JSX 里的 key (画成组件时用)
//   text = 一段文字; button = 可点的字 (dim = 暗色按钮), act 说明点了做什么; crab = 螃蟹 (终端像素画 / 别处颜文字)
export type Act = 'model' | 'effort' | 'context' | 'compact' | 'usage' | 'project' | 'agents' | 'token'
export type Part = { t: 'text'; key: string; text: string; color?: string; bold?: true } | { t: 'button'; key: string; label: string; dim?: true; act: Act } | { t: 'crab' }
export type PanelCell = { key: string; w: number; parts: Part[] }
// 左右留 marginL / marginR 列, 同一行的格子之间空 gap 列
//   compact = 1 行; grid = 3 行 x 2 或 3 列 (rows 的宽 = width), crab = 左边画 15x3 的螃蟹 (再空 CRAB_GAP 列)
export type PanelView = { marginL: number; marginR: number; gap: number } & ({ layout: 'compact'; cells: PanelCell[] } | { layout: 'grid'; crab: boolean; width: number; rows: PanelCell[][] })
// 面板和客户端卡片都要的数据 (插件从 snapshot 和模块状态取, 动图从场景的时间轴算); 配速、状态文字、模型名在这里推出来
export type PanelInfo = {
  now: number
  working: boolean
  tool: string // 主线程正在跑 (或刚跑完) 的工具; '' = 没有
  lastTurnMs: number // 上一轮用时 (0 = 还没有)
  lastTurnTools: number
  note?: { text: string; color: string; bold?: boolean } // 状态格里正亮着的事件
  modelId: string // 原样的模型 id
  effort: string // 思考档位 (原样; '' = 不知道)
  project: string
  branch: string
  dirty: number
  startedAt?: number // 会话开始时刻
  usd?: number // 本会话花费 (没有花费读数时 undefined; 0 照样写 $0.00)
  pct?: number // 上下文百分比
  ctxTokens?: number
  ctxWindow?: number
  five?: Limit
  week?: Limit
  showFive: boolean // 有 5 小时窗口 (没有时换排法; 插件要记住上次的判定, 所以由调用方给, 规则是 hasFiveFrom)
  turnStartedAt: number
  agents: number // 在跑的子代理数
  toolCounts: Record<string, number>
  tokens: { state: 'idle' | 'counting' | 'ready' | 'failed'; total: number; output: number }
}
export type PanelData = PanelInfo & {
  W: number // 面板可用宽度
  term: boolean // 终端 (像素螃蟹) / 别的界面 (颜文字)
  crab: boolean // 面板里画螃蟹
  compact: boolean // /hud 切到了精简版
  frame: number
  // 数字滚动: 三根条这一帧显示的百分比 (调用方每帧用 easeStep 追 pct / five / week, 有状态所以不在这里算); undefined = --
  shown: { ctx?: number; h5?: number; wk?: number }
}
// 几段两边 (终端面板和客户端卡片) 写法一样的文字
const branchOf = (d: PanelInfo) => (d.branch ? d.branch + (d.dirty ? ' *' + d.dirty : '') : '')
const costOf = (usd: number | undefined) => (usd !== undefined ? '$' + usd.toFixed(2) : '')
const sessionOf = (d: PanelInfo) => dur(d.now - (d.startedAt ?? d.now))
const counted = (tk: PanelInfo['tokens']) => tk.state === 'ready' || tk.state === 'failed' // token 数完了 (failed = 只有本次启动以来的)
// 用得最多的 3 个工具: "Read 10  Bash 6  Write 4"
function topTools(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => shortTool(t) + ' ' + n)
    .join('  ')
}

const text = (key: string, s: string, color?: string, bold?: boolean): Part => ({ t: 'text', key, text: s, color, bold: bold || undefined })
const button = (key: string, label: string, act: Act, dim?: boolean): Part => ({ t: 'button', key, label, act, dim: dim || undefined })

function label(key: string, s: string, width: number, act?: Act): Part[] {
  const pad = ' '.repeat(Math.max(0, width - dw(s)) + 1)
  return act ? [button(key, s, act, true), text(key + '-p', pad)] : [text(key, s + pad, DIM)]
}

// tickAt: 时间刻度画在第几格 (-1 = 不画); 那一格的 ━ 换成亮色 │, 条的总宽度不变
function barParts(key: string, pct: number | undefined, width: number, shimmerAt: number, pulse: number, tickAt = -1): Part[] {
  const p = pct === undefined ? 0 : Math.max(0, Math.min(100, pct)) / 100
  // 只用整格: 半格字符在终端里会留一道缝 (实测)
  const full = p > 0 ? Math.max(1, Math.round(p * width)) : 0
  // 窗口刚开始、用量只占 1 格时, 刻度和那格彩色都在第 0 格: 刻度让到第 1 格, 彩色照样看得见
  const tick = tickAt === 0 && full === 1 && width > 1 ? 1 : tickAt
  const cells: Part[] = []
  for (let i = 0; i < width; i++) {
    const lit = i < full
    let ch = '━'
    let col = lit ? heat(i / Math.max(1, width - 1)) : TRACK
    if (lit && pulse > 0) col = mix(col, 0xffffff, pulse)
    if (lit && Math.abs(i - shimmerAt) < 1) col = mix(col, 0xffffff, 0.6)
    // 刻度最后定: 不跟着呼吸 / 流光变色, 彩色段和暗色段里都一样亮
    if (i === tick) {
      ch = '│'
      col = TICK
    }
    cells.push(text(key + '-c' + i, ch, hex(col)))
  }
  return cells
}

type MeterOpts = {
  key: 'ctx' | 'h5' | 'wk'
  label: string
  labelW: number
  act: Act
  labelKey?: string // 标签按钮的 key (默认 btn-<key>)
  pct?: number
  pctColor?: string // 百分比的颜色 (默认按用量冷暖)
  bw: number
  extra: string
  extraW: number
  extraColor?: string
  extraParts?: Part[] // 自己画附加那段 (调用方保证正好 1 + extraW 列)
  shimmerAt: number
  pulse: number
  tickAt?: number // 时间刻度在第几格 (tickCell 算; 不给 = 不画)
}
function meter(d: PanelData, o: MeterOpts): Part[] {
  const shownPct = d.shown[o.key]
  const pctText = shownPct === undefined ? '--' : Math.round(shownPct) + '%'
  const pctColor = o.pctColor ?? (o.pct === undefined ? DIM : hex(heat(Math.min(100, o.pct) / 100)))
  const parts = [...label(o.labelKey ?? 'btn-' + o.key, o.label, o.labelW, o.act), ...barParts(o.key, shownPct, o.bw, o.shimmerAt, o.pulse, o.tickAt ?? -1), text(o.key + '-pct', ' ' + padL(pctText, 4), pctColor, true)]
  if (o.extraW > 0 && o.extraParts) parts.push(...o.extraParts)
  else if (o.extraW > 0) parts.push(text(o.key + '-x', ' ' + padR(clip(o.extra, o.extraW), o.extraW), o.extraColor ?? DIM, !!o.extraColor))
  return parts
}

// 上下文 >= 75%: 附加那段换成 [压缩] 按钮; 放得下 (>= 10 列) 就在前面留已用 token 数
// 宽度和原来那段完全一样: 1 + extraW 列
function compactParts(extraW: number, used: string): Part[] {
  const btn = '压缩'
  if (extraW >= 10) return [text('cp-lead', ' ' + padR(clip(used, extraW - 5), extraW - 5) + ' ', DIM), button('btn-compact', btn, 'compact')]
  return [text('cp-lead', ' '), button('btn-compact', btn, 'compact'), text('cp-pad', ' '.repeat(Math.max(0, extraW - dw(btn))))]
}
const meterWidth = (o: { label: string; labelW: number; bw: number; extraW: number }) => Math.max(o.labelW, dw(o.label)) + 1 + o.bw + 5 + (o.extraW > 0 ? 1 + o.extraW : 0)

// 档位: 五格保持彩色 (按钮不能上色), 档位文字做成按钮 -> /effort 打开档位滑块
// room = 模型名后面还剩几列; 放不下时先把档位缩写 (medium -> med), 再放不下就只留缩写按钮不画五格
function effortParts(effort: string, key: string, room = Infinity): Part[] {
  const word = effort ? clip(safe(effort), 6) : '--'
  const short = EFFORT_SHORT[effort] ?? word
  if (room < 6 + dw(word)) {
    if (room < 6 + dw(short)) return [button('btn-effort', short, 'effort')]
    return effortPips(effort, key, short)
  }
  return effortPips(effort, key, word)
}
function effortPips(effort: string, key: string, word: string): Part[] {
  const i = EFFORTS.indexOf(effort)
  const color = EFFORT_COLOR[effort] ?? DIM
  const bars = '▁▂▃▅▇'
  const parts: Part[] = []
  for (let k = 0; k < 5; k++) parts.push(text(key + '-e' + k, bars[k], k <= i ? color : hex(TRACK)))
  parts.push(text(key + '-ews', ' '), button('btn-effort', word, 'effort'))
  return parts
}

// 精简版: 段按优先级挑, 放得下的留下 (顺序不变)
type Seg = PanelCell & { prio: number }
function fit(segs: Seg[], width: number, gap: number): Seg[] {
  const order = segs.map((s, i) => ({ s, i })).sort((a, b) => a.s.prio - b.s.prio)
  const keep = new Set<number>()
  let total = 0
  for (const { s, i } of order) {
    const add = s.w + (keep.size ? gap : 0)
    if (total + add <= width) {
      keep.add(i)
      total += add
    }
  }
  return segs.filter((_, i) => keep.has(i))
}

export function panelView(d: PanelData): PanelView {
  const { W, frame, now, working, pct, five, week, showFive } = d
  const model = prettyModel(d.modelId)
  const p5 = paceOf(five, now)
  const pw = paceOf(week, now)
  const pulse = (l?: { percentUsed: number }) => (l && l.percentUsed >= 90 ? 0.25 * (1 + Math.sin(frame / 2)) : 0)
  const showCompact = (pct ?? 0) >= COMPACT_AT
  const tk = d.tokens
  const tokenText = !counted(tk) ? '统计中..' : big(tk.total) + (tk.state === 'failed' ? ' 本次启动' : '  out ' + big(tk.output))
  // 5小时 / 本周 的用量条 (精简版和完整版都一样的那部分): 会用完时百分比变红; 条上画时间刻度
  const limOpts = (key: 'h5' | 'wk', lab: string, l: Limit | undefined, p: Pace | undefined, bw: number) => ({
    key,
    label: lab,
    act: 'usage' as const,
    pct: l?.percentUsed,
    pctColor: p?.willRunOut ? WARN : undefined,
    bw,
    shimmerAt: -9,
    pulse: pulse(l),
    tickAt: tickCell(p, bw),
  })

  // 状态格: 干活时前面是跳动条、后面是计时; 子代理在跑时前面也有跳动条
  const st0 = statusFrom(d)
  const stColor = st0.color ?? (st0.tone === 'work' ? ACCENT : st0.tone === 'agents' ? VIOLET : DIM)
  const statusText = (max: number): { text: string; color: string; bold?: boolean } => {
    const one = (s: string) => ({ text: s, color: stColor, bold: st0.bold })
    if (st0.tone === 'work') {
      // 放不下 "工具名 + 计时" 时 (比如精简版状态格后面还有 +N代理 按钮) 先省掉计时, 不在半截处截断
      if (max < 15) return one(eq(frame) + ' ' + clip(st0.text, Math.max(2, max - 4)))
      const room = max - 11
      return one(eq(frame) + ' ' + padR(clip(st0.text, room), room) + ' ' + padL(dur(now - d.turnStartedAt), 6))
    }
    // 子代理在跑时面板至少隔帧画一次 (needsFrame), 跳动条按半速走, 6 个相位都走得到
    return one(clip(st0.tone === 'agents' ? eq(frame >> 1) + ' ' + st0.text : st0.text, max))
  }
  // 状态格: 文字 + (有子代理时) 末尾一个可点的 "+N代理" -> 子代理看板
  // 文字补齐到固定宽度, 按钮的位置在工作 / 闲置两态完全一样
  const agLabel = d.agents ? '+' + d.agents + '代理' : ''
  const statusParts = (max: number): Part[] => {
    const room = agLabel ? Math.max(0, max - dw(agLabel) - 1) : max
    const st = statusText(room)
    const parts = [text('st', agLabel ? padR(clip(st.text, room), room) + ' ' : clip(st.text, room), st.color, st.bold)]
    if (agLabel) parts.push(button('btn-agents', agLabel, 'agents'))
    return parts
  }

  // 螃蟹在面板左边 (12 列螃蟹 + 3 列道具, 3 行), 不额外占行
  //   完整版 96 列起, 中等版 66~95 列, 精简版不到 66 列 (换成 1 行的小螃蟹)
  //   关掉螃蟹 (/hud crab off) 时面板里不画螃蟹, 网格占满整行 (各档分界前移 17 列)
  const crabCols = d.crab ? SPRITE_W + CRAB_GAP : 0
  // ---------- 精简版: 1 行 (终端不到 49 列, 或 /hud 切到精简) ----------
  if (d.compact || W - crabCols < 49) {
    const bw = W >= 120 ? 8 : W >= 100 ? 6 : 4
    // 精简版没有附加文字那段: 会用完时百分比改成红色; 上下文 >=75% 时 "上下文" 标签换成 [压缩] (同样 6 列宽)
    const m = (o: Omit<MeterOpts, 'labelW' | 'extra' | 'extraW'> & { labelW?: number }, prio: number): Seg => {
      const mo: MeterOpts = { labelW: dw(o.label), extra: '', extraW: 0, ...o }
      return { key: 'seg-' + o.key, w: meterWidth(mo), prio, parts: meter(d, mo) }
    }
    const ctxShimmer = working ? frame % (bw + 6) : -9
    const segs: Seg[] = [
      ...(d.crab ? [{ key: 'seg-crab', w: d.term ? MINI_W : 9, prio: 0, parts: [{ t: 'crab' } as Part] }] : []),
      showCompact
        ? m({ key: 'ctx', label: '压缩', labelW: dw('上下文'), labelKey: 'btn-compact', act: 'compact', pct, bw, shimmerAt: ctxShimmer, pulse: 0 }, 1)
        : m({ key: 'ctx', label: '上下文', act: 'context', pct, bw, shimmerAt: ctxShimmer, pulse: 0 }, 1),
      // 没有 5 小时限制的账号: 这段不画, 后面的段往前挪
      ...(showFive ? [m(limOpts('h5', '5小时', five, p5, bw), 2)] : []),
      m(limOpts('wk', '本周', week, pw, bw), 3),
      { key: 'seg-model', w: dw(model) + 1 + 5 + 1 + Math.max(2, dw(d.effort)), prio: 4, parts: [button('btn-model', model, 'model'), text('m-sp', ' '), ...effortParts(d.effort, 'c-eff')] },
      { key: 'seg-status', w: 18, prio: 5, parts: statusParts(18) },
      { key: 'seg-token', w: 6 + 9, prio: 6, parts: [button('btn-token', 'token', 'token', true), text('tk', ' ' + clip(counted(tk) ? big(tk.total) : '..', 8), VALUE)] },
    ]
    const cells = fit(segs, W - HPAD * 2, SEG_GAP).map(({ key, w, parts }) => ({ key, w, parts }))
    return { layout: 'compact', marginL: HPAD, marginR: HPAD, gap: SEG_GAP, cells }
  }

  // ---------- 完整版: 3 行 x 3 列 (除去螃蟹 79 列以上) ----------
  // ---------- 中等版: 3 行 x 2 列 (除去螃蟹 49~78 列, 比如 macOS 默认的 80 列窗口) ----------
  //   左列 模型 / 项目 / 状态, 右列 上下文 / 5小时 / 本周; 本会话、工具、token 放不下, 只在完整版里显示
  // 左右各留 HPAD 格; 各列取整后剩下的零头平分到两边, 让面板两端留空一样
  const nCols = W - crabCols >= 79 ? 3 : 2
  const avail = W - crabCols - HPAD * 2
  const cw = Math.floor((avail - (nCols - 1) * GAP) / nCols)
  const A = cw * nCols + GAP * (nCols - 1)
  const marginL = HPAD + Math.floor((avail - A) / 2)
  const marginR = HPAD + Math.ceil((avail - A) / 2)
  const inner = cw - LABEL_W - 1
  let extraW = 11
  let bw = inner - 5 - 1 - extraW
  if (bw < 6) {
    extraW = 5
    bw = inner - 5 - 1 - extraW
  }
  // 用量条吃掉这一列剩下的宽度, 第三列的条正好撑到右边距
  bw = Math.max(3, Math.min(60, bw))
  // 5小时 / 本周 的附加那段 (limW 列) 和条长 (limBw):
  //   完整版: 三格在不同列, 附加只放 "1h54m" / "40m用完", 7 列就够, 省下的给条;
  //           上下文退到 5 列时 (窄一点的完整版) 三格都用 5 列, 条一样长, 不比旧版短 (会用完时只有百分比红, 文字照常是重置倒计时)
  //   中等版: 三根条在同一列上下叠着, 条长和附加宽度必须和上下文那根一样, 百分比才竖着对齐
  let limW = extraW
  let limBw = bw
  if (nCols === 3 && extraW === 11) {
    limW = 7
    limBw = Math.max(3, Math.min(60, inner - 5 - 1 - limW))
  }
  const x5 = limitExtra(p5, limW)
  const xw = limitExtra(pw, limW)
  // 附加文字写成 "…用完" 时也变红, 放不下 "用完" 时照常是暗色的重置倒计时
  const limMeter = (key: 'h5' | 'wk', lab: string, l: Limit | undefined, p: Pace | undefined, x: { text: string; warn: boolean }) =>
    meter(d, { ...limOpts(key, lab, l, p, limBw), labelW: LABEL_W, extra: x.text, extraW: limW, extraColor: x.warn ? WARN : undefined })

  // 第 1 行
  // 项目名优先完整显示, 分支名只用剩下的位置 (不够 4 格就不显示)
  const proj = clip(d.project || '--', inner)
  const branchRoom = inner - dw(proj) - 1
  const branchText = branchRoom >= 4 ? clip(branchOf(d), branchRoom) : ''
  const r1: Part[][] = [
    [...label('l-model', '模型', LABEL_W), button('btn-model', model, 'model'), text('m-sp', ' '), ...effortParts(d.effort, 'eff', inner - dw(model) - 1)],
    [...label('l-proj', '项目', LABEL_W), button('btn-project', proj, 'project'), text('b-t', branchText ? ' ' + branchText : '', VIOLET)],
    // 本会话 = 这个对话 (含恢复前), 不是整个项目; /clear 会重新开始计
    [...label('l-sess', '本会话', LABEL_W), text('s-t', padR(sessionOf(d), 7), VALUE), text('s-c', costOf(d.usd), DIM)],
  ]

  // 第 2 行
  const r2: Part[][] = [
    meter(d, {
      key: 'ctx',
      label: '上下文',
      labelW: LABEL_W,
      act: 'context',
      pct,
      bw,
      // 窄的时候只放已用量, 不放 "/窗口大小"
      extra: extraW >= 9 ? tok(d.ctxTokens) + '/' + tok(d.ctxWindow) : tok(d.ctxTokens),
      extraW,
      // 上下文 >=75%: 附加那段换成 [压缩] 按钮 (宽的时候前面还留着已用 token 数)
      extraParts: showCompact ? compactParts(extraW, tok(d.ctxTokens)) : undefined,
      shimmerAt: working ? (frame % (bw + 8)) - 2 : -9,
      pulse: 0,
    }),
    ...(showFive ? [limMeter('h5', '5小时', five, p5, x5)] : []),
    limMeter('wk', '本周', week, pw, xw),
  ]
  // 没有 5 小时限制 (完整版): 第 2 行 = 上下文 | 本周 | 重置 (和别的格子一样宽)
  //   重置那格: 本周额度什么时候重置 + 配速, 写法和颜色规矩和客户端那格同一份 (resetInfo)
  const resetCell = (): Part[] => {
    const r = resetInfo(week, pw, now)
    const room = inner - dw(r.when)
    return [...label('btn-reset', '重置', LABEL_W, 'usage'), text('rs-t', clip(r.when, inner), VALUE), text('rs-p', r.pace && room >= dw(r.pace) + 2 ? '  ' + r.pace : '', TONE_COLOR[r.tone], r.tone === 'warn')]
  }
  // 没有 5 小时: 空出来的第 3 格, 完整版放 "重置", 中等版放本会话 (中等版本来放不下本会话, 这下正好)
  if (!showFive) r2.push(nCols === 3 ? resetCell() : r1[2])

  // 第 3 行
  const top = topTools(d.toolCounts)
  const r3: Part[][] = [
    [...label('l-st', '状态', LABEL_W), ...statusParts(inner)],
    [...label('l-tools', '工具', LABEL_W), text('tl', clip(top || '还没有', inner), VALUE)],
    // 点 "token" 弹出明细: 读缓存 / 写缓存 / 新输入 / 输出
    [...label('btn-token', 'token', LABEL_W, 'token'), text('tk', clip(tokenText, inner), VALUE)],
  ]

  // 中等版: 左列放文字 (模型 / 项目 / 状态), 右列放第 2 行那三格
  const rows = nCols === 3 ? [r1, r2, r3] : [[r1[0], r2[0]], [r1[1], r2[1]], [r3[0], r2[2]]]
  return {
    layout: 'grid',
    crab: d.crab,
    marginL,
    marginR,
    gap: GAP,
    width: A,
    rows: rows.map((cells, r) => cells.map((parts, i) => ({ key: 'r' + (r + 1) + 'c' + i, w: cw, parts }))),
  }
}

// ---------------- 客户端 (桌面 app) 卡片 ----------------
// 会在重置前用完 -> "40m 用完" (红色), 否则只写重置倒计时 "1h20m"; tick = 窗口已过比例 (条上的时间刻度)
// 客户端只显示到分钟: 每秒变一次会让图片每秒重换一次
export function dashData(d: PanelInfo): DashData {
  const limitMeter = (l: Limit | undefined, p: Pace | undefined): DashData['week'] =>
    p?.willRunOut && p.runOutIn !== undefined
      ? { pct: l?.percentUsed, extra: durShort(p.runOutIn) + ' 用完', warn: true, tick: p.elapsedFrac }
      : { pct: l?.percentUsed, extra: p?.resetIn !== undefined ? durShort(p.resetIn) : '', tick: p?.elapsedFrac }
  const ag = d.agents ? `  +${d.agents} 个子代理` : ''
  const ran = d.now - d.turnStartedAt
  const st = statusFrom(d)
  const pw = paceOf(d.week, d.now)
  const done = counted(d.tokens)
  return {
    model: prettyModel(d.modelId),
    effort: d.effort,
    project: d.project || '--',
    branch: branchOf(d),
    session: sessionOf(d),
    cost: costOf(d.usd),
    ctx: { pct: d.pct, extra: tok(d.ctxTokens) + ' / ' + tok(d.ctxWindow) },
    ...(d.showFive ? { five: limitMeter(d.five, paceOf(d.five, d.now)) } : { reset: resetInfo(d.week, pw, d.now) }),
    week: limitMeter(d.week, pw),
    status: { ...st, text: st.tone === 'agents' ? d.agents + ' 个' + st.text : st.text + (st.tone === 'work' ? (ran >= 60_000 ? '  ' + durShort(ran) : '') + ag : '') },
    tools: topTools(d.toolCounts),
    tokenTotal: done ? big(d.tokens.total) : '统计中..',
    tokenOutput: done ? big(d.tokens.output) : '',
  }
}
// 客户端那只 SVG 螃蟹: 姿势和终端版同一套先后 (crabPose); 身体颜色看上下文, 子代理最多画 3 只
export function deskCrab(s: Scene): CrabState {
  return { mode: crabPose(s), kind: s.kind, heat: s.pct >= 95 ? 'crit' : s.pct >= 80 ? 'hot' : 'ok', agents: Math.min(3, s.agents), mood: s.mood }
}

// ---------------- 子代理看板 (侧边面板) ----------------
export type PaneKid = { id: string; desc?: string; type?: string; status: string; startedAt: number; lastAt: number; endedAt?: number; lastTool?: string; tools: number }
// 一行: bare = 直接一段文字 (不包一层 row)
export type PaneLine = { key: string; parts: Array<{ key: string; text: string; color: string; bold?: true }>; bare?: true }
const KID_STATUS: Record<string, [string, string]> = {
  running: ['运行中', VIOLET],
  completed: ['已完成', '#4ade80'],
  failed: ['失败', WARN],
  killed: ['已停止', DIM],
}
// kids = 要列出来的子代理 (运行中的 + 结束了的); W = 面板宽度
export function agentsPaneView(kids: PaneKid[], now: number, W: number): { width: number; lines: PaneLine[] } {
  const running = kids.filter(k => k.endedAt === undefined).sort((a, b) => a.startedAt - b.startedAt)
  const ended = kids
    .filter(k => k.endedAt !== undefined)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, KEEP_ENDED)
  const width = Math.max(30, W)
  const wide = width >= 72
  const line = (key: string, cols: Array<[string, number, string?]>): PaneLine => ({
    key,
    parts: cols.map(([s, w, color], i) => ({ key: key + '-' + i, text: padR(clip(s, w), w) + (i < cols.length - 1 ? ' ' : ''), color: color ?? VALUE })),
  })
  const bare = (key: string, s: string, color: string): PaneLine => ({ key, parts: [{ key, text: s, color }], bare: true })
  // 宽面板一行一个: 状态 | 描述 | 时长 | 最后动静 | 最后工具 | 工具 (次数; 表头不能超过 FIX.n 格, 否则被截成 "工..")
  const FIX = { st: 8, ran: 7, idle: 9, tool: 14, n: 5 }
  const descW = Math.max(8, width - (FIX.st + FIX.ran + FIX.idle + FIX.tool + FIX.n) - 5)
  const row = (k: PaneKid): PaneLine[] => {
    const isRun = k.endedAt === undefined
    const quiet = now - k.lastAt
    const stuck = isRun && quiet > STUCK_MS
    const [stText, stColor] = stuck ? ['可能卡住', WARN] : (KID_STATUS[k.status] ?? [safe(k.status) || '已结束', DIM])
    const name = k.desc || k.type || safe(k.id)
    const ran = dur((k.endedAt ?? now) - k.startedAt)
    const idle = isRun ? dur(quiet) + ' 前' : '--'
    const tool = k.lastTool ? shortTool(k.lastTool) : '--'
    const color = isRun ? (stuck ? WARN : VALUE) : DIM
    if (wide) {
      return [
        line('k-' + k.id, [
          [stText, FIX.st, stColor],
          [name, descW, color],
          [ran, FIX.ran, color],
          [idle, FIX.idle, stuck ? WARN : color],
          [tool, FIX.tool, color],
          [String(k.tools), FIX.n, color],
        ]),
      ]
    }
    // 窄面板两行一个
    const detail = isRun ? '已跑 ' + ran + ' · ' + idle + ' ' + tool + ' · ' + k.tools + ' 次' : '用时 ' + ran + ' · ' + k.tools + ' 次工具'
    return [
      line('k-' + k.id, [
        [stText, FIX.st, stColor],
        [name, width - FIX.st - 1, color],
      ]),
      line('k2-' + k.id, [
        ['', FIX.st],
        [detail, width - FIX.st - 1, stuck ? WARN : DIM],
      ]),
    ]
  }
  const head = wide
    ? [
        line('k-head', [
          ['状态', FIX.st, DIM],
          ['描述', descW, DIM],
          ['时长', FIX.ran, DIM],
          ['最后动静', FIX.idle, DIM],
          ['最后工具', FIX.tool, DIM],
          ['工具', FIX.n, DIM],
        ]),
      ]
    : []
  const lines: PaneLine[] = [
    {
      key: 'k-top',
      parts: [
        { key: 'k-title', text: '子代理', color: ACCENT, bold: true },
        { key: 'k-sum', text: padR('  运行中 ' + running.length + ' · 已结束 ' + ended.length, Math.max(0, width - 6)), color: DIM },
      ],
    },
  ]
  if (!kids.length) lines.push(bare('k-none', '这个会话还没有子代理，Esc 关闭', DIM))
  if (running.length) lines.push(...head, ...running.flatMap(row))
  if (ended.length) lines.push(bare('k-ended', '已结束 (最近 ' + KEEP_ENDED + ' 个)', DIM), ...(running.length ? [] : head), ...ended.flatMap(row))
  if (kids.length) lines.push(bare('k-tip', '运行中超过 5 分钟没有工具动作的会标红，Esc 关闭', DIM))
  return { width, lines }
}
