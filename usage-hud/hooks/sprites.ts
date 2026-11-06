// usage-hud: 螃蟹的像素画 (纯函数, 不碰 $), 给 hooks 模块 (register.tsx) 用
//   - 面板那只大螃蟹 (scenePx / miniPx): 按工具做动作、道具区、情绪

export const FRAME_MS = 150
export const SPRITE_W = 15 // 12 列螃蟹 + 3 列道具
export const MINI_W = 8
export const JUMP_FRAMES = 4 // 发出消息那一跳: 蹲 / 腾空 / 腾空 / 落地
const KID_Y = 3 // 子代理小螃蟹占道具区 y 3-5
const KID_FADE = 0x27272a // 子代理小螃蟹离场时淡向的颜色 (终端深色底)
export const DEF = 0x01000000 // 终端的默认颜色
export const DIM = '#71717a'
export const VALUE = '#d4d4d8'
export const WARN = '#f87171' // 会用完时 百分比 和 "40m用完" 的颜色

export type Mood = 'normal' | 'sweat' | 'panic'
export type ToolKind = 'think' | 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'other'

// ---------------- 颜色 ----------------
export const COL = {
  body: 0xd97757,
  hot: 0xe5484d,
  eye: 0x1c1917,
  sweat: 0x60a5fa,
  spark: 0xfacc15,
  bubble: 0x8b8b94,
  paper: 0xd4d4d8,
  ink: 0x52525b,
  scan: 0x60a5fa,
  term: 0x3f3f46,
  cursor: 0x4ade80,
  sea: 0x3b82f6,
  land: 0x4ade80,
  gear: 0xa1a1aa,
  thought: 0xa1a1aa,
  alarm: 0xef4444, // 慌张的 "!"
  kid: 0xf2a07b, // 子代理小螃蟹用浅一号的颜色, 和大螃蟹分得开
  kidLeg: 0xa4553d,
}
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// ---------------- 文字宽度 (中文/全角算 2 列) ----------------
export function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  )
}
export function dw(s: string): number {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
}
export function clip(s: string, max: number): string {
  if (max <= 0) return ''
  if (dw(s) <= max) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
    if (w + cw > max - 2) break
    out += ch
    w += cw
  }
  return out + '..'
}

// ---------------- 像素画 ----------------
export type Px = number[][]
function canvas(w: number, h: number): Px {
  const p: Px = []
  for (let y = 0; y < h; y++) p.push(new Array(w).fill(-1))
  return p
}
function put(p: Px, x: number, y: number, c: number) {
  if (y >= 0 && y < p.length && x >= 0 && x < p[y].length) p[y][x] = c
}
function rect(p: Px, x0: number, y0: number, w: number, h: number, c: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(p, x, y, c)
}
export function encode(px: Px, cols: number, cellRows: number): string {
  const words: number[] = []
  for (let r = 0; r < cellRows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = px[r * 2]?.[c] ?? -1
      const bot = px[r * 2 + 1]?.[c] ?? -1
      if (top < 0 && bot < 0) words.push(32, DEF, DEF)
      else if (bot < 0) words.push(0x2580, top, DEF) // ▀
      else if (top < 0) words.push(0x2584, bot, DEF) // ▄
      else words.push(0x2580, top, bot)
    }
  }
  return new Uint8Array(Uint32Array.from(words).buffer).toBase64()
}

// eyeDy: 眼睛在身体第几行 (默认 1; 2 = 往下看); legs < 0 = 腾空不画腿
type Pose = { bob: number; legs: number; eyes: 'open' | 'closed'; look: number; armL: 'out' | 'up'; armR: 'out' | 'up'; body: number; eyeDy?: number }

// 12x5 像素的螃蟹 (第 6 行留给上下颠)
function drawCrab(p: Px, o: Pose) {
  const y = o.bob
  rect(p, 2, y, 8, 4, o.body)
  if (o.armL === 'out') rect(p, 0, y + 2, 2, 1, o.body)
  else rect(p, 0, y, 1, 2, o.body)
  if (o.armR === 'out') rect(p, 10, y + 2, 2, 1, o.body)
  else rect(p, 11, y, 1, 2, o.body)
  // 走路: 四条腿两两交替抬起
  if (o.legs >= 0) {
    const legs = [[2, 4, 7, 9], [2, 7], [2, 4, 7, 9], [4, 9]][o.legs % 4]
    for (const x of legs) put(p, x, y + 4, o.body)
  }
  const eye = o.eyes === 'open' ? COL.eye : mix(o.body, COL.eye, 0.45)
  const ey = y + (o.eyeDy ?? 1)
  put(p, 4 + o.look, ey, eye)
  put(p, 7 + o.look, ey, eye)
}

// v0.17.4-0.17.5 (散步道的功能搬回面板):
//   hop = 发出消息那一跳的第几帧 (0-3)
//   agents > 0 = 道具区右下角一只蹦蹦跳跳的子代理小螃蟹 (0.13 的画法), 道具上移、缩成 3 行高, 两样同时看得见
//     主线程闲着时大螃蟹看着它, 隔一会儿举钳给它打气
//   kidBye = 子代理都结束了, 小螃蟹淡出的进度 (0-1); 没有就不画
export type Scene = { working: boolean; kind: ToolKind; pct: number; celebrating: boolean; sleeping: boolean; agents: number; mood?: Mood; hop?: number; kidBye?: number }

// 大螃蟹这一帧摆什么姿势: 终端 (scenePx) 和客户端 (crabSvg) 共用这一套先后
//   庆祝 > 干活 > 慌张 (会把睡着的叫醒) > 看着子代理 (主线程闲着、子代理在跑) > 睡觉 > 闲着
//   跳一下 (hop) 只有终端有, 在 scenePx 里盖过所有姿势
export type CrabPose = 'celebrate' | 'work' | 'panic' | 'watch' | 'sleep' | 'idle'
export function crabPose(s: Scene): CrabPose {
  if (s.celebrating) return 'celebrate'
  if (s.working) return 'work'
  if (s.mood === 'panic') return 'panic'
  if (s.agents > 0) return 'watch'
  if (s.sleeping) return 'sleep'
  return 'idle'
}

function bodyColor(pct: number, f: number): number {
  if (pct >= 95) return f % 4 < 2 ? COL.hot : COL.body
  return pct >= 80 ? COL.hot : COL.body
}

export function scenePx(s: Scene, f: number): Px {
  const p = canvas(SPRITE_W, 6)
  const t = Math.floor(f / 2)
  const md = s.mood ?? 'normal'
  const pose = crabPose(s)
  // 右侧 3 列 (x 12-14) 是道具区; 有子代理小螃蟹时它占 y KID_Y 起的三行, 道具区的东西都只画在 floor 上面:
  //   道具从 oy 行起、高 zh 像素 (有小螃蟹时上移一格、缩成 3 像素高)
  const kid = s.agents > 0 || (s.kidBye !== undefined && s.kidBye < 1) // 淡完 (kidBye 到 1) 就不画
  const [oy, zh, floor] = kid ? [0, 3, KID_Y] : [1, 4, 6]
  const o: Pose = { bob: 0, legs: 0, eyes: 'open', look: 0, armL: 'out', armR: 'out', body: bodyColor(s.pct, f) }
  let bigBang = false // 右侧的大 "!"

  if (s.hop !== undefined) {
    // 发出消息那一跳 (画布只有 6 像素高, 没法整只往上移): 蹲 -> 腾空 (不画腿) -> 落地
    o.bob = s.hop === 0 || s.hop >= JUMP_FRAMES - 1 ? 1 : 0
    if (s.hop === 1 || s.hop === 2) {
      o.legs = -1
      o.armL = 'up'
      o.armR = 'up'
    }
  } else if (pose === 'celebrate') {
    o.armL = 'up'
    o.armR = 'up'
    o.bob = t % 2
    const spots = [[12, 0], [14, 1], [13, 3], [12, 5], [14, 4], [13, 1], [1, 0], [10, 0]]
    spots.forEach(([x, y], i) => {
      if ((i + f) % 3 === 0 && (x < 12 || y < floor)) put(p, x, y, COL.spark)
    })
  } else if (pose === 'work') {
    o.legs = t % 4
    o.bob = t % 2
    switch (s.kind) {
      case 'think': {
        o.look = 1
        const dots = [[12, oy + zh - 1], [13, oy + 1], [14, 0]]
        const n = Math.floor(f / 3) % 4
        for (let i = 0; i < n; i++) put(p, dots[i][0], dots[i][1], COL.thought)
        break
      }
      case 'read': {
        o.look = 1
        rect(p, 12, oy, 3, zh, COL.paper)
        rect(p, 12, oy + (t % zh), 3, 1, COL.scan)
        break
      }
      case 'edit': {
        o.look = 1
        o.armR = f % 2 ? 'up' : 'out'
        rect(p, 12, oy, 3, zh, COL.paper)
        const k = t % (zh * 3 + 1)
        for (let i = 0; i < k; i++) put(p, 12 + (i % 3), oy + Math.floor(i / 3), COL.ink)
        break
      }
      case 'bash': {
        o.armL = f % 2 ? 'up' : 'out'
        o.armR = f % 2 ? 'out' : 'up'
        rect(p, 12, oy, 3, zh, COL.term)
        put(p, 12, oy + 1, COL.cursor)
        if (f % 4 < 2) put(p, 13, oy + zh - 1, COL.cursor)
        break
      }
      case 'web': {
        o.look = 1
        const ring = [[13, oy], [14, oy + 1], [13, oy + 2], [12, oy + 1]]
        for (const [x, y] of ring) put(p, x, y, COL.sea)
        put(p, 13, oy + 1, COL.sea)
        const [lx, ly] = ring[t % 4]
        put(p, lx, ly, COL.land)
        break
      }
      case 'agent':
        break
      default: {
        const orbit = [[12, oy], [13, oy], [14, oy], [14, oy + 1], [14, oy + 2], [13, oy + 2], [12, oy + 2], [12, oy + 1]]
        put(p, 13, oy + 1, COL.gear)
        const [gx, gy] = orbit[f % 8]
        put(p, gx, gy, COL.gear)
      }
    }
  } else if (pose === 'panic') {
    // 闲置时慌张: 双钳举起, 左右发抖, 腿乱蹬; 右侧空着就竖一个大 "!"
    o.armL = 'up'
    o.armR = 'up'
    o.look = f % 2 ? 1 : -1
    o.legs = f % 4
    bigBang = !kid // 有小螃蟹时放不下 4 行高的大 "!", 改由头边的红色 "!" 闪
  } else if (pose === 'watch') {
    // 主线程闲着、子代理在跑: 眼睛往右下看着道具区里干活的小螃蟹, 隔一会儿举右钳给它加油打气
    o.look = 1
    o.eyeDy = 2
    if (f % 40 >= 32) o.armR = Math.floor(f / 2) % 2 ? 'up' : 'out'
  } else if (pose === 'sleep') {
    o.eyes = 'closed'
    o.bob = Math.floor(f / 8) % 2 // 慢慢呼吸
    // 泡泡从下往上冒; 有小螃蟹时只在它上面
    const z = Math.floor(f / 3)
    put(p, 13, floor - 1 - (z % floor), COL.bubble)
    put(p, 14, floor - 1 - ((z + 3) % floor), COL.bubble)
  } else {
    const cyc = f % 160
    if (f % 30 === 0) o.eyes = 'closed' // 眨眼
    if (cyc >= 60 && cyc < 68) o.look = -1 // 左右张望
    else if (cyc >= 68 && cyc < 76) o.look = 1
    if (cyc >= 120 && cyc < 136) o.armR = Math.floor(f / 3) % 2 ? 'up' : 'out' // 挥手
  }

  drawCrab(p, o)

  if (bigBang) {
    const c = f % 4 < 2 ? COL.alarm : COL.spark
    put(p, 13, 0, c)
    put(p, 13, 1, c)
    put(p, 13, 3, c)
  }
  // 头边 (x=1, 第 0-1 行, 任何姿势下都空着): 上下文告急 / 冒汗 -> 汗滴; 慌张 -> 汗滴和红色 "!" 交替
  if (!s.celebrating) {
    const sweat = s.pct >= 80 || md !== 'normal'
    if (md === 'panic' && !bigBang && t % 4 >= 2) {
      put(p, 1, 0, COL.alarm)
      put(p, 1, 1, COL.alarm)
    } else if (sweat) {
      const d = t % 4
      if (d < 2) put(p, 1, d, COL.sweat)
    }
  }
  if (kid) drawKid(p, f, s.kidBye)
  return p
}

// 子代理小螃蟹 (沿用 0.13 / README 动图的画法: 3 列 x 2 行, 没有眼睛), 在道具区右下角 x 12-14, y 3-5 里蹦:
//   蹲下 (y 4-5) 腿张开  CCC / L.L
//   跳起 (y 3-4) 腿收拢  CCC / .L.
// 每 KID_STEP 帧 (3 x 150ms = 0.45 秒) 换一个姿势, 慢慢跳, 不抢大螃蟹的戏; 几个子代理都只画一只 (数量看状态格的 "+N代理")
// bye = 子代理都结束了: 蹲着不动, 慢慢淡出 (0 -> 1)
const KID_STEP = 3
function drawKid(p: Px, f: number, bye?: number) {
  const fade = bye === undefined ? 0 : bye * 0.85
  const body = mix(COL.kid, KID_FADE, fade)
  const leg = mix(COL.kidLeg, KID_FADE, fade)
  const up = bye === undefined && Math.floor(f / KID_STEP) % 2 === 1
  const y = up ? KID_Y : KID_Y + 1
  rect(p, 12, y, 3, 1, body)
  for (const x of up ? [13] : [12, 14]) put(p, x, y + 1, leg)
}

// 精简版的一行小螃蟹 (8 列 x 2 像素); 放不下子代理小螃蟹 (数量看 "+N代理")
export function miniPx(s: Scene, f: number): Px {
  const p = canvas(MINI_W, 2)
  const t = Math.floor(f / 2)
  const md = s.mood ?? 'normal'
  const body = bodyColor(s.pct, f)
  rect(p, 0, 0, MINI_W, 1, body)
  const closed = s.sleeping || (!s.working && !s.celebrating && f % 30 === 0)
  const look = s.working ? 1 : 0
  let eye = closed ? mix(body, COL.eye, 0.45) : COL.eye
  if (md === 'panic' && !s.celebrating && f % 4 < 2) eye = COL.spark // 慌张: 眼睛黄红闪
  put(p, 2 + look, 0, eye)
  put(p, 5 + look, 0, eye)
  const scramble = md === 'panic' && !s.celebrating
  const legs = s.celebrating ? [0, 7] : (s.working || scramble) && t % 2 ? [0, 2, 5, 7] : [1, 3, 4, 6]
  for (const x of legs) put(p, x, 1, body)
  // 冒汗: 左下角一颗蓝色汗滴闪
  if (!s.celebrating && (s.pct >= 80 || md !== 'normal') && t % 4 < 2) put(p, 0, 1, COL.sweat)
  return p
}
