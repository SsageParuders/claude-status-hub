import { test, expect, mock } from 'claude-code/testing'
import { previewScene, previewPixels } from './register'
import { paceOf, moodOf, receiptText, whenAt } from './panel'
import { crabSvg, dashSvg } from './desktop'
import { COL, DEF, crabPose } from './sprites'
// v0.16.3 的新函数用 * 取: 反查时放在 0.16.2 上跑, 缺的函数只让用到它的测试失败, 不让整个文件加载不了
import * as reg from './register'

const USAGE = {
  startedAt: Date.now() - 5_520_000,
  context: { tokens: 164_000, window: 200_000, percent: 82 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(Date.now() + 3 * 86400_000).toISOString() },
  ],
  cost: { usd: 3.21 },
}

// 终端里允许出现的字符: ASCII、中日韩文字、全角逗号、以及确定单宽的方块/框线字符
const SAFE = /^[\x20-\x7E\u4E00-\u9FFF，！│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓]*$/
const CWD = 'D:\\work\\my-app'

// 模拟三种系统: 工作目录、环境变量、是不是 macOS、打不开的命令 (退出码 3)
// Windows 这里故意不给 OS 变量, 靠 C:\ 这种路径认出来
// root = 项目根目录 (不给就和 cwd 一样)
type Sys = { cwd: string; root?: string; env: Record<string, string>; mac?: boolean; broken?: string[] }
const WIN: Sys = { cwd: CWD, env: { USERPROFILE: 'C:\\Users\\me' } }
const MAC: Sys = { cwd: '/Users/me/my-app', env: { HOME: '/Users/me' }, mac: true }
const LINUX: Sys = {
  cwd: '/home/me/my-app',
  env: { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/home/me/.config/claude' },
  broken: ['xdg-open'],
}
const WSL: Sys = { cwd: '/home/me/my-app', env: { HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu-22.04' }, broken: ['wslview'] }

type Calls = { run: string[][]; cmd: string[]; dirs: string[]; toasts: string[]; opens: any[]; logs: any[]; clock?: any }
// 新功能的测试用: 可变的用量 / 子代理列表 / 手动拨的时钟 (只替换 clock.now, 定时器仍是空的)
// mockClock: 用 mock.clock(on) 从这个时刻起的内存时钟代替下面三个假时钟 (定时器会真的走, 测试拨 calls.clock)
// toolGate: 工具调用等它放行才结束 (测 "工具在跑时" 用)
type Opts = { usage?: () => any; agents?: () => any[]; now?: () => number; mockClock?: number; store?: Record<string, unknown>; toolGate?: () => Promise<void> }

function mocks(on: any, calls: Calls, sys: Sys = WIN, opts: Opts = {}) {
  // 存储用内存里的假存储: 测试里的 /hud top 不能写进用户真实的偏好文件
  // 默认螃蟹在面板左边 (v0.17.3); 下面大多数面板几何测试写于 v0.16 (面板里没有螃蟹), 所以默认按 /hud crab off 测,
  //   测螃蟹排法的用例显式传 crab: true
  mock.store(on, { crab: false, ...(opts.store ?? {}) })
  if (opts.mockClock !== undefined) calls.clock = mock.clock(on, { now: opts.mockClock })
  else {
    on('clock.now', async () => ({ value: opts.now ? opts.now() : Date.now() }))
    on('clock.every', async () => ({ value: undefined }))
    on('clock.after', async () => ({ value: undefined }))
  }
  // 引擎自己画的: TurnDuration 照真的引擎给一个引擎节点 (测得到 "引擎节点的祖先 Box 不能带 width" 这类规矩), 别的给一段字
  on('ui.render', async ($: any, e: any) => (e.component === 'TurnDuration' ? ({ type: 'engine', ref: 0 } as any) : $.ui.resolve(e).Text({ children: ['engine-base'] })))
  on('ui.toast', async ($: any, e: any) => {
    calls.toasts.push(String(e?.text ?? ''))
    return { value: undefined }
  })
  on('ui.open', async ($: any, e: any) => {
    calls.opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', async () => {
    if (opts.toolGate) await opts.toolGate()
    return { result: {}, text: 'ok' }
  })
  on('classic.SubagentStart', async () => ({}))
  on('classic.SubagentStop', async () => ({}))
  on('classic.PermissionRequest', async () => ({}))
  on('classic.Notification', async () => ({}))
  on('session.compact', async () => ({ messages: [{ role: 'user', text: '(summary)', toolUses: [] }] }))
  on('prompt.edit', async ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
  on('ui.log', async ($: any, e: any) => {
    calls.logs.push(e)
    return { value: undefined }
  })
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: opts.usage ? opts.usage() : USAGE }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', async () => ({ value: sys.cwd }))
  on('session.root', async () => ({ value: sys.root ?? sys.cwd }))
  // 测试跑在 Windows 上, 引擎可能把 /System/... 规整成本机写法, 只比结尾
  on('fs.exists', async ($: any, e: any) => ({ value: !!sys.mac && /[\\/]System[\\/]Library[\\/]CoreServices$/.test(String(e.path ?? e)) }))
  on('settings.read', async () => ({ value: { effortLevel: 'medium' } }))
  on('agent.list', async () => ({ value: opts.agents ? opts.agents() : [{ id: 'a', description: 'x', type: 'fork', status: 'running' }] }))
  on('command.register', async ($: any, e: any) => ({ value: { command: e.name } }))
  on('command.run', async ($: any, e: any) => {
    calls.cmd.push(e.command)
    return { value: {} }
  })
  on('session.id', async () => ({ value: 'abc-123' }))
  on('env.get', async ($: any, e: any) => ({ value: sys.env[String(e.name ?? e)] }))
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv ?? e
    calls.run.push(argv)
    calls.dirs.push(String(e.init?.cwd ?? ''))
    if (sys.broken?.includes(argv[0])) return { value: { exitCode: 3, stdout: '', stderr: '' } }
    const s = JSON.stringify(argv)
    if (argv[0] === 'node') {
      // 统计脚本: 与本机实测的一个会话同量级
      return { value: { exitCode: 0, stdout: JSON.stringify({ found: true, input: 1646, output: 716680, cacheRead: 332073078, cacheWrite: 12632343 }), stderr: '' } }
    }
    const stdout = s.includes('show-current') ? 'codex/research\n' : ' M a.py\n M b.py\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
}

async function start($: any, on: any, sys: Sys = WIN, opts: Opts = {}) {
  const calls: Calls = { run: [], cmd: [], dirs: [], toasts: [], opens: [], logs: [] }
  mocks(on, calls, sys, opts)
  await $.session.start({ cwd: sys.cwd } as any)
  return calls
}

async function mountHint($: any, surface: 'terminal' | 'desktop', cols: number, isWorking = false) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface,
    component: 'PromptHint',
    requestId: 'hint',
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { isDraft: false, isWorking, hint: '? for shortcuts' },
  } as any)
}

async function mountBand($: any, cols: number, hasSurvey = false) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: cols, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} },
  } as any)
}

async function strings(ui: any): Promise<string[]> {
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label))
  return [...texts, ...labels]
}

test('面板在输入框下方，引擎自己的提示行保留；有档位、本周用量；/hud crab off 时面板里没有螃蟹', async ($, on) => {
  await start($, on)
  for (const cols of [140, 118]) {
    for (const working of [false, true]) {
      const ui = await mountHint($, 'terminal', cols, working)
      const all = await strings(ui)
      for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      expect(all).toContain('本周')
      expect(all).toContain('5小时')
      expect(all).toContain('my-app')
      expect(all.some(t => t.includes('medium'))).toBe(true)
      expect(all).toContain('engine-base')
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('三行的每一列宽度一致（网格对齐）', async ($, on) => {
  await start($, on)
  const ui = await mountHint($, 'terminal', 118)
  const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
  const widthOf = (k: string) => boxes.find((b: any) => b.key === k)?.props.width
  for (const c of [0, 1, 2]) {
    expect(widthOf('r1c' + c)).toBeDefined()
    expect(widthOf('r2c' + c)).toBe(widthOf('r1c' + c))
    expect(widthOf('r3c' + c)).toBe(widthOf('r1c' + c))
  }
  await ui.unmount()
})

test('工作中和闲置时，每一段的位置和宽度完全相同', async ($, on) => {
  await start($, on)
  const shape = async (working: boolean) => {
    const ui = await mountHint($, 'terminal', 118, working)
    const boxes = (await ui.findAll({ type: 'Box' })).map((b: any) => [b.key, b.props.width])
    const buttons = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    await ui.unmount()
    return JSON.stringify({ boxes, buttons })
  }
  expect(await shape(true)).toBe(await shape(false))
})

test('点项目名经 cmd start 打开文件夹；双击只开一次；点本周跑 /usage', async ($, on) => {
  const calls = await start($, on)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => a[0] === 'cmd.exe')
  expect(opens.length).toBe(1)
  expect(opens[0]).toEqual(['cmd.exe', '/d', '/c', 'start', 'usage hud', CWD])
  await ui.press({ key: 'btn-wk' })
  expect(calls.cmd).toContain('usage')
  await ui.unmount()
})

// v0.16: 面板去掉螃蟹那 15+2 列后各档分界前移 17 列: 完整版 81 列起, 中等版 51-80 列, 精简版不到 51 列
//   (旧测试里的列数减 17, 格子几何完全不变)
test('80 列 (macOS 默认窗口) 用中等版: 3 行 x 2 列 (没有螃蟹)，右列是三根用量条', async ($, on) => {
  await start($, on)
  for (const cols of [65, 73, 80]) {
    const ui = await mountHint($, 'terminal', cols)
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    const keys = boxes.map((b: any) => b.key).sort()
    expect(keys).toEqual(['r1c0', 'r1c1', 'r2c0', 'r2c1', 'r3c0', 'r3c1'])
    const w = boxes.map((b: any) => b.props.width)
    expect(new Set(w).size).toBe(1)
    const all = await strings(ui)
    for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    for (const want of ['模型', '项目', '状态', '上下文', '5小时', '本周', 'my-app']) expect(all.some(s => s.includes(want)) ? 'ok' : 'missing ' + want).toBe('ok')
    await ui.unmount()
  }
})

test('很窄的终端用一行精简版 (没有螃蟹)；桌面端不画面板，只留引擎自己的提示行', async ($, on) => {
  await start($, on)
  const t = await mountHint($, 'terminal', 45)
  expect(await t.find({ type: 'Raster' })).toBeUndefined()
  expect((await t.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-ctx')).toBe(true)
  expect((await t.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-crab')).toBe(false)
  for (const s of await strings(t)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await t.unmount()
  const d = await mountHint($, 'desktop', 140)
  expect(await d.find({ type: 'Raster' })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /%/ })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await d.unmount()
})

test('每种工具跑的时候大螃蟹的精灵 (面板那只) 和状态文字都能画出来', async ($, on) => {
  const seen: Record<string, string> = {}
  const cases: Array<[string, string]> = [
    ['Read', '读文件'],
    ['Edit', '改文件'],
    ['Bash', '跑命令'],
    ['WebSearch', '搜网页'],
    ['Agent', '派子代理'],
    ['TodoWrite', '记待办'],
    ['mcp__zotero__search', 'zotero:search'],
    ['mcp__Claude_Browser__resize_window', 'Claude_Browser:resize_window'],
  ]
  // 每个格子 = 3 个 u32: 字符 / 前景 / 背景; 字符只能是 空格 ▀ ▄
  const okChars = new Set([32, 0x2580, 0x2584])
  const check = (b64: string, cells: number) => {
    const bin = atob(b64)
    const words = new Uint32Array(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer)
    expect(words.length).toBe(cells * 3)
    for (let i = 0; i < words.length; i += 3) expect(okChars.has(words[i]) ? 'ok' : 'bad ' + words[i]).toBe('ok')
  }
  for (const [tool, label] of cases) {
    for (const opts of [{}, { pct: 85, agents: 2 }, { pct: 97 }, { working: false, agents: 3 }]) {
      const r = previewScene(tool, opts)
      expect(r.label).toContain(label)
      r.frames.forEach((b64, i) => check(b64, i % 2 === 0 ? 15 * 3 : 8 * 1))
      // 动画: 24 帧里至少有 2 种不同的画面
      expect(new Set(r.frames.filter((_, i) => i % 2 === 0)).size > 1 ? 'animated' : 'static').toBe('animated')
    }
  }
})

test('token 统计: 读会话记录 (含子代理) 得到总数和输出数；本会话标签和折合花费', async ($, on) => {
  const calls = await start($, on)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[1]).toMatch(/scripts[\\/]count-tokens\.js$/)
  expect(node?.[2]).toBe('C:\\Users\\me\\.claude\\projects\\D--work-my-app\\abc-123.jsonl')
  let text = ''
  for (let i = 0; i < 5 && !text.includes('M'); i++) {
    const ui = await mountHint($, 'terminal', 124)
    const all = await strings(ui)
    text = all.find(s => s.includes(' out ') || s.includes('统计中')) ?? all.join(' | ')
    expect(all).toContain('token')
    expect(all.some(s => s.trim() === '本会话')).toBe(true)
    expect(all.some(s => s.startsWith('$3.21'))).toBe(true)
    await ui.unmount()
  }
  // 1646 + 716680 + 332073078 + 12632343 = 345,423,747
  expect(text).toContain('345.4M')
  expect(text).toContain('out 717k')
})

test('macOS: 会话记录在 ~/.claude 下、路径用 /；点项目名用 open 打开', async ($, on) => {
  const calls = await start($, on, MAC)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[1]).toMatch(/\/scripts\/count-tokens\.js$/)
  expect(node?.[2]).toBe('/Users/me/.claude/projects/-Users-me-my-app/abc-123.jsonl')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  expect(calls.run.filter(a => a[0] === 'open')).toEqual([['open', '/Users/me/my-app']])
  expect(calls.run.some(a => a[0] === 'cmd.exe')).toBe(false)
  await ui.unmount()
})

test('Linux: 设置了 CLAUDE_CONFIG_DIR 就在它下面找会话记录；xdg-open 打不开时改用 gio open', async ($, on) => {
  const calls = await start($, on, LINUX)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[2]).toBe('/home/me/.config/claude/projects/-home-me-my-app/abc-123.jsonl')
  expect(node?.[4]).toBe('/home/me/.config/claude/projects')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => ['xdg-open', 'gio', 'wslview'].includes(a[0]))
  expect(opens).toEqual([
    ['xdg-open', '/home/me/my-app'],
    ['gio', 'open', '/home/me/my-app'],
  ])
  await ui.unmount()
})

test('Claude 在终端里 cd 进子目录后：项目名、分支、会话记录、打开的文件夹都还按项目根目录', async ($, on) => {
  const CD: Sys = { root: CWD, cwd: CWD + '\\docs\\research', env: { USERPROFILE: 'C:\\Users\\me' } }
  const calls = await start($, on, CD)
  const node = calls.run.findIndex(a => a[0] === 'node')
  expect(calls.run[node]?.[2]).toBe('C:\\Users\\me\\.claude\\projects\\D--work-my-app\\abc-123.jsonl')
  const gitDirs = calls.run.map((a, i) => (a[0] === 'git' ? calls.dirs[i] : null)).filter(d => d !== null)
  expect(gitDirs.length > 0 && gitDirs.every(d => d === CWD)).toBe(true)
  const ui = await mountHint($, 'terminal', 140)
  const all = await strings(ui)
  expect(all).toContain('my-app')
  expect(all.includes('research')).toBe(false)
  await ui.press({ key: 'btn-project' })
  expect(calls.run.filter(a => a[0] === 'cmd.exe')).toEqual([['cmd.exe', '/d', '/c', 'start', 'usage hud', CWD]])
  await ui.unmount()
})

test('WSL: 点项目名时没有 wslview 就经 wslpath 交给 Windows 的 explorer.exe', async ($, on) => {
  const calls = await start($, on, WSL)
  expect(calls.run.find(a => a[0] === 'node')?.[2]).toBe('/home/me/.claude/projects/-home-me-my-app/abc-123.jsonl')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => ['xdg-open', 'gio', 'wslview', 'sh'].includes(a[0]))
  expect(opens).toEqual([
    ['wslview', '/home/me/my-app'],
    ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', '/home/me/my-app'],
  ])
  await ui.unmount()
})

async function mountDesktop($: any, cols: number, isWorking = false) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'desktop',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols, rows: 40, isFullscreen: false },
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: cols, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} },
  } as any)
}

test('客户端版: 螃蟹和仪表盘两张 SVG, 无底板无边框无链接行; 内容齐全、转义正确; 螃蟹图在同一状态下不变', async ($, on) => {
  await start($, on)
  let crabFirst = ''
  for (let i = 0; i < 3; i++) {
    const ui = await mountDesktop($, 110)
    const svgs: any[] = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(2)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    const crab = svgs.find(s => String(s.props.alt).includes('螃蟹'))
    const dash = svgs.find(s => !String(s.props.alt).includes('螃蟹'))
    expect(crab?.props.isInteractive).toBeUndefined()
    // SVG 必须带明确宽高, 否则客户端可能按默认 300x150 放大
    expect([crab?.props.width, crab?.props.height]).toEqual([80, 35])
    const src = String(dash?.props.source ?? '')
    for (const want of ['my-app', 'medium', '本周', '5小时', '上下文', '$3.21', 'token', '345.4M', 'out ', '717k'])
      expect(src.includes(want) ? 'ok' : 'missing ' + want).toBe('ok')
    // 不再画底板和边框
    expect(/stroke=/.test(src) || /<rect x="0\.5" y="0\.5"/.test(src) ? 'has frame' : 'no frame').toBe('no frame')
    expect(/stroke=/.test(String(crab?.props.source)) ? 'has frame' : 'no frame').toBe('no frame')
    expect(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(src)).toBe(false)
    expect(src.length).toBeLessThan(131072)
    if (i === 0) crabFirst = String(crab?.props.source)
    else expect(String(crab?.props.source)).toBe(crabFirst)
    await ui.unmount()
  }
  // 很窄的客户端窗口: 自动只放一行用量条
  const narrow = await mountDesktop($, 55)
  const nd: any = (await narrow.findAll({ type: 'Svg' })).find((s: any) => !String(s.props.alt).includes('螃蟹'))
  expect(String(nd?.props.source)).toContain('height="22"')
  await narrow.unmount()
})

test('/hud top / bottom 不再挪面板: 只回一句话, 不写 store; 面板在输入框下方 (引擎提示行在它下面); 上方横栏终端什么都不画', async ($, on) => {
  await start($, on)
  for (const arg of ['top', 'bottom']) {
    const r: any = await $.command.run({ command: 'hud', args: arg } as any)
    expect(String(r?.text ?? r?.value?.text ?? JSON.stringify(r))).toContain('终端版面板和螃蟹都固定在输入框下方')
  }
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Box' })).some((b: any) => b.key === 'r1c0')).toBe(true)
  // 顺序: 面板 -> 引擎提示行 (没有散步道)
  const root: any = await hint.find({ type: 'Box' })
  const kids: any[] = root?.children ?? []
  expect(kids.map((c: any) => c?.type)).toEqual(['Box', 'Text'])
  expect(textOf(kids[1])).toBe('engine-base')
  await hint.unmount()
  // 上方横栏: 终端什么都不画, 原样交给引擎
  const band = await mountBand($, 140)
  expect(await band.find({ type: 'Client' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await band.unmount()
})

test('store 里以前存的 position=above (测试曾写进用户的 Mac) 一律忽略: 面板照旧在输入框下方', async ($, on) => {
  await start($, on, WIN, { store: { position: 'above' } })
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Box' })).some((b: any) => b.key === 'r1c0')).toBe(true)
  await hint.unmount()
  const band = await mountBand($, 140)
  expect((await band.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))).toBe(false)
  await band.unmount()
})

// ======================== v0.12 新功能 ========================

// 收据和看板里还会出现间隔点 ·
const SAFE2 = /^[\x20-\x7E\u4E00-\u9FFF，│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓·]*$/
const H = 3600_000
const iso = (ms: number) => new Date(ms).toISOString()
const lim = (kind: string, percentUsed: number, resetsAt: number) => ({ kind, percentUsed, resetsAt: iso(resetsAt) })
const PAPER = [COL.paper, COL.scan] // 读 / 改文件时道具区那张纸 (含扫描线)
// 终端显示宽度 (中文 2 列)
const dwT = (s: string) => [...s].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)
// 一格里所有文字 + 按钮的总宽度
async function cellWidth(ui: any, key: string): Promise<number> {
  const box: any = (await ui.findAll({ type: 'Box' })).find((b: any) => b.key === key)
  let w = 0
  for (const c of box?.children ?? []) {
    if (typeof c === 'string') w += dwT(c)
    else if (c?.type === 'Button') w += dwT(String(c.props?.label ?? ''))
    else if (c?.type === 'Text') w += dwT((c.children ?? []).filter((x: any) => typeof x === 'string').join(''))
  }
  return w
}

async function mountTurn($: any, requestId: string, durationMs: number, cols = 140) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'terminal',
    component: 'TurnDuration',
    requestId,
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { word: 'Baked', durationMs },
  } as any)
}

async function mountPane($: any, surface: 'terminal' | 'desktop', cols: number) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface,
    component: 'Pane',
    requestId: 'hud-agents',
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '子代理', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { top: 0, bodyRows: 30, totalRows: 10 }, view: {} },
  } as any)
}

test('配速: 公式、情绪档位、窗口刚开始不外推、没读数不报警', () => {
  const now = 1_800_000_000_000
  // 5小时窗口已过 1h 用了 90%: 配速 4.5, 约 6.7 分钟后用完 -> 慌张
  const a = paceOf(lim('five_hour', 90, now + 4 * H), now)!
  expect(Math.abs((a.ratio ?? 0) - 4.5) < 1e-9).toBe(true)
  expect(Math.round((a.runOutIn ?? 0) / 60000)).toBe(7)
  expect(a.willRunOut).toBe(true)
  expect(moodOf(a)).toBe('panic')
  // 已过 2h 用了 50%: 配速 1.25, 2h 后用完 (重置还要 3h) -> 冒汗
  const b = paceOf(lim('five_hour', 50, now + 3 * H), now)!
  expect(Math.abs((b.ratio ?? 0) - 1.25) < 1e-9).toBe(true)
  expect(b.runOutIn).toBe(2 * H)
  expect(moodOf(b)).toBe('sweat')
  // 已过 3h 用了 23.5%: 配速 0.39, 很宽裕 -> 正常 (v0.17.4 起没有 "悠闲" 了)
  const c = paceOf(lim('five_hour', 23.5, now + 2 * H), now)!
  expect(c.willRunOut).toBe(false)
  expect(moodOf(c)).toBe('normal')
  // 已过 2.5h 用了 45%: 配速 0.9 -> 正常
  expect(moodOf(paceOf(lim('five_hour', 45, now + 2.5 * H), now))).toBe('normal')
  // 本周用了 96% -> 慌张; 取两个里更紧张的
  const w = paceOf(lim('seven_day', 96, now + 3 * 24 * H), now)
  expect(moodOf(c, w)).toBe('panic')
  expect(moodOf(c, b)).toBe('sweat')
  // 负路径: 窗口才过 3 分钟 (不到 2%) 用了 3% -> 不外推, 不报警
  const early = paceOf(lim('five_hour', 3, now + 5 * H - 3 * 60000), now)!
  expect(early.ratio).toBeUndefined()
  expect(early.willRunOut).toBe(false)
  expect(moodOf(early)).toBe('normal')
  // 本周窗口满 1 天才算配速: 才过 7h 用了 6% (按速度外推 4 天多用完) -> 不外推, 不报警; 23h 用了 30% 也不算
  const wk7h = paceOf(lim('seven_day', 6, now + 7 * 24 * H - 7 * H), now)!
  expect(wk7h.ratio).toBeUndefined()
  expect(wk7h.willRunOut).toBe(false)
  expect(moodOf(wk7h)).toBe('normal')
  expect(paceOf(lim('seven_day', 30, now + 7 * 24 * H - 23 * H), now)!.willRunOut).toBe(false)
  // 过了 25h 用了 30%: 配速 2.0, 约 58h 后用完 (重置还要 143h) -> 报警, 冒汗
  const wk25h = paceOf(lim('seven_day', 30, now + 7 * 24 * H - 25 * H), now)!
  expect(wk25h.willRunOut).toBe(true)
  expect(moodOf(wk25h)).toBe('sweat')
  // 已过比例 (时间刻度用): 1h/5h = 0.2; 3 天/7 天; 窗口刚开始不外推也照样有 (0.01); 用量不到 1% 也有
  expect(Math.abs((a.elapsedFrac ?? -1) - 0.2) < 1e-9).toBe(true)
  expect(Math.abs((w?.elapsedFrac ?? -1) - 4 / 7) < 1e-9).toBe(true)
  expect(Math.abs((early.elapsedFrac ?? -1) - 0.01) < 1e-9).toBe(true)
  expect(Math.abs((paceOf(lim('five_hour', 0, now + 4 * H), now)?.elapsedFrac ?? -1) - 0.2) < 1e-9).toBe(true)
  // 重置时刻已过 -> 1; 重置时间比窗口还远 (时钟不准) -> 夹到 0
  expect(paceOf(lim('five_hour', 40, now - H), now)?.elapsedFrac).toBe(1)
  expect(paceOf(lim('five_hour', 40, now + 6 * H), now)?.elapsedFrac).toBe(0)
  // 负路径: 没有重置时间 / 没有读数 / 不认识的窗口
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.elapsedFrac).toBeUndefined()
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.elapsedFrac).toBeUndefined()
  expect(moodOf(undefined, undefined)).toBe('normal')
})

test('配速预警上面板: 会用完时 5小时 的百分比变红, 写红色 "30m用完" (放不下换 "2h用完", 再放不下照常写暗色重置倒计时); 红色的时间一定带 "用完"; 没有 "后重置"', async ($, on) => {
  const t = Date.now()
  // 5小时: 已过 2h 用了 80% -> 30 分钟后用完 ("30m用完" 正好 7 列); 本周: 已过 4 天用了 12% -> 不报警, 3 天后重置
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const noOld = async (ui: any) => {
    for (const x of await ui.findAll({ type: 'Text' })) {
      expect(/后重置|后用完|约/.test(x.text) ? 'old text: ' + x.text : 'ok').toBe('ok')
      // 只有一个时间的红字会被看成重置倒计时: 红色的时间必须带 "用完"
      if (x.props.color === '#f87171' && /\d+[mhd]/.test(x.text)) expect(x.text.includes('用完') ? 'ok' : 'bare red time: ' + x.text).toBe('ok')
    }
  }
  // 完整版 (140 列, 附加 7 列) 和中等版 (73 列, 附加 11 列): "30m用完"
  for (const cols of [140, 73]) {
    const ui = await mountHint($, 'terminal', cols)
    const h5 = await meterOf(ui, 'h5')
    expect(h5.extra?.text).toBe('30m用完')
    expect(h5.extra?.color).toBe('#f87171')
    expect(h5.extra?.bold).toBe(true)
    expect(h5.pct?.color).toBe('#f87171')
    expect(h5.pct?.bold).toBe(true)
    // 本周照旧: 暗色倒计时, 百分比不是红的
    const wk = await meterOf(ui, 'wk')
    expect(wk.extra?.text).toBe('3d0h')
    expect(wk.extra?.color).toBe('#71717a')
    expect(wk.pct?.color === '#f87171').toBe(false)
    // 只有 5小时 那段写了 "用完"
    expect((await ui.findAll({ type: 'Text' })).filter((x: any) => x.text.includes('用完')).length).toBe(1)
    await noOld(ui)
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    await ui.unmount()
  }
  // 中等版窄的时候 (65 列, 附加 5 列) 连 "30m用完" 也放不下: 照常写暗色的重置倒计时 (3h00m), 只有百分比红
  const mid = await mountHint($, 'terminal', 65)
  const m5 = await meterOf(mid, 'h5')
  expect(m5.extra?.text).toBe('3h00m')
  expect(m5.extra?.color).toBe('#71717a')
  expect(m5.pct?.color).toBe('#f87171')
  await noOld(mid)
  await mid.unmount()
  // 精简版: 只有 5小时 那个百分比是红的 (上下文 82% 不是)
  const narrow = await mountHint($, 'terminal', 45)
  const pctTexts = (await narrow.findAll({ type: 'Text' })).filter((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')
  expect(pctTexts.length).toBe(1)
  await narrow.unmount()
  // 用完还早 (2 小时后): 完整版 7 列放不下 "2h00m用完" -> 换粗一点的红色 "2h用完"; 中等版 11 列放得下
  usage = { ...USAGE, rateLimits: [lim('five_hour', 50, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const late = await mountHint($, 'terminal', 140)
  const l5 = await meterOf(late, 'h5')
  expect(l5.extra?.text).toBe('2h用完')
  expect(l5.extra?.color).toBe('#f87171')
  await noOld(late)
  await late.unmount()
  // 本周会用完 (过了 30h 用了 25%, 3 天多后用完): 完整版写红色 "3d用完", 不写光秃秃的 "3d18h"
  usage = { ...USAGE, rateLimits: [lim('five_hour', 10, t + 4 * H), lim('seven_day', 25, t + 7 * 24 * H - 30 * H)] }
  const wkWarn = await mountHint($, 'terminal', 140)
  const ww = await meterOf(wkWarn, 'wk')
  expect(ww.extra?.text).toBe('3d用完')
  expect(ww.extra?.color).toBe('#f87171')
  expect(ww.pct?.color).toBe('#f87171')
  await noOld(wkWarn)
  await wkWarn.unmount()
  // 负路径 (用户截图那种): 本周才过 7h 用了 6% -> 不满 1 天不预警: 暗色重置倒计时 "6d17h", 百分比不红
  usage = { ...USAGE, rateLimits: [lim('five_hour', 10, t + 4 * H), lim('seven_day', 6, t + 7 * 24 * H - 7 * H)] }
  const wkEarly = await mountHint($, 'terminal', 140)
  const we = await meterOf(wkEarly, 'wk')
  expect(we.extra?.text).toBe('6d17h')
  expect(we.extra?.color).toBe('#71717a')
  expect(we.pct?.color === '#f87171').toBe(false)
  await wkEarly.unmount()
  usage = { ...USAGE, rateLimits: [lim('five_hour', 50, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const late90 = await mountHint($, 'terminal', 73)
  expect((await meterOf(late90, 'h5')).extra?.text).toBe('2h00m用完')
  await late90.unmount()
  // 负路径: 配速正常时没有 "用完", 百分比不红, 文字只是暗色的重置倒计时
  usage = { ...USAGE, rateLimits: [lim('five_hour', 23.5, t + 2 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  for (const cols of [140, 73, 45]) {
    const ok = await mountHint($, 'terminal', cols)
    // (状态格里先前亮起的 "慢点！…用完" 事件不算: 这个测试的时钟不走, 它不会收起)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => x.text.includes('用完') && !x.text.includes('慢点'))).toBe(false)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')).toBe(false)
    if (cols !== 45) {
      const o5 = await meterOf(ok, 'h5')
      expect(o5.extra?.text).toBe('2h00m')
      expect(o5.extra?.color).toBe('#71717a')
    }
    await noOld(ok)
    await ok.unmount()
  }
})

test('大螃蟹的精灵 (面板那只) 的情绪: 不戴墨镜 (悠闲和正常画法一样)、冒汗有汗滴、慌张举钳加 "!"; 子代理在跑时看着小螃蟹打气; 客户端 SVG 也画出来', () => {
  const at = (px: number[][], x: number, y: number) => px[y]?.[x]
  const SHADES = [0x09090b, 0x52525b] // 以前的墨镜镜片 / 鼻梁
  const idle = previewPixels('', { working: false, mood: 'normal', frames: 160 })
  const C = COL
  // 闲着: 眨眼、张望、挥手, 没有墨镜
  expect(idle.big.some(px => px.some(row => row.some(c => SHADES.includes(c))))).toBe(false)
  expect(idle.mini.some(px => px.some(row => row.some(c => SHADES.includes(c))))).toBe(false)
  // 子代理在跑、主线程闲着: 眼睛往右下看着小螃蟹 (身体第 3 行, 往右挪一格); 隔一会儿举右钳打气
  const watching = previewPixels('', { working: false, mood: 'normal', agents: 2, frames: 40 })
  expect(watching.big.every(px => at(px, 5, 2) === C.eye && at(px, 8, 2) === C.eye)).toBe(true)
  expect(watching.big.some(px => at(px, 11, 0) === C.body)).toBe(true) // 右钳举起 (x 11, 第 0-1 行)
  expect(watching.big.slice(0, 32).some(px => at(px, 11, 0) === C.body)).toBe(false) // 不是一直举着
  const sweat = previewPixels('Read', { working: true, mood: 'sweat' })
  expect(sweat.big.some(px => at(px, 1, 0) === C.sweat || at(px, 1, 1) === C.sweat)).toBe(true)
  const panicIdle = previewPixels('', { working: false, mood: 'panic' })
  expect(panicIdle.big.some(px => at(px, 13, 0) === C.alarm && at(px, 13, 3) === C.alarm)).toBe(true)
  // 举钳: 左钳竖在 x=0 的第 0-1 行
  expect(panicIdle.big.every(px => at(px, 0, 0) === C.body || at(px, 0, 1) === C.body)).toBe(true)
  const panicWork = previewPixels('Bash', { working: true, mood: 'panic' })
  expect(panicWork.big.some(px => at(px, 1, 0) === C.alarm)).toBe(true)
  // 庆祝时不画情绪标记
  expect(previewPixels('', { working: false, celebrating: true, mood: 'panic' }).big.some(px => at(px, 1, 0) === C.alarm)).toBe(false)
  const svg = (mood: any, mode: any = 'idle') => crabSvg({ mode, kind: 'think', heat: 'ok', agents: 0, mood }, 5)
  expect(svg('normal')).not.toContain('#09090b')
  // 姿势 (mode) 由 crabPose 算好传进来: 慌张 (睡着的也会被叫醒) / 看着子代理 和终端版同一套先后
  const scene = (o: any) => ({ working: false, kind: 'think' as const, pct: 30, celebrating: false, sleeping: false, agents: 0, mood: 'normal' as const, ...o })
  expect(crabPose(scene({ sleeping: true, mood: 'panic' }))).toBe('panic')
  expect(crabPose(scene({ sleeping: true, agents: 2 }))).toBe('watch')
  expect(crabPose(scene({ agents: 2, mood: 'panic' }))).toBe('panic')
  expect(crabPose(scene({ working: true, agents: 2 }))).toBe('work')
  expect(crabPose(scene({ celebrating: true, working: true }))).toBe('celebrate')
  expect(svg('sweat')).toContain('#60a5fa')
  expect(svg('panic')).toContain('#ef4444')
  expect(svg('panic', 'work')).toContain('#ef4444')
})

test('每轮收据: 引擎那行原样保留, 后面追加花费/改文件/工具次数; 对不上的行不显示', async ($, on) => {
  let t = Date.now() + 600_000
  let usage: any = { ...USAGE, cost: { usd: 1 } }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  // 负路径: 这一轮开始之前就画出来的行 (更早的回合)
  const old = await mountTurn($, 'msg-old', 9000)
  await old.unmount()
  t += 1000
  await $.turn.start({ text: 'hi', turnId: 'r-1' } as any)
  await $.tool.call({ tool: 'Edit', file_path: 'D:\\work\\my-app\\a.ts', old_string: 'x', new_string: 'y\nz' } as any)
  await $.tool.call({ tool: 'Write', file_path: 'D:\\work\\my-app\\b.ts', content: '1\n2\n3\n' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\a.ts' } as any)
  usage = { ...usage, cost: { usd: 1.42 } }
  t += 9000
  await $.turn.complete({ answer: '', durationMs: 9000, isAborted: false, turnId: 'r-1', reason: 'answer' } as any)
  t += 50
  const row = await mountTurn($, 'msg-r1', 9050)
  const texts = (await row.findAll({ type: 'Text' })).map((x: any) => x.text)
  expect(engineChain(await row.drawn())).toEqual([['Box', []]]) // 引擎那行原样 (引擎节点), 外面只有一层不带被禁属性的 Box
  expect(texts).toContain(' · $0.42 · 改 2 个文件 +5 -1 · 工具 3 次')
  for (const s of texts) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await row.unmount()
  // 同一行重画还是同一张收据
  const again = await mountTurn($, 'msg-r1', 9050)
  expect((await again.findAll({ type: 'Text' })).some((x: any) => x.text.includes('$0.42'))).toBe(true)
  await again.unmount()
  // 负路径: 更早的那行、以及收据已经配给别的行之后新来的行, 都不显示
  for (const id of ['msg-old', 'msg-r1-dup']) {
    const r = await mountTurn($, id, 9000)
    expect((await r.findAll({ type: 'Text' })).map((x: any) => x.text)).toEqual([]) // 只有引擎那行
    expect(engineChain(await r.drawn())).toEqual([])
    await r.unmount()
  }
  // 负路径: 时长对不上 (30s vs 9s) 的行不显示
  t += 5000
  await $.turn.start({ text: 'again', turnId: 'r-2' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\a.ts' } as any)
  t += 9000
  await $.turn.complete({ answer: '', durationMs: 9000, isAborted: false, turnId: 'r-2', reason: 'answer' } as any)
  const off = await mountTurn($, 'msg-r2-wrong', 30000)
  expect((await off.findAll({ type: 'Text' })).map((x: any) => x.text)).toEqual([])
  expect(engineChain(await off.drawn())).toEqual([])
  await off.unmount()
  // 没花钱、没改文件的那段省掉
  const r2 = await mountTurn($, 'msg-r2', 9000)
  expect((await r2.findAll({ type: 'Text' })).map((x: any) => x.text)).toContain(' · 工具 1 次')
  await r2.unmount()
  // 什么都没有 -> 空串 (只留引擎那行)
  expect(receiptText({ usd: 0, files: 0, add: 0, del: 0, tools: 0 })).toBe('')
})

test('一键压缩: 上下文 >=75% 时三档都有 [压缩] 按钮, 点了跑 /compact 且防连点; 格子宽度不变', async ($, on) => {
  let usage: any = { ...USAGE }
  const calls = await start($, on, WIN, { usage: () => usage })
  const widths: Record<number, number> = {}
  for (const cols of [140, 65, 45]) {
    const ui = await mountHint($, 'terminal', cols)
    const btn: any = await ui.find({ type: 'Button', key: 'btn-compact' })
    expect(btn?.props.label).toBe('压缩')
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    if (cols !== 45) widths[cols] = await cellWidth(ui, cols === 140 ? 'r2c0' : 'r1c1')
    await ui.unmount()
  }
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-compact' })
  await ui.press({ key: 'btn-compact' })
  expect(calls.cmd.filter(c => c === 'compact').length).toBe(1)
  await ui.unmount()
  // 负路径: 50% 时没有按钮, 但那一格的总宽度和有按钮时一样
  usage = { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }
  for (const cols of [140, 65]) {
    const low = await mountHint($, 'terminal', cols)
    expect(await low.find({ type: 'Button', key: 'btn-compact' })).toBeUndefined()
    expect(await cellWidth(low, cols === 140 ? 'r2c0' : 'r1c1')).toBe(widths[cols])
    await low.unmount()
  }
})

test('额度恢复提醒: 用到 >=30% 后重置时刻已过才提醒一次, 不重复; 用量从高位掉到 <5% 也算', async ($, on) => {
  let t = Date.now() + 1_200_000
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 40, t + H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const calls = await start($, on, WIN, { usage: () => usage, now: () => t })
  const end = () => $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'z', reason: 'answer' } as any)
  const restored = () => calls.toasts.filter(x => x.includes('额度已恢复')).length
  await end()
  expect(restored()).toBe(0) // 负路径: 还没到重置时刻
  t += 2 * H // 读数没变 (闲着没请求), 但重置时刻已过
  await end()
  expect(calls.toasts).toContain('5 小时额度已恢复，可以继续了')
  await end()
  expect(restored()).toBe(1) // 不重复
  // 新窗口: 先低后高, 再掉到 <5%
  usage = { ...usage, rateLimits: [lim('five_hour', 2, t + 5 * H)] }
  await end()
  expect(restored()).toBe(1) // 负路径: 低位开始的新窗口不提醒
  usage = { ...usage, rateLimits: [lim('five_hour', 35, t + 5 * H)] }
  await end()
  usage = { ...usage, rateLimits: [lim('five_hour', 3, t + 5 * H)] }
  await end()
  expect(restored()).toBe(2)
})

test('子代理看板: 点 "+1代理" 或 /hud agents 打开侧边面板; 显示描述/时长/最后工具/状态; 5 分钟没动静标红; 结束后保留', async ($, on) => {
  let t = Date.now() + 1_800_000
  let list: any[] = [{ id: 'k1', description: '查文献', type: 'Explore', status: 'running' }]
  const calls = await start($, on, WIN, { agents: () => list, now: () => t })
  await $.classic.SubagentStart({ agent_id: 'k1', agent_type: 'Explore' } as any)
  const hint = await mountHint($, 'terminal', 140)
  const btn: any = await hint.find({ type: 'Button', key: 'btn-agents' })
  expect(btn?.props.label).toBe('+1代理')
  await hint.press({ key: 'btn-agents' })
  await hint.press({ key: 'btn-agents' })
  expect(calls.opens.length).toBe(1)
  expect(calls.opens[0]).toMatchObject({ id: 'hud-agents', closeOnEscape: true })
  await hint.unmount()
  await $.command.run({ command: 'hud', args: 'agents' } as any)
  expect(calls.opens.length).toBe(2)
  expect(calls.cmd.includes('agents')).toBe(false) // 没有去跑内置的 /agents
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await mountPane($, surface, 100)
    const all = await strings(pane)
    expect(all.some(s => s.includes('查文献'))).toBe(true)
    expect(all.some(s => s.includes('运行中'))).toBe(true)
    expect(all.some(s => s.includes('可能卡住'))).toBe(false)
    for (const s of all) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    // 只留引擎自己的 x 和 Esc, 不再画我们自己的 "关闭"
    expect(await pane.find({ type: 'Button', key: 'btn-agents-close' })).toBeUndefined()
    expect((await pane.findAll({ type: 'Button' })).length).toBe(0)
    await pane.unmount()
  }
  t += 6 * 60_000 // 6 分钟没有任何工具动作
  const stuck = await mountPane($, 'terminal', 100)
  const red = (await stuck.findAll({ type: 'Text' })).find((x: any) => x.text.includes('可能卡住'))
  expect(red?.props.color).toBe('#f87171')
  await stuck.unmount()
  // 结束: 保留在 "已结束" 里, 显示用时 (窄面板两行一个)
  await $.classic.SubagentStop({ agent_id: 'k1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: '找到 3 篇' } as any)
  list = [{ id: 'k1', description: '查文献', type: 'Explore', status: 'completed' }]
  const done = await mountPane($, 'terminal', 44)
  const txt = await strings(done)
  expect(txt.some(s => s.includes('已完成'))).toBe(true)
  expect(txt.some(s => s.includes('已结束'))).toBe(true)
  expect(txt.some(s => s.includes('用时 6m00s'))).toBe(true)
  expect(txt.some(s => s.includes('可能卡住'))).toBe(false)
  await done.unmount()
  // 没有子代理在跑时状态格里没有那个按钮
  list = []
  const quiet = await mountHint($, 'terminal', 140)
  expect(await quiet.find({ type: 'Button', key: 'btn-agents' })).toBeUndefined()
  await quiet.unmount()
})

test('点档位文字跑 /effort, 双击只算一次; 五格保持彩色', async ($, on) => {
  const calls = await start($, on)
  for (const cols of [140, 65]) {
    const ui = await mountHint($, 'terminal', cols)
    const b: any = await ui.find({ type: 'Button', key: 'btn-effort' })
    expect(b?.props.label).toBe('medium')
    const pip: any = (await ui.findAll({ type: 'Text' })).find((x: any) => x.text === '▁')
    expect(pip?.props.color).toBe('#60a5fa')
    await ui.unmount()
  }
  // 精简版 (有位置时) 也能点
  await $.command.run({ command: 'hud' } as any)
  const c = await mountHint($, 'terminal', 120)
  expect(((await c.find({ type: 'Button', key: 'btn-effort' })) as any)?.props.label).toBe('medium')
  expect((await c.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-ctx')).toBe(true) // 精简版 (一行, 没有螃蟹)
  expect(await c.find({ type: 'Raster' })).toBeUndefined()
  await c.unmount()
  await $.command.run({ command: 'hud' } as any)
  await $.command.run({ command: 'hud' } as any)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-effort' })
  await ui.press({ key: 'btn-effort' })
  expect(calls.cmd.filter(c => c === 'effort').length).toBe(1)
  await ui.unmount()
})

test('子代理小螃蟹: 道具区右下角 3x2 (0.13 的画法, 蹲下 / 跳起两个姿势), 道具上移到 y 0-2, 两样同时看得见; 几个子代理都只画一只; 精简版不画; 都结束后淡出', () => {
  const tools = ['Read', 'Edit', 'Bash', 'WebSearch', 'TodoWrite', 'Agent', '']
  for (const tool of tools) {
    for (const working of [true, false]) {
      const none = previewPixels(tool, { working, agents: 0, frames: 24 })
      for (const n of [1, 2, 3]) {
        const r = previewPixels(tool, { working, agents: n, frames: 24 })
        const C = COL
        const seen = new Set<string>()
        r.big.forEach((px, f) => {
          // 小螃蟹: 蹲下 = y4 身体 CCC + y5 腿 L.L (y3 空着); 跳起 = y3 身体 CCC + y4 腿 .L. (y5 空着); 没有眼睛
          const row = (y: number) => [12, 13, 14].map(x => px[y][x])
          const up = row(3).every(c => c === C.kid)
          seen.add(up ? 'up' : 'down')
          const [K, L, _] = [C.kid, C.kidLeg, -1]
          expect([row(3), row(4), row(5)]).toEqual(up ? [[K, K, K], [_, L, _], [_, _, _]] : [[_, _, _], [K, K, K], [L, _, L]])
          // 小螃蟹的颜色只出现在右下角 (x 12-14, y 3-5); 道具区上面 (y 0-2) 没有它
          px.forEach((row, y) => row.forEach((c, x) => {
            if (c === C.kid || c === C.kidLeg) expect(x >= 12 && y >= 3 ? 'ok' : `kid at ${x},${y}`).toBe('ok')
          }))
          // 干活时大螃蟹本身 (x 0-11) 和没有子代理时逐像素相同 (闲着时换成看着小螃蟹打气, 见情绪那条测试)
          if (working) for (let y = 0; y < 6; y++) expect(JSON.stringify(px[y].slice(0, 12))).toBe(JSON.stringify(none.big[f][y].slice(0, 12)))
        })
        expect([...seen].sort()).toEqual(['down', 'up']) // 24 帧里蹲下、跳起两个姿势都有
        // 精简版: 不画小螃蟹 (数量看 "+N代理")
        expect(JSON.stringify(r.mini)).toBe(JSON.stringify(none.mini))
      }
    }
  }
  // 读文件 + 子代理: 纸上移到 y 0-2, 小螃蟹在 y 3-5, 同时看得见
  const both = previewPixels('Read', { working: true, agents: 2, frames: 1 })
  expect([0, 1, 2].every(y => [12, 13, 14].every(x => PAPER.includes(both.big[0][y][x])))).toBe(true)
  // 都结束后淡出: 进度 0 -> 1 颜色越来越暗, 到 1 就不画
  const fade = (bye: number) => previewPixels('', { working: false, agents: 0, kidBye: bye, frames: 1 }).big[0][4][13]
  expect(fade(0)).toBe(COL.kid)
  expect(lumOf(fade(0.5)) < lumOf(fade(0))).toBe(true)
  expect(lumOf(fade(0.9)) < lumOf(fade(0.5))).toBe(true)
  expect(fade(1)).toBe(-1)
  // 客户端: 干活 / 闲着 / 睡觉 / 庆祝时都画 n 只; 不戴墨镜
  for (const n of [0, 1, 2, 3]) {
    for (const mode of ['work', 'idle', 'sleep', 'celebrate'] as const) {
      const svg = crabSvg({ mode, kind: 'read', heat: 'ok', agents: n }, 5)
      expect((svg.match(/class="kid"/g) ?? []).length).toBe(n)
      expect(svg.includes('#d4d4d8')).toBe(n === 0 && mode === 'work')
    }
    expect(crabSvg({ mode: n ? 'watch' : 'idle', kind: 'think', heat: 'ok', agents: n }, 5).includes('#09090b')).toBe(false)
  }
})

test('新按钮 ([压缩] / +1代理 / 档位) 放进去后, 从 51 到 200 列每一格的内容都不超出格子宽度', async ($, on) => {
  await start($, on)
  for (const cols of [51, 53, 65, 70, 73, 80, 81, 83, 101, 118, 123, 140, 200]) {
    for (const working of [false, true]) {
      const ui = await mountHint($, 'terminal', cols, working)
      const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
      expect(boxes.length > 0).toBe(true)
      for (const b of boxes) {
        const w = await cellWidth(ui, b.key)
        expect(w <= b.props.width ? 'ok' : `${cols} 列 ${b.key}: 内容 ${w} > 格子 ${b.props.width}`).toBe('ok')
      }
      await ui.unmount()
    }
  }
})

test('配速只比线性快一点 (1.05) 不报警; 明显偏快 (1.3) 才算会用完', async () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  // 5 小时窗口过了一半 (还剩 2.5 小时), 按线性该用 50%
  const resetsAt = new Date(now + 2.5 * 3600_000).toISOString()
  const slight = paceOf({ kind: 'five_hour', percentUsed: 52.5, resetsAt }, now)
  expect(slight?.willRunOut).toBe(false)
  expect(moodOf(slight)).toBe('normal')
  const fast = paceOf({ kind: 'five_hour', percentUsed: 65, resetsAt }, now)
  expect(fast?.willRunOut).toBe(true)
  expect(moodOf(fast)).toBe('sweat')
})

// ======================== v0.13: 时间刻度 / 宽度 ========================

// 一根用量条所在的那一格 (三档都按开头的标签按钮找: 上下文 btn-ctx / 精简版压缩时 btn-compact, 5小时 btn-h5, 本周 btn-wk)
// 返回: 条的每一格 (字符 + 颜色)、百分比、附加文字、百分比前面有几列、整格内容宽度
// (界面树里 Text 不带 key, 所以按格子里的子元素顺序认); boxes = 先取好的 Box 列表 (一次画面只取一次, 省时间)
const textOf = (c: any) => (typeof c === 'string' ? c : (c?.children ?? []).filter((x: any) => typeof x === 'string').join(''))
const widthOf = (c: any) => (c?.type === 'Button' ? dwT(String(c.props?.label ?? '')) : dwT(textOf(c)))
function meterIn(boxes: any[], k: 'ctx' | 'h5' | 'wk') {
  const btns = k === 'ctx' ? ['btn-ctx', 'btn-compact'] : ['btn-' + k]
  const box: any = boxes.find((b: any) => {
    const c0: any = (b.children ?? [])[0]
    return c0?.type === 'Button' && btns.includes(String(c0.props?.key))
  })
  const kids: any[] = box?.children ?? []
  const cells = kids.filter(c => c?.type === 'Text' && /^[━│]$/.test(textOf(c))).map(c => ({ text: textOf(c), color: c.props?.color }))
  const pi = kids.findIndex(c => c?.type === 'Text' && /^\s*(\d+%|--)$/.test(textOf(c)))
  let pctAt = 0
  for (let i = 0; i < pi; i++) pctAt += widthOf(kids[i])
  const el = (c: any) => (c ? { text: textOf(c).trim(), color: c.props?.color, bold: c.props?.bold } : undefined)
  return {
    box: box?.key as string | undefined,
    boxW: box?.props?.width as number | undefined,
    used: kids.reduce((w: number, c: any) => w + widthOf(c), 0),
    cells,
    pct: el(kids[pi]),
    extra: pi >= 0 && kids[pi + 1]?.type === 'Text' ? el(kids[pi + 1]) : undefined,
    pctAt: pi >= 0 ? pctAt : -1,
  }
}
const meterOf = async (ui: any, k: 'ctx' | 'h5' | 'wk') => meterIn(await ui.findAll({ type: 'Box' }), k)
async function tickOf(ui: any, k: 'ctx' | 'h5' | 'wk') {
  const { cells } = await meterOf(ui, k)
  return { bw: cells.length, idx: cells.map((c: any, i: number) => (c.text === '│' ? i : -1)).filter((i: number) => i >= 0), cells }
}

test('时间刻度: 5小时/本周 的条里正好一道亮色 │, 位置 = 已过时间/窗口 (四舍五入到格), 随时间右移; 条长不变; 上下文没有; 三档都有', async ($, on) => {
  let t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const set = (...ls: any[]) => (usage = { ...USAGE, rateLimits: ls })
  // 列数 = 旧版 (有螃蟹时) 的列数减 17, 格子几何不变; 48 列是精简版 (一行放不下本周, 只看 5小时)
  for (const cols of [183, 123, 101, 88, 83, 73, 65, 48]) {
    const seen: number[] = []
    // 5小时 已过 1h (0.2) -> 4h (0.8); 本周 已过 1 天 -> 6 天
    for (const [hrs, days] of [
      [1, 1],
      [4, 6],
    ]) {
      set(lim('five_hour', 23.5, t + (5 - hrs) * H), lim('seven_day', 12, t + (7 - days) * 24 * H))
      const ui = await mountHint($, 'terminal', cols)
      const a = await tickOf(ui, 'h5')
      expect(a.bw >= 3).toBe(true)
      expect(a.idx).toEqual([Math.min(a.bw - 1, Math.round((hrs / 5) * a.bw))])
      expect(a.cells[a.idx[0]].color).toBe('#e5e5e5')
      // 刻度替换那一格的 ━, 条的总格数不变
      expect(a.cells.filter((c: any) => c.text === '━').length).toBe(a.bw - 1)
      if (cols >= 51) {
        const w = await tickOf(ui, 'wk')
        expect(w.idx).toEqual([Math.min(w.bw - 1, Math.round((days / 7) * w.bw))])
        expect(w.cells[w.idx[0]].color).toBe('#e5e5e5')
      }
      // 负路径: 上下文那根没有刻度
      const c = await tickOf(ui, 'ctx')
      expect(c.bw > 0 && c.idx.length === 0).toBe(true)
      for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      seen.push(a.idx[0])
      await ui.unmount()
    }
    expect(seen[1] > seen[0] ? 'ok' : `${cols} 列: 刻度没有右移 ${seen}`).toBe('ok')
  }
  // 刻度在彩色段里 (用量超过时间) 和暗色段里 (用量落后) 都是同一种亮色; 123 列 (旧版 140 列) 5小时 的条 17 格
  // 百分比有滚动过渡: 多画几次, 等 5小时 的数字停到目标值再看彩色段
  const settled = async (want: string) => {
    for (let i = 0; i < 40; i++) {
      const ui = await mountHint($, 'terminal', 123)
      if ((await meterOf(ui, 'h5')).pct?.text === want) return ui
      await ui.unmount()
    }
    throw new Error('5小时 的百分比没有停到 ' + want)
  }
  set(lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H))
  const ahead = await settled('80%')
  const ah = await tickOf(ahead, 'h5')
  expect(ah.bw).toBe(17)
  expect(ah.idx).toEqual([7]) // 0.4 x 17 = 6.8 -> 7
  expect(ah.cells[ah.idx[0] - 1].color === '#3f3f46').toBe(false) // 前一格是彩色
  expect(ah.cells[ah.idx[0] + 1].color === '#3f3f46').toBe(false) // 后一格也是彩色 (80% 已经超过刻度)
  await ahead.unmount()
  set(lim('five_hour', 10, t + 1 * H), lim('seven_day', 12, t + 3 * 24 * H))
  const behind = await settled('10%')
  const bh = await tickOf(behind, 'h5')
  expect(bh.idx).toEqual([14]) // 0.8 x 17 = 13.6 -> 14
  expect(bh.cells[bh.idx[0] - 1].color).toBe('#3f3f46')
  expect(bh.cells[bh.idx[0]].color).toBe('#e5e5e5')
  await behind.unmount()
  // >=90% 用量条呼吸闪烁时, 刻度不跟着变色
  set(lim('five_hour', 95, t + 1 * H), lim('seven_day', 12, t + 3 * 24 * H))
  for (let i = 0; i < 3; i++) {
    const hot = await mountHint($, 'terminal', 123)
    const hh = await tickOf(hot, 'h5')
    expect(hh.cells[hh.idx[0]].color).toBe('#e5e5e5')
    await hot.unmount()
  }
  // 窗口刚开始 (过了 3 分钟, 配速不外推) 刻度照样画; 用量只占第 0 格那 1 格彩色时, 刻度让到第 1 格, 不盖住彩色
  set(lim('five_hour', 3, t + 5 * H - 3 * 60000), lim('seven_day', 12, t + 3 * 24 * H))
  const early = await settled('3%')
  const eh = await tickOf(early, 'h5')
  expect(eh.idx).toEqual([1])
  expect(['#3f3f46', '#e5e5e5'].includes(eh.cells[0].color)).toBe(false)
  await early.unmount()
  // 负路径: 用量 0% (没有彩色格) -> 刻度留在第 0 格
  set(lim('five_hour', 0, t + 5 * H - 3 * 60000), lim('seven_day', 12, t + 3 * 24 * H))
  const empty = await settled('0%')
  expect((await tickOf(empty, 'h5')).idx).toEqual([0])
  await empty.unmount()
  // 负路径: 没有重置时间 -> 不画刻度
  set({ kind: 'five_hour', percentUsed: 40 }, lim('seven_day', 12, t + 3 * 24 * H))
  for (const cols of [123, 65, 48]) {
    const none = await mountHint($, 'terminal', cols)
    const nh = await tickOf(none, 'h5')
    expect(nh.bw > 0 && nh.idx.length === 0).toBe(true)
    if (cols >= 51) expect((await tickOf(none, 'wk')).idx.length).toBe(1)
    await none.unmount()
  }
})

// 宽度测试用的三种读数: 上下文 82% (有 [压缩] 按钮) / 5小时 会用完 / 上下文 50% (没按钮)
const widthUsages = (t: number) => [
  { ...USAGE },
  { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] },
  { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } },
]

// 注意: 面板宽度 = 终端列数 - 2, 所以 81 列起是完整版, 51-80 列是中等版 (v0.16 面板没有螃蟹, 比旧版各少 17 列)
test('完整版: 上下文 / 5小时 / 本周 三格总宽都正好等于列宽; 5小时/本周 附加 7 列, 省下的给条', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [81, 87, 88, 100, 102, 123, 183]) {
      for (const working of [false, true]) {
        const ui = await mountHint($, 'terminal', cols, working)
        const boxes = await ui.findAll({ type: 'Box' })
        const ms = [meterIn(boxes, 'ctx'), meterIn(boxes, 'h5'), meterIn(boxes, 'wk')]
        expect(ms.map(m => m.box)).toEqual(['r2c0', 'r2c1', 'r2c2'])
        for (const m of ms) expect(m.used === m.boxW ? 'ok' : `${cols} 列 ${m.box}: 内容 ${m.used} != 列宽 ${m.boxW}`).toBe('ok')
        // 条长 = 列宽 - 标签 7 - 百分比 5 - 1 - 附加; 上下文附加 11 列时 5小时/本周 用 7 列;
        // 上下文的条不到 6 格、退到 5 列时, 三格都用 5 列 (条一样长, 不比 0.12 短)
        const inner = (ms[0].boxW ?? 0) - 7
        const wantCtx = inner - 17 >= 6 ? inner - 17 : inner - 11
        const wantLim = inner - 17 >= 6 ? inner - 13 : inner - 11
        expect(ms.map(m => m.cells.length)).toEqual([wantCtx, wantLim, wantLim])
        // 上下文附加 11 列时 (102 列起), 5小时/本周 的条比它长 4 格
        if (cols >= 102) expect(ms[1].cells.length - ms[0].cells.length).toBe(4)
        expect(ms[1].cells.length >= 5).toBe(true)
        await ui.unmount()
      }
    }
  }
})

test('中等版: 右列三根条一样长, 百分比竖着对齐, 每格总宽等于列宽', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [51, 59, 65, 73, 80]) {
      for (const working of [false, true]) {
        const ui = await mountHint($, 'terminal', cols, working)
        const boxes = await ui.findAll({ type: 'Box' })
        const ms = [meterIn(boxes, 'ctx'), meterIn(boxes, 'h5'), meterIn(boxes, 'wk')]
        expect(ms.map(m => m.box)).toEqual(['r1c1', 'r2c1', 'r3c1'])
        const lens = ms.map(m => m.cells.length)
        expect(lens[0] >= 3 && new Set(lens).size === 1 ? 'ok' : `${cols} 列 条长 ${lens}`).toBe('ok')
        const offs = ms.map(m => m.pctAt)
        expect(offs[0] > 0 && new Set(offs).size === 1 ? 'ok' : `${cols} 列 百分比位置 ${offs}`).toBe('ok')
        for (const m of ms) expect(m.used === m.boxW ? 'ok' : `${cols} 列 ${m.box}: 内容 ${m.used} != 列宽 ${m.boxW}`).toBe('ok')
        await ui.unmount()
      }
    }
  }
})

test('客户端仪表盘: 5小时/本周 的条上有亮色细竖线刻度 (略高出条, 随已过时间右移); 文字 "2h00m" / 红色 "30m 用完"; 没有 "后重置"', async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const dash = async (cols: number) => {
    const ui = await mountDesktop($, cols)
    const d: any = (await ui.findAll({ type: 'Svg' })).find((s: any) => !String(s.props.alt).includes('螃蟹'))
    const src = String(d?.props.source ?? '')
    await ui.unmount()
    return src
  }
  const redSpans = (src: string) => (src.match(/<tspan fill="#f87171"/g) ?? []).length
  const warn = await dash(140)
  expect((warn.match(/class="tick"/g) ?? []).length).toBe(2)
  expect(warn).toContain('30m 用完')
  expect(warn).toContain('3d0h')
  expect(redSpans(warn)).toBe(2) // 5小时 的百分比 + "30m 用完"
  expect(/后重置|后用完|约/.test(warn)).toBe(false)
  // 窄的时候缩写也留着 "用完" ("4d12h 用完" -> "4d 用完"), 不出现光秃秃的红色时间 (会被看成重置倒计时)
  const redTexts = (src: string) => [...src.matchAll(/<tspan fill="#f87171"[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1].trim())
  const seenRed = new Set<string>()
  for (const width of [900, 760, 640, 560, 480, 420, 360]) {
    const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, five: { pct: 30, extra: '1h54m' }, week: { pct: 6, extra: '4d12h 用完', warn: true, tick: 0.04 }, status: { text: '', tone: 'idle' }, tools: '', tokenTotal: '', tokenOutput: '' }, { width })
    for (const r of redTexts(svg)) {
      expect(/^\d+%$/.test(r) || r.includes('用完') ? 'ok' : `${width}px: bare red "${r}"`).toBe('ok')
      seenRed.add(r)
    }
  }
  expect(seenRed.has('4d12h 用完')).toBe(true)
  // 负路径: 配速正常 -> 没有 "用完", 没有红字; 刻度照样有
  usage = { ...USAGE }
  const ok = await dash(140)
  expect(ok).toContain('2h00m')
  expect(ok.includes('用完')).toBe(false)
  expect(redSpans(ok)).toBe(0)
  expect((ok.match(/class="tick"/g) ?? []).length).toBe(2)
  expect(/后重置/.test(ok)).toBe(false)
  // 一行精简版也有刻度
  const narrow = await dash(55)
  expect((narrow.match(/class="tick"/g) ?? []).length).toBe(2)
  // 直接画: 刻度比条高, 在条的范围内, 已过比例越大越靠右; 不给 tick 不画
  const one = (tick?: number) => {
    const m = { pct: 30, extra: '1h54m', tick }
    const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, five: m, week: { pct: 3, extra: '' }, status: { text: '', tone: 'idle' }, tools: '', tokenTotal: '', tokenOutput: '' }, { width: 900 })
    const tk = svg.match(/<rect class="tick" x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="#e5e5e5"\/>/)
    return { svg, tk }
  }
  const a = one(0.2)
  const b = one(0.8)
  expect(a.tk && b.tk ? 'ok' : 'no tick').toBe('ok')
  expect(Number(b.tk![1]) > Number(a.tk![1])).toBe(true)
  // 条: y-6 高 5; 刻度: y-7.5 高 8 (上下各高出 1.5)
  const bar = a.svg.match(/<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="5" rx="2.5" fill="#3a3a40"\/>/g) ?? []
  expect(bar.length).toBe(3)
  const fiveBar = bar[1].match(/x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)"/)!
  const [bx, by, bw] = [Number(fiveBar[1]), Number(fiveBar[2]), Number(fiveBar[3])]
  for (const r of [a, b, one(0), one(1)]) {
    const [tx, ty, tw, th] = r.tk!.slice(1).map(Number)
    expect(ty < by && ty + th > by + 5).toBe(true)
    expect(tx >= bx - 0.05 && tx + tw <= bx + bw + 0.05).toBe(true)
  }
  expect(Math.abs(Number(a.tk![1]) + 0.75 - (bx + bw * 0.2)) < 0.1).toBe(true)
  expect(one(undefined).tk).toBeNull()
  expect(one(undefined).svg.includes('class="tick"')).toBe(false)
  expect(one(undefined).svg.includes('后重置')).toBe(false)
})

const lowUsage = () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } })

// ======================== v0.16.1 / v0.16.2: 后台子代理 (一次提问里主线程结束好几段) ========================
// Claude Code 2.1.289 默认把 Agent 子代理放到后台. 子代理结束后, 它的结果作为一次 prompt.submit 送回主线程
// (origin.kind = 'task-notification'): 主线程闲着时另起一段, 正在跑时塞进这一段 (带 turnId).
// 一次提问 = 从用户自己发消息 (composer) 起; 做完 = 最后一段结束、没有子代理在跑、等约 2 秒没有新的一段
// v0.17.3: 散步道删了, 庆祝 (一次提问做完) 从 debug 日志的 "防抖触发: 搞定 N" 数; 所以默认开着 USAGE_HUD_DEBUG
const DBG: Sys = { ...WIN, env: { ...WIN.env, USAGE_HUD_DEBUG: '1' } }
async function bgSetup($: any, on: any, sys: Sys = DBG) {
  const T = 1_900_000_000_000
  let list: any[] = []
  let usd = 1
  const calls = await start($, on, sys, { mockClock: T, agents: () => list, usage: () => ({ ...lowUsage(), cost: { usd } }) })
  const clock = calls.clock
  // 面板照样挂着 (渲染路径里会同步子代理); celebSeq = 庆祝了几次, last = 最近一次的 N
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'PromptHint', requestId: 'hint-bg', viewport: { columns: 120, rows: 40, isFullscreen: true }, props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as any)
  const props = async () => {
    const hits = calls.logs
      .filter((l: any) => l.to === 'debug')
      .map((l: any) => /防抖触发: 搞定 (\S+)/.exec(String(l.text)))
      .filter(Boolean) as RegExpExecArray[]
    return { celebSeq: hits.length, last: hits.length ? hits[hits.length - 1][1] : '' }
  }
  const kid = (id: string, status = 'running') => ({ id, description: id, type: 'general-purpose', status })
  const ids = new Set<string>()
  const setStatus = () => (list = [...ids].map(id => kid(id, ended.has(id) ? 'completed' : 'running')))
  const ended = new Set<string>()
  return {
    calls,
    clock,
    band,
    props,
    setList: (l: any[]) => (list = l),
    spend: (d: number) => (usd += d),
    // 用户自己回车 / 后台子代理的结果送回来 (闲着时 or 塞进正在跑的一段)
    userSays: (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any),
    notice: (intoTurn?: string) => $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' }, ...(intoTurn ? { turnId: intoTurn } : {}) } as any),
    // 主线程派一个后台子代理: Agent 工具马上返回 ("Backgrounded agent"), 子代理接着在后台跑
    spawn: async (id: string) => {
      await $.tool.call({ tool: 'Agent', description: id, prompt: id, run_in_background: true } as any)
      ids.add(id)
      setStatus()
      await $.classic.SubagentStart({ agent_id: id, agent_type: 'general-purpose' } as any)
    },
    finish: async (id: string) => {
      ended.add(id)
      setStatus()
      await $.classic.SubagentStop({ agent_id: id, agent_type: 'general-purpose', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: 'ok' } as any)
    },
  }
}
const done = (turnId: string, durationMs: number) => ({ answer: '', durationMs, isAborted: false, turnId, reason: 'answer' }) as any
const rowText = async ($: any, id: string, durationMs: number) => {
  const r = await mountTurn($, id, durationMs)
  const texts = (await r.findAll({ type: 'Text' })).map((x: any) => x.text)
  await r.unmount()
  return texts.find((t: string) => t.startsWith(' · ')) ?? ''
}

test('实测 1 的顺序: 主线程停下等 2 个子代理, 每结束一个送一次结果 -> 只庆祝一次, N = 整次提问; 最后一行配合计; 送结果不让螃蟹跳', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('读 a.txt 和 b.txt')
  await $.turn.start({ text: '读 a.txt 和 b.txt', turnId: 't1' } as any)
  await b.spawn('k1')
  await b.spawn('k2')
  b.spend(0.17)
  await b.clock.advance(13_000)
  await $.turn.complete(done('t1', 13_000)) // "Waiting for 2 background agents to finish"
  expect(await rowText($, 'row-1', 13_000)).toBe(' · $0.17 · 工具 2 次') // 这一段
  await b.clock.advance(2_000)
  await b.finish('k1')
  await b.notice() // k1 的结果送回来 (主线程闲着: 另起一段)
  await $.turn.start({ text: '<task-notification>', turnId: 't2' } as any)
  b.spend(0.01)
  await b.clock.advance(1_000)
  await $.turn.complete(done('t2', 1_000)) // "Worked for 1s"
  expect(await rowText($, 'row-2', 1_000)).toBe(' · $0.01')
  await b.clock.advance(3_000)
  await b.finish('k2') // 最后一个子代理结束, 它的结果还没送到: 不能先庆祝 (等待放宽到约 10 秒)
  await b.clock.advance(3_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.notice()
  await $.turn.start({ text: '<task-notification>', turnId: 't3' } as any)
  await $.tool.call({ tool: 'Write', file_path: CWD + '/summary.md', content: ['1', '2', '3', ''].join(String.fromCharCode(10)) } as any)
  b.spend(0.06)
  await b.clock.advance(5_000)
  await $.turn.complete(done('t3', 5_000))
  // 最后一行: 引擎写整次提问的时长 13+2+1+3+3+5 = 27 秒 -> 整次提问的合计
  expect(await rowText($, 'row-3', 27_000)).toBe(' · $0.24 · 改 1 个文件 +3 -0 · 工具 3 次')
  // 防抖: 刚结束时还不庆祝, 约 2 秒后庆祝一次
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.last).toBe('27s')
  // 状态格: 先亮 5 秒绿色的 "✓ 搞定 27s", 之后变回暗色的 "✓ 上一轮 27s，3 次工具"
  const hint = await mountHint($, 'terminal', 140)
  const done1: any = (await hint.findAll({ type: 'Text' })).find((x: any) => x.text.includes('搞定 27s'))
  expect(done1?.props.color).toBe('#4ade80')
  await b.clock.advance(5_100)
  expect((await hint.findAll({ type: 'Text' })).some((x: any) => x.text.includes('上一轮 27s，3 次工具'))).toBe(true)
  expect((await hint.findAll({ type: 'Text' })).some((x: any) => x.text.includes('搞定'))).toBe(false)
  await hint.unmount()
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('实测 2 的顺序: 主线程不停、先后派 4 个子代理, 最后一个结束时主线程刚好结束一段, 随后来了结果 -> 只庆祝一次, N = 34s; 两行收据各配各的; 迟到的通知不再庆祝', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('把四个文件都读一遍')
  await $.turn.start({ text: '把四个文件都读一遍', turnId: 'm1' } as any)
  await b.spawn('a1')
  await b.spawn('b1')
  await b.clock.advance(5_000)
  await b.finish('a1')
  await b.finish('b1')
  await b.notice('m1') // 结果塞进正在跑的这一段
  await b.notice('m1')
  await b.spawn('a2')
  await b.spawn('b2')
  await b.clock.advance(10_000)
  await b.finish('a2')
  await b.notice('m1')
  b.spend(0.2)
  await b.clock.advance(15_000)
  await b.finish('b2') // 最后一个子代理和这一段同时结束
  await $.turn.complete(done('m1', 30_000)) // "Churned for 30s"
  expect(await rowText($, 'row-30s', 30_000)).toBe(' · $0.20 · 工具 4 次')
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // 0.16.1 在这里提前庆祝了 "搞定 31s"
  await b.notice() // b2 的结果送回来, 主线程又跑一段
  await $.turn.start({ text: '<task-notification>', turnId: 'm2' } as any)
  b.spend(0.01)
  await b.clock.advance(3_000)
  await $.turn.complete(done('m2', 3_000)) // "Churned for 34s"
  expect(await rowText($, 'row-34s', 34_000)).toBe(' · $0.21 · 工具 4 次') // 合计
  await b.clock.advance(2_100)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.last).toBe('34s')
  // 庆祝之后又来了迟到的通知: 接着记账, 不再庆祝
  await b.notice()
  await $.turn.start({ text: '<task-notification>', turnId: 'm3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('m3', 1_000))
  await b.clock.advance(12_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('子代理跑完之前用户又发了新消息 -> 上一次提问作废; 旧子代理的结果后来送到算新提问的接续; 只庆祝一次, N 从新消息算起', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('第一个问题')
  await $.turn.start({ text: '第一个问题', turnId: 'q1' } as any)
  await b.spawn('k1')
  await b.clock.advance(10_000)
  await $.turn.complete(done('q1', 10_000))
  await b.clock.advance(5_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.userSays('第二个问题') // 子代理还在跑, 用户发了新消息: 第一个问题作废
  await $.turn.start({ text: '第二个问题', turnId: 'q2' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('q2', 2_000))
  await b.clock.advance(3_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // k1 还在跑: 先不庆祝
  await b.finish('k1')
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // k1 的结果还没送到
  await b.notice() // 主线程闲着: 结果另起一段, 算第二个问题的接续, 不是新提问
  await $.turn.start({ text: '<task-notification>', turnId: 'q3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('q3', 1_000))
  await b.clock.advance(2_100)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1) // 只庆祝一次
  expect(p.last).toBe('7s') // 从第二个问题算到最后一段结束 (2 + 3 + 1 + 1), 不是从第一个问题算起的 22 秒
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('子代理的结果塞进正在跑的一段 (带 turnId): 这一段结束后约 2 秒庆祝 (欠的通知已到, 不等 10 秒); N = 整次提问; 送结果不跳', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('查一下 c.txt')
  await $.turn.start({ text: '查一下 c.txt', turnId: 'm1' } as any)
  await b.spawn('k1')
  await b.clock.advance(4_000)
  await b.finish('k1')
  const p1 = await b.props()
  await b.notice('m1') // 主线程还在跑: 结果直接塞进这一段, 不会另起一段
  await b.clock.advance(2_000)
  await $.turn.complete(done('m1', 6_000))
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.last).toBe('6s')
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('没有子代理的普通提问: 结束后约 2 秒庆祝一次; 结束前再说一句会取消这次等待 (说的是新提问, 从新的算)', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('你好')
  await $.turn.start({ text: '你好', turnId: 'n1' } as any)
  b.spend(0.02)
  await b.clock.advance(3_000)
  await $.turn.complete(done('n1', 3_000))
  expect(await rowText($, 'row-n1', 3_000)).toBe(' · $0.02')
  await b.clock.advance(1_500)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(700)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  expect((await b.props()).last).toBe('3s')
  // 第二个问题: 结束后 1 秒内用户又说了一句 -> 第二个问题不庆祝, 第三个做完才庆祝
  await b.userSays('再来')
  await $.turn.start({ text: '再来', turnId: 'n2' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('n2', 2_000))
  await b.clock.advance(1_000)
  await b.userSays('还有')
  await $.turn.start({ text: '还有', turnId: 'n3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('n3', 1_000))
  await b.clock.advance(2_100)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 2)
  expect((await b.props()).last).toBe('1s')
  await b.band.unmount()
})

// v0.16.2: token 只算主线程和认得的子代理; 引擎自己的分叉 (压缩 / 记忆) 带的 id 谁的列表里都没有, 不算
test('token: 主线程 + 认得的子代理才算, 先到的子代理用量等认出来再补上, 认不出的分叉不算', async ($, on) => {
  const IN: Record<string, number> = { '': 100, 'fork-x': 200, k1: 40 }
  on('turn.step', async function* ($: any, e: any) {
    const n = IN[String(e.agentId ?? '')] ?? 0
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: n, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }
  } as any)
  // 统计脚本跑不起来: 底数为 0, 面板只显示本次启动以来的实时累计, 数字小到能逐个核对
  const calls = await start($, on, { ...WIN, broken: ['node'] }, { agents: () => [] })
  const step = async (agentId?: string) => {
    const it: any = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
    while (!(await it.next()).done) {}
  }
  const detail = async () => {
    const ui = await mountHint($, 'terminal', 140)
    calls.toasts.length = 0
    await ui.press({ key: 'btn-token' })
    await ui.unmount()
    return calls.toasts.find(x => x.includes('token：')) ?? '(没有明细)'
  }
  await step() // 主线程 100
  await step('k1') // 子代理还没登记: 先记着
  await step('fork-x') // 引擎自己的分叉: 一直认不出来
  expect(await detail()).toContain('新输入 100，输出 1')
  await $.classic.SubagentStart({ agent_id: 'k1', agent_type: 'general-purpose' } as any)
  expect(await detail()).toContain('新输入 140，输出 2')
  await step('k1') // 认出来以后直接算
  expect(await detail()).toContain('新输入 180，输出 3')
})

// ======================== v0.16.3 / v0.16.4: 第三、四次实测的问题 ========================
// 引擎节点 ({ type: 'engine' }) 的祖先 Box 上不能有的属性 (claude.exe 2.1.289 的校验: D2t + D6r + eQe):
//   带了引擎就拒绝整棵树 ("engine node under a Box with prop ..."), 自己画, 收据全没了 (第四次实测)
const ENGINE_BANNED = ['width', 'height', 'minWidth', 'minHeight', 'display', 'overflow', 'position', 'top', 'left', 'right', 'bottom']
// 从根往下找引擎节点: 返回一路上每个祖先的 [type, 被禁的属性]; 没找到引擎节点返回 undefined
function engineChain(node: any, up: Array<[string, string[]]> = []): Array<[string, string[]]> | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (node.type === 'engine') return up
  const here: [string, string[]] = [String(node.type), Object.keys(node.props ?? {}).filter(k => ENGINE_BANNED.includes(k))]
  for (const c of node.children ?? []) {
    const r = engineChain(c, [...up, here])
    if (r) return r
  }
  return undefined
}
// 画出引擎那一行, 看排法: 引擎节点在不在、祖先上有没有被禁的属性、收据 Box 缩不缩 / 定不定宽、收据的字
async function rowLayout($: any, id: string, durationMs: number, cols = 140) {
  const r = await mountTurn($, id, durationMs, cols)
  const tree: any = await r.drawn()
  const chain = engineChain(tree)
  const box: any = await r.find({ type: 'Box', key: 'receipt-box' })
  const text = ((await r.findAll({ type: 'Text' })) as any[]).map(x => x.text).find(t => t.startsWith(' · ')) ?? ''
  await r.unmount()
  return {
    engine: chain ? 'ok' : '没有引擎节点',
    banned: (chain ?? []).flatMap(([, b]) => b),
    shrink: box ? box.props.flexShrink : 'no-box',
    width: box ? (box.props.width ?? 'none') : 'no-box',
    text,
  }
}

// 问题: 后台子代理的结果在主线程闲着时送回来, 引擎从队列里取出来直接另起一段: 不经过 prompt.submit
//   (会话记录里是 queue-operation dequeue; 0.16.0 的录像里这两次都没跳, 0.16.0 是每次 prompt.submit 都跳).
//   所以这里不调 b.notice(), 直接 turn.start. 时间线照第三、四次实测的会话记录取整 (从用户回车算起):
//   11-12s 派 2 个子代理, 14s 第一段结束 ("Waiting for 2 background agents"), 15s k1 结束、结果另起一段,
//   16s k2 结束 (第二段还在跑), 17s 第二段结束、k2 的结果马上另起第三段, 写文件, 24s 第三段结束 ("Cooked for 24s")
test('实测 3 的顺序: 闲着时送回的结果不经过 prompt.submit、直接另起一段 -> 最后一段结束后约 2 秒庆祝 (不是 10 秒), N = 24s; 只有用户回车跳; 三行收据都在', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  const rows: any[] = [] // 每段结束那行的排法 (最后再比, 先看庆祝的时间)
  await b.userSays('按顺序做: Glob、读 notes.txt、派 2 个子代理、写 summary.md')
  await $.turn.start({ text: '按顺序做', turnId: 'v1' } as any)
  await $.tool.call({ tool: 'Glob', pattern: '*.txt' } as any)
  await $.tool.call({ tool: 'Read', file_path: CWD + '/notes.txt' } as any)
  await b.clock.advance(11_000)
  await b.spawn('k1')
  await b.clock.advance(1_000)
  await b.spawn('k2')
  await b.clock.advance(2_000)
  await $.turn.complete(done('v1', 14_000))
  rows.push(await rowLayout($, 'row-v1', 14_000))
  await b.clock.advance(1_000)
  await b.finish('k1')
  await $.turn.start({ text: '<task-notification>', turnId: 'v2' } as any) // 没有 prompt.submit
  await b.clock.advance(1_000)
  await b.finish('k2') // 第二段还在跑时 k2 结束, 它的结果排在队列里
  b.spend(0.01)
  await b.clock.advance(1_000)
  await $.turn.complete(done('v2', 2_000))
  rows.push(await rowLayout($, 'row-v2', 2_000))
  await $.turn.start({ text: '<task-notification>', turnId: 'v3' } as any) // 队列里的结果马上另起一段, 也没有 prompt.submit
  await b.clock.advance(4_000)
  await $.tool.call({ tool: 'Write', file_path: CWD + '/summary.md', content: 'x' } as any)
  await b.clock.advance(3_000)
  await $.turn.complete(done('v3', 7_000))
  rows.push(await rowLayout($, 'row-v3', 24_000))
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1) // 2 秒的防抖, 不是 10 秒的上限
  expect(p.last).toBe('24s')
  const ok = (text: string) => ({ engine: 'ok', banned: [], shrink: 0, width: 'none', text })
  expect(rows).toEqual([ok(' · 工具 4 次'), ok(' · $0.01'), ok(' · $0.01 · 改 1 个文件 +1 -0 · 工具 5 次')])
  await b.band.unmount()
})

test('庆祝过以后引擎又接着跑了一段 (迟到的结果, 前面没有 prompt.submit): 只记账, 不再庆祝; 用户再发消息才是新提问', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('你好')
  await $.turn.start({ text: '你好', turnId: 'u1' } as any)
  await b.clock.advance(3_000)
  await $.turn.complete(done('u1', 3_000))
  await b.clock.advance(2_200)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.clock.advance(3_000)
  await $.turn.start({ text: '<task-notification>', turnId: 'u2' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('u2', 1_000))
  await b.clock.advance(12_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1) // 没有第二次庆祝
  await b.userSays('再来')
  await $.turn.start({ text: '再来', turnId: 'u3' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('u3', 2_000))
  await b.clock.advance(2_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 2)
  expect(p.last).toBe('2s')
  await b.band.unmount()
})

// v0.16.4 问题 2: 连续三次实测「搞定」都等满 10 秒, 0.16.3 的 "记一次送到" 也没起作用 -> 改成纯防抖, 只看 $.agent.list().
//   这一条模拟一种 "记账" 对不上的情况: 一个 agent.list 里没有的 id (比如引擎自己的分叉) 只来了一次 SubagentStop.
//   0.16.3 把它记成 "欠一次通知", 最后一段结束后要等满 10 秒; 纯防抖不受影响
test('纯防抖: 列表里没有的子代理 (引擎自己的分叉) 只来一次 SubagentStop, 不影响; 最后一段结束后约 2 秒庆祝', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('派两个子代理')
  await $.turn.start({ text: '派两个子代理', turnId: 'x1' } as any)
  await b.spawn('k1')
  await b.spawn('k2')
  await b.clock.advance(3_000)
  await $.turn.complete(done('x1', 3_000))
  await $.classic.SubagentStop({ agent_id: 'fork-x', agent_type: '', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: '' } as any)
  await b.clock.advance(3_000)
  await b.finish('k1')
  await $.turn.start({ text: '<task-notification>', turnId: 'x2' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('x2', 1_000))
  await b.clock.advance(3_000)
  await b.finish('k2')
  await $.turn.start({ text: '<task-notification>', turnId: 'x3' } as any)
  await b.clock.advance(3_000)
  await $.turn.complete(done('x3', 3_000))
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  expect((await b.props()).last).toBe('13s')
  await b.band.unmount()
})

test('纯防抖: 一段结束前 2 秒内有子代理刚结束 -> 多等 2 秒 (只延一次); 等的时候来了 turn.start / prompt.submit 就取消', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  // 第一次: k1 结束 1 秒后主线程这一段结束, 结果一直没来 (比如前台子代理, 结果随工具返回) -> 等 4 秒
  await b.userSays('一')
  await $.turn.start({ text: '一', turnId: 'y1' } as any)
  await b.spawn('k1')
  await b.clock.advance(2_000)
  await b.finish('k1')
  await b.clock.advance(1_000)
  await $.turn.complete(done('y1', 3_000))
  await b.clock.advance(2_200)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // 2 秒时还不庆祝
  await b.clock.advance(2_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1) // 4 秒时庆祝 (只延一次, 不是 10 秒)
  expect((await b.props()).last).toBe('3s')
  // 第二次: 等的时候结果另起一段 (turn.start) -> 取消, 这一段结束后再等 2 秒
  await b.userSays('二')
  await $.turn.start({ text: '二', turnId: 'y2' } as any)
  await b.spawn('k2')
  await b.clock.advance(1_000)
  await b.finish('k2')
  await b.clock.advance(1_000)
  await $.turn.complete(done('y2', 2_000))
  await b.clock.advance(3_000)
  await $.turn.start({ text: '<task-notification>', turnId: 'y3' } as any)
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1) // 4 秒到了也不庆祝: 等待已经取消
  await $.turn.complete(done('y3', 1_000))
  await b.clock.advance(2_200)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 2)
  expect((await b.props()).last).toBe('6s')
  // 第三次: 等的时候来了 prompt.submit (塞进来的结果, 带 turnId 也算) -> 取消
  await b.userSays('三')
  await $.turn.start({ text: '三', turnId: 'y4' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('y4', 1_000))
  await b.clock.advance(1_500)
  await b.notice()
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 2) // 2 秒到了也不庆祝
  await $.turn.start({ text: '<task-notification>', turnId: 'y5' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('y5', 1_000))
  await b.clock.advance(2_200)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 3)
  await b.band.unmount()
})

test('纯防抖: 只看 $.agent.list(): 列表里还有在跑的子代理 (没有 SubagentStart / Stop 事件) 就不开始等; 列表里都结束了才等, 不等 10 秒', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('后台跑一个')
  await $.turn.start({ text: '后台跑一个', turnId: 'z1' } as any)
  b.setList([{ id: 'bg1', description: 'bg1', type: 'general-purpose', status: 'running' }])
  await b.clock.advance(2_000)
  await $.turn.complete(done('z1', 2_000))
  await b.clock.advance(8_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // 列表里还在跑: 不庆祝
  b.setList([{ id: 'bg1', description: 'bg1', type: 'general-purpose', status: 'completed' }])
  await b.clock.advance(1_200) // 主线程闲着时约每秒看一次列表
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // 刚结束: 等 2 + 2 秒
  await b.clock.advance(4_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

async function debugRun($: any, on: any, env: Record<string, string>) {
  const b = await bgSetup($, on, { ...WIN, env: { ...WIN.env, ...env } })
  await b.userSays('一')
  await $.turn.start({ text: '一', turnId: 'd1' } as any)
  await b.spawn('k1')
  await b.clock.advance(1_000)
  await $.turn.complete(done('d1', 1_000))
  await b.clock.advance(1_000)
  await b.finish('k1')
  await b.clock.advance(1_000)
  await $.turn.start({ text: '<task-notification>', turnId: 'd2' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('d2', 1_000))
  await b.clock.advance(2_200)
  // 不开调试时日志里看不到, 看面板状态格: 一轮做完先亮 "✓ 搞定 4s"
  const celebrated = (await strings(b.band)).find(t => t.includes('搞定'))
  await b.band.unmount()
  return { celebrated, lines: b.calls.logs.filter((l: any) => l.to === 'debug').map((l: any) => String(l.text)) }
}
test('调试开关: 不设 USAGE_HUD_DEBUG 时 debug 日志一行不写 (照样庆祝)', { timeoutMs: 30_000 }, async ($, on) => {
  const { celebrated, lines } = await debugRun($, on, {})
  expect(celebrated).toContain('搞定 4s')
  expect(lines).toEqual([])
})
test('调试开关: USAGE_HUD_DEBUG=1 时把提问 / 每段 / 子代理 / prompt.submit / 防抖的开始、取消、触发带时间写进 debug 日志', { timeoutMs: 30_000 }, async ($, on) => {
  const { lines } = await debugRun($, on, { USAGE_HUD_DEBUG: '1' })
  expect(lines.length > 0).toBe(true)
  for (const l of lines) expect(/^\[usage-hud\] \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /.test(l) ? 'ok' : '没有时间戳: ' + l).toBe('ok')
  const want = ['prompt.submit origin=composer', '提问开始', '一段开始 d1', '子代理开始 k1', '一段结束 d1', '子代理结束 k1', '防抖开始', '防抖取消 (turn.start)', '一段开始 d2', '一段结束 d2', '防抖开始 等 2000ms', '防抖触发: 搞定 4s']
  let at = 0
  const order: string[] = []
  for (const w of want) {
    const i = lines.findIndex((l, j) => j >= at && l.includes(w))
    order.push(i >= 0 ? w : '缺: ' + w)
    if (i >= 0) at = i + 1
  }
  expect(order).toEqual(want)
})

// 问题 2 (v0.16.2 / v0.16.3): 引擎那行 (TurnDuration) 的外层是 width 100% (2.1.289 的 TurnDurationMessage 源码:
//   Box column 100% > Box row 100% > [符号 minWidth 2, Text]). 和收据直接并排, 两边按 "基准宽 x 收缩" 一起挤:
//   收据宽 = 140 x R / (140 + R): R = 40 -> 31 格, R = 20 -> 17 格 (都含开头的空格), 和第三次实测录像一格不差.
// v0.16.4: 0.16.3 给引擎那行套了定宽 Box, 被引擎拒绝 (祖先 Box 不能带 width). 现在引擎那行不包, 收据放在旁边
//   一个 flexShrink 0 的 Box 里靠右; 挑一种写法保证 "引擎那行字的宽 + 收据宽 <= 列数"
test('收据怎么写: 引擎那行字的宽 + 收据宽 <= 列数; 整行放得下全写, 放不下先省「改 N 个文件」, 再放不下给收据 Box 定宽截短', async ($, on) => {
  // 引擎写时长的办法
  expect([3_000, 24_400, 546_000, 3_723_000].map(ms => reg.engineDur?.(ms))).toEqual(['3s', '24s', '9m 6s', '1h 2m 3s'])
  // 引擎那行的宽度: 和录像里的两行一样长; 可能是 Waiting 那行时取两种里宽的
  expect(reg.engineRowWidth?.('Cooked', 24_000, 0, 7)).toBe('✻ Cooked for 24s · done 8:13 PM'.length)
  expect(reg.engineRowWidth?.('Cooked', 24_000, 2, 7)).toBe('✻ Waiting for 2 background agents to finish'.length)
  expect(reg.engineRowWidth?.('Cooked', 24_000, 1, 7)).toBe('✻ Waiting for 1 background agent to finish'.length)
  expect(reg.engineRowWidth?.('Crunched', 3_723_000, 1, 8)).toBe('✻ Waiting for 1 background agent to finish'.length) // 39 < 42: 按 Waiting 那句
  expect(reg.engineRowWidth?.('Philosophising', 3_723_000, 1, 8)).toBe('✻ Philosophising for 1h 2m 3s · done 12:06 AM'.length) // 45 > 42: 按引擎那句
  const r = { turnId: 'x', startedAt: 0, completedAt: 0, durationMs: 24_000, usd: 0.15, files: 1, add: 7, del: 0, tools: 5 }
  const full = ' · $0.15 · 改 1 个文件 +7 -0 · 工具 5 次' // 40 格
  const short = ' · $0.15 · 工具 5 次' // 20 格
  const fit = (cols: number, x: any = r) => reg.receiptFit?.(x, 'Cooked', 24_000, cols, 7)
  expect(fit(140)).toEqual({ engineW: 31, text: full })
  expect(fit(71)).toEqual({ engineW: 31, text: full }) // 31 + 40 = 71: 正好放得下
  expect(fit(70)).toEqual({ engineW: 31, text: short }) // 差 1 格: 先省改文件
  expect(fit(51)).toEqual({ engineW: 31, text: short }) // 31 + 20 = 51
  expect(fit(50)).toEqual({ engineW: 31, text: short, width: 19 }) // 再窄: 收据 Box 定宽 19, 让 Text 截
  expect(fit(34)).toBe(undefined) // 剩不到 4 格: 不放
  expect(fit(140, { ...r, pending: 2 })?.engineW).toBe(43) // 可能是 Waiting 那行: 按长的算
})

test('收据 (接上真的 hooks, 引擎那行是引擎节点): 祖先链上没有任何被禁的属性 (不会被引擎拒绝); 收据 Box flexShrink 0, 放得下时全文; 窄了先省改文件, 再窄才定宽截短', async ($, on) => {
  const T = 1_900_000_300_000
  let usd = 1
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => ({ ...lowUsage(), cost: { usd } }) })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as any)
  await $.turn.start({ text: 'hi', turnId: 'w1' } as any)
  await $.tool.call({ tool: 'Write', file_path: CWD + '/a.md', content: ['1', '2', '3', ''].join(String.fromCharCode(10)) } as any)
  await $.tool.call({ tool: 'Read', file_path: CWD + '/a.md' } as any)
  usd += 0.42
  await clock.advance(9_000)
  await $.turn.complete(done('w1', 9_000))
  const full = ' · $0.42 · 改 1 个文件 +3 -0 · 工具 2 次'
  const ew = reg.engineRowWidth?.('Baked', 9_000, 0, reg.clockWidth?.(T + 9_000)) ?? 0
  expect(await rowLayout($, 'msg-w1', 9_000)).toEqual({ engine: 'ok', banned: [], shrink: 0, width: 'none', text: full })
  // 同一行在窄一点的终端里重画: 先省改文件, 再窄才给收据 Box (不是引擎那行的祖先) 定宽
  expect(await rowLayout($, 'msg-w1', 9_000, ew + 39)).toEqual({ engine: 'ok', banned: [], shrink: 0, width: 'none', text: ' · $0.42 · 工具 2 次' })
  expect(await rowLayout($, 'msg-w1', 9_000, ew + 10)).toEqual({ engine: 'ok', banned: [], shrink: 0, width: 10, text: ' · $0.42 · 工具 2 次' })
})

// 问题 3: 工具只跑几十毫秒 (第三次实测: Glob 104ms, Read 66ms), 工具开始和结束都落在散步道两帧 (150ms) 之间.
//   v0.16.3 按序号认, 但要等下一帧才画 (第四次实测: 先闪 36ms, 空一帧, 再画, 合计约 507ms).
//   v0.16.4: props 一到就画, 从那一刻起画到之后第 4 帧 (>= 600ms)
test('没有 5 小时限制: 三档都不画 5小时; 完整版第 2 行 上下文/本周/重置, 中等版右列是 上下文/本周/本会话; 客户端也不画', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let weekOnly: any = { ...USAGE, rateLimits: [lim('seven_day', 43, t + 2 * 24 * H)] }
  await start($, on, WIN, { usage: () => weekOnly, now: () => t })
  // 完整版: 第 2 行 = 上下文 | 本周 | 重置; 三格和别的行一样宽, 本周的条和 5小时 那时的条一样长
  for (const cols of [81, 100, 123, 183]) {
    const ui = await mountHint($, 'terminal', cols)
    const all = await strings(ui)
    expect(all.some(s => s.includes('5小时')) ? cols + ' 列还有 5小时' : 'ok').toBe('ok')
    const boxes = await ui.findAll({ type: 'Box' })
    const grid = boxes.filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    expect(grid.map((b: any) => b.key).sort()).toEqual(['r1c0', 'r1c1', 'r1c2', 'r2c0', 'r2c1', 'r2c2', 'r3c0', 'r3c1', 'r3c2'])
    expect(new Set(grid.map((b: any) => b.props.width)).size).toBe(1)
    const wk = meterIn(boxes, 'wk')
    expect(wk.box).toBe('r2c1')
    expect(wk.used === wk.boxW ? 'ok' : `${cols} 列 本周: 内容 ${wk.used} != 列宽 ${wk.boxW}`).toBe('ok')
    expect(/^4\d%$/.test(wk.pct?.text ?? '') ? 'ok' : 'pct ' + wk.pct?.text).toBe('ok') // 百分比有滚动过渡
    expect(wk.cells.filter((c: any) => c.text === '│').length).toBe(1)
    // 重置那格: 标签是按钮 (点了跑 /usage), 值是 "周X 时:分" / "明天 时:分"
    const rs: any = grid.find((b: any) => b.key === 'r2c2')
    const rsText = (rs?.children ?? []).map((c: any) => (c?.type === 'Button' ? String(c.props?.label) : textOf(c))).join('')
    expect(/^重置\s+(今天|明天|周[日一二三四五六]) \d\d:\d\d/.test(rsText) ? 'ok' : `${cols} 列 重置格: "${rsText}"`).toBe('ok')
    await ui.unmount()
  }
  // 中等版: 右列 上下文 / 本周 / 本会话
  for (const cols of [51, 65, 80]) {
    const ui = await mountHint($, 'terminal', cols)
    const boxes = await ui.findAll({ type: 'Box' })
    expect([meterIn(boxes, 'ctx').box, meterIn(boxes, 'wk').box]).toEqual(['r1c1', 'r2c1'])
    const all = await strings(ui)
    expect(all.some(s => s.includes('5小时'))).toBe(false)
    expect(all.some(s => s.includes('本会话'))).toBe(true)
    await ui.unmount()
  }
  // 精简版: 没有 5小时 那段
  const c = await mountHint($, 'terminal', 45)
  const cb = await c.findAll({ type: 'Box' })
  expect(cb.some((b: any) => b.key === 'seg-h5')).toBe(false)
  expect(cb.some((b: any) => b.key === 'seg-ctx')).toBe(true)
  await c.unmount()
  // 判定记进 store: 重开会话、还没有回复时也按没有 5 小时画
  weekOnly = { ...USAGE, rateLimits: [] }
  await $.session.start({ cwd: CWD } as any)
  const again = await mountHint($, 'terminal', 123)
  expect((await strings(again)).some(s => s.includes('5小时'))).toBe(false)
  await again.unmount()
  // 客户端仪表盘: 没有 5小时
  const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, week: { pct: 43, extra: '2d0h', tick: 0.7 }, status: { text: 'x', tone: 'idle' }, tools: '', tokenTotal: '1', tokenOutput: '' }, { width: 700 })
  expect(svg.includes('5小时')).toBe(false)
  expect(svg.includes('本周')).toBe(true)
  const svg2 = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, week: { pct: 43, extra: '2d0h', tick: 0.7 }, reset: { when: '周六 05:00', pace: '配速 0.8x', tone: 'dim' }, status: { text: 'x', tone: 'idle' }, tools: '', tokenTotal: '1', tokenOutput: '' }, { width: 700 })
  expect(svg2.includes('重置') && svg2.includes('周六 05:00') && svg2.includes('配速 0.8x')).toBe(true)
})

test('重置时刻的写法: 今天 / 明天 / 周几 + 时:分 (本地时间)', () => {
  const now = new Date(2026, 10, 6, 21, 30).getTime() // 周五
  expect(whenAt(new Date(2026, 10, 6, 23, 5).getTime(), now)).toBe('今天 23:05')
  expect(whenAt(new Date(2026, 10, 7, 5, 0).getTime(), now)).toBe('明天 05:00')
  expect(whenAt(new Date(2026, 10, 8, 5, 0).getTime(), now)).toBe('周日 05:00')
})

test('没有 5 小时的判定: 上次记下的在第一次回复前就生效; five_hour 再出现就恢复三格', async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE, rateLimits: [] }
  const store: Record<string, unknown> = { noFive: true }
  await start($, on, WIN, { usage: () => usage, now: () => t, store })
  let ui = await mountHint($, 'terminal', 123)
  expect((await strings(ui)).some(s => s.includes('5小时'))).toBe(false)
  await ui.unmount()
  usage = { ...USAGE }
  ui = await mountHint($, 'terminal', 123)
  expect((await strings(ui)).some(s => s.includes('5小时'))).toBe(true)
  expect(meterIn(await ui.findAll({ type: 'Box' }), 'wk').box).toBe('r2c2')
  await ui.unmount()
  // 没有任何读数、记录已改回 "有 5 小时" (重开会话也是): 照旧画 5小时 (显示 --)
  usage = { ...USAGE, rateLimits: [] }
  await $.session.start({ cwd: CWD } as any)
  ui = await mountHint($, 'terminal', 123)
  expect((await strings(ui)).some(s => s.includes('5小时'))).toBe(true)
  await ui.unmount()
})

// v0.17.3: 螃蟹回到面板左边 (v0.15 及以前的排法), 散步道删掉了
test('默认: 螃蟹在面板左边 (15x3 像素画, 有道具); 完整版 96 列起, 中等版 66-95, 精简版不到 66 换 1 行小螃蟹; /hud crab off 不画, 网格占满整行', async ($, on) => {
  await start($, on, WIN, { store: { crab: true } })
  for (const [cols, nCells] of [
    [140, 9],
    [98, 9],
    [97, 6],
    [80, 6],
    [68, 6],
  ] as Array<[number, number]>) {
    const ui = await mountHint($, 'terminal', cols)
    const r: any = await ui.find({ type: 'Raster' })
    expect([r?.key, r?.props.columns, r?.props.rows]).toEqual(['crab', 15, 3])
    const grid = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    expect(grid.length === nCells ? 'ok' : `${cols} 列: ${grid.length} 格`).toBe('ok')
    await ui.unmount()
  }
  const c = await mountHint($, 'terminal', 60)
  const mini: any = await c.find({ type: 'Raster' })
  expect([mini?.key, mini?.props.columns, mini?.props.rows]).toEqual(['crab-mini', 8, 1])
  expect((await c.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-crab')).toBe(true)
  await c.unmount()
  // /hud crab off: 面板里没有螃蟹, 97 列就是完整版 (各档分界前移 17 列); 再开回来, 重开会话也记得
  await $.command.run({ command: 'hud', args: 'crab off' } as any)
  await $.session.start({ cwd: CWD } as any)
  let ui = await mountHint($, 'terminal', 97)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? '')).length).toBe(9)
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'crab on' } as any)
  ui = await mountHint($, 'terminal', 97)
  expect(((await ui.find({ type: 'Raster' })) as any)?.key).toBe('crab')
  await ui.unmount()
})

// ======================== v0.17.4: 散步道的功能搬回面板 ========================
// 面板螃蟹那张 Raster -> 每格上下两个像素 (颜色; -1 = 空)
function rasterPx(r: any): number[][] {
  const w = new Uint32Array(Uint8Array.from(atob(r.props.cells), c => c.charCodeAt(0)).buffer)
  const cols = r.props.columns
  const px = Array.from({ length: r.props.rows * 2 }, () => new Array(cols).fill(-1))
  for (let rr = 0; rr < r.props.rows; rr++) {
    for (let c = 0; c < cols; c++) {
      const i = (rr * cols + c) * 3
      if (w[i] === 0x2580) {
        px[rr * 2][c] = w[i + 1]
        if (w[i + 2] !== DEF) px[rr * 2 + 1][c] = w[i + 2]
      } else if (w[i] === 0x2584) px[rr * 2 + 1][c] = w[i + 1]
    }
  }
  return px
}
// 挂一次面板, 取螃蟹的像素和状态格的文字, 再卸掉
async function panelNow($: any, working = false) {
  const ui = await mountHint($, 'terminal', 140, working)
  const r: any = await ui.find({ type: 'Raster', key: 'crab' })
  const texts = (await ui.findAll({ type: 'Text' })) as any[]
  await ui.unmount()
  return { px: r ? rasterPx(r) : [], texts }
}
const lumOf = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)

test('睡着时一打字马上醒; 发出消息跳一下 (腾空时不画腿), 后台结果送回不跳', async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, store: { crab: true }, usage: lowUsage, agents: () => [] })
  // 5 分钟没动静: 睡着 (闭眼); 打字只算 "有动静", 马上睁眼
  const openEyes = (p: number[][]) => p.flat().filter(c => c === COL.eye).length
  await clock.advance(5 * 60_000 + 1_000)
  expect(openEyes((await panelNow($)).px)).toBe(0)
  // 测试的 $ 运行时能直接触发 prompt.edit, 只是类型声明里还没列它
  await ($.prompt as any).edit({ text: '', cursor: 0, start: 0, end: 0, inputText: 'h', origin: { kind: 'composer' } })
  let px = (await panelNow($)).px
  expect(openEyes(px)).toBe(2)
  // 发出消息: 第 0 帧蹲下 (身体下移一行), 第 1、2 帧腾空 (没有腿), 4 帧后落回平常
  const legsRow = (p: number[][]) => [2, 4, 7, 9].map(x => p[4][x])
  expect(legsRow((await panelNow($)).px)).toEqual([COL.body, COL.body, COL.body, COL.body])
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as any)
  px = (await panelNow($)).px
  expect(px[0][4]).toBe(-1) // 蹲: 身体从第 2 行开始
  await clock.advance(160)
  px = (await panelNow($)).px
  expect(legsRow(px).every(c => c !== COL.body)).toBe(true) // 腾空: 不画腿
  await clock.advance(600)
  expect(legsRow((await panelNow($)).px)).toEqual([COL.body, COL.body, COL.body, COL.body])
  // 后台子代理的结果送回来: 不跳
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } } as any)
  await clock.advance(160)
  expect(legsRow((await panelNow($)).px)).toEqual([COL.body, COL.body, COL.body, COL.body])
})

test('只跑几十毫秒的工具: 从开始那一刻起至少 0.6 秒拿着道具、状态格写工具名, 之后回到 "思考中"', async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, store: { crab: true }, usage: lowUsage, agents: () => [] })
  await $.turn.start({ text: 'x', turnId: 'q1' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' } as any) // 马上就结束了
  let p = await panelNow($, true)
  expect(p.texts.some(x => x.text.includes('读文件'))).toBe(true)
  expect(PAPER.includes(p.px[1][12])).toBe(true) // 道具区有纸
  await clock.advance(450)
  expect((await panelNow($, true)).texts.some(x => x.text.includes('读文件'))).toBe(true)
  await clock.advance(300)
  p = await panelNow($, true)
  expect(p.texts.some(x => x.text.includes('读文件'))).toBe(false)
  expect(p.texts.some(x => x.text.includes('思考中'))).toBe(true)
  expect(PAPER.includes(p.px[1][12])).toBe(false)
})

test('子代理在跑: 面板螃蟹的道具区右下角有小螃蟹; 都结束后约 1.5 秒淡出, 然后不画', async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = [{ id: 'k1', description: 'k1', type: 'general-purpose', status: 'running' }]
  const { clock } = await start($, on, WIN, { mockClock: T, store: { crab: true }, usage: lowUsage, agents: () => list })
  let px = (await panelNow($)).px
  // 小螃蟹的身体在 y4 (蹲下) 或 y3 (跳起)
  expect([3, 4].some(y => [12, 13, 14].every(x => px[y][x] === COL.kid))).toBe(true)
  list = [{ ...list[0], status: 'completed' }]
  px = (await panelNow($)).px
  expect([12, 13, 14].map(x => px[4][x])).toEqual([COL.kid, COL.kid, COL.kid]) // 刚结束: 还在, 蹲下开始淡出
  await clock.advance(750)
  px = (await panelNow($)).px
  expect(px[4][13] !== -1 && lumOf(px[4][13]) < lumOf(COL.kid)).toBe(true)
  await clock.advance(900)
  px = (await panelNow($)).px
  expect([3, 4, 5].some(y => [12, 13, 14].some(x => px[y][x] !== -1))).toBe(false)
})

test('状态格的事件 (以前散步道的气泡): 压缩完了 / 慢点！…用完 (红、粗) / 上下文快满了 / 额度刷新了, 各亮约 5 秒; 干活时只换掉工具名, 计时照旧', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  const mk = (pct: number, five: number, fiveReset: number) => ({
    ...USAGE,
    context: { tokens: pct * 2000, window: 200_000, percent: pct },
    rateLimits: [lim('five_hour', five, fiveReset), lim('seven_day', 5, T + 6 * 24 * H)],
  })
  let usage: any = mk(40, 20, T + 4 * H) // 已过 1h 用了 20%: 配速 1.0, 不会用完
  const { clock } = await start($, on, WIN, { mockClock: T, store: { crab: false }, usage: () => usage, agents: () => [] })
  const statusOf = async (working = false) => (await panelNow($, working)).texts.find(x => /慢点|压缩完了|快满了|刷新了|待命|思考中|上一轮/.test(x.text))
  expect((await statusOf())?.text).toContain('待命')
  // 压缩完了
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
  let st = await statusOf()
  expect(st?.text).toContain('✓ 压缩完了')
  expect(st?.props.color).toBe('#4ade80')
  await clock.advance(5_100)
  expect((await statusOf())?.text).toContain('待命')
  // 配速从正常变成会用完: "慢点！…用完", 红色加粗; 同一个窗口只说一次
  usage = mk(40, 80, T + 3 * H + 5_100) // 已过约 2h 用了 80%
  st = await statusOf()
  expect(st?.text).toMatch(/^慢点！\d+m用完/)
  expect([st?.props.color, st?.props.bold]).toEqual(['#f87171', true])
  // 干活时: 只换掉工具名那段, 计时照旧在最后
  await $.turn.start({ text: 'x', turnId: 'e1' } as any)
  const w = (await panelNow($, true)).texts.find(x => x.text.includes('慢点'))
  expect(w?.text).toMatch(/慢点！.*\d+s\s*$/)
  await clock.advance(5_100)
  expect((await statusOf(true))?.text).toContain('思考中')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'e1', reason: 'answer' } as any)
  // 上下文第一次到 75%
  usage = { ...usage, context: { tokens: 160_000, window: 200_000, percent: 80 } }
  st = await statusOf()
  expect(st?.text).toContain('上下文快满了')
  expect(st?.props.color).toBe('#fbbf24')
  await clock.advance(5_100)
  // 额度刷新了: 用到 >=30% 后过了重置时刻 (定时器约每 6 秒看一次额度); 上下文仍是 80%, 不再说快满了
  usage = mk(80, 40, T + 40_000)
  let seen = ''
  for (let i = 0; i < 40 && !seen; i++) {
    await clock.advance(1_000)
    seen = (await statusOf())?.text.includes('额度刷新了') ? (await statusOf())!.text : ''
  }
  expect(seen).toContain('✓ 5 小时额度刷新了')
})

test('面板一直挂着: 螃蟹画面一变就重画, 节奏和 sprites 一致 (睡觉的泡泡每 3 帧动一格, 不会被隔帧重画拉成 4 帧 / 2 帧)', async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, store: { crab: true }, usage: lowUsage, agents: () => [] })
  const ui = await mountHint($, 'terminal', 140)
  await clock.advance(5 * 60_000 + 1_000) // 睡着
  const seen: string[] = []
  for (let i = 0; i < 30; i++) {
    await clock.advance(150)
    const r: any = await ui.find({ type: 'Raster', key: 'crab' })
    seen.push(r.props.cells)
  }
  await ui.unmount()
  // 相邻两次取样之间画面变了的位置: 间隔应该都是 3 帧 (泡泡) 或更短 (呼吸和泡泡碰巧错开), 不会出现 4
  const at = seen.map((c, i) => (i > 0 && c !== seen[i - 1] ? i : -1)).filter(i => i >= 0)
  const gaps = at.slice(1).map((x, i) => x - at[i])
  expect(at.length >= 8 ? 'ok' : `变了 ${at.length} 次: ${at}`).toBe('ok')
  expect(gaps.every(g => g <= 3) ? 'ok' : `间隔 ${gaps}`).toBe('ok')
})
