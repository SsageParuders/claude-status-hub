// usage-hud 的终端面板和子代理看板在动图里怎么画: 什么都不移植
//   排版直接用插件的 panel.ts (panelView / agentsPaneView), 螃蟹直接用 sprites.ts (render.mjs 去掉类型后放在 /vendor/)
//   这里只做插件里 Box / Text / Button / Raster 做的那一步: 把排版结果写进画布格子 (cells.js 的 Grid)
import { scenePx, miniPx, toolKind, SPRITE_W, MINI_W } from '/vendor/sprites.js'
import { panelView, agentsPaneView, paceOf, moodOf, easeStep, CRAB_GAP } from '/vendor/panel.js'
import { C } from './claude.js'

// 数字滚动: 从 start 起, 第 0..frames 帧每帧按插件的 easeStep 追 targetAt(f); 目标还没有 (undefined) 的帧不动
export function easeAt(targetAt, frames, start) {
  let cur = start
  let target
  for (let f = 0; f <= frames; f++) {
    target = targetAt(f)
    if (target === undefined) continue
    cur = easeStep(cur, target)
  }
  return target === undefined ? undefined : cur
}

// 场景里每一刻的状态 s = 插件的 PanelInfo (panel.ts, 字段名照搬) + 动图自己要的:
//   frame = 插件的帧计数; shown = 三根条这一帧显示的值 (easeAt 算, 没给的直接显示目标值); celebrating / sleeping = 螃蟹
// 螃蟹这一帧的处境 (sprites.ts 的 Scene): 面板里的、标题里放大的、客户端卡片上的 (deskCrab) 都从这里取
export function sceneOf(s) {
  return {
    working: s.working,
    kind: toolKind(s.tool),
    pct: s.pct ?? 0,
    celebrating: s.celebrating,
    sleeping: s.sleeping,
    agents: s.agents,
    mood: moodOf(paceOf(s.five, s.now), paceOf(s.week, s.now)),
  }
}

// 在 grid 的 (row, col0) 起画, W = 面板可用宽度 (同插件 buildView 的 W)
// 返回可点元素 (给鼠标指针用), 按点了做什么命名: { buttons: { agents: [row, c0, c1, 标签], compact: [...], ... } }
export function drawHud(g, row, col0, W, s) {
  const scene = sceneOf(s)
  const shown = { ctx: s.pct, h5: s.five?.percentUsed, wk: s.week?.percentUsed, ...s.shown }
  const view = panelView({ ...s, W, term: true, crab: true, compact: false, shown })

  const buttons = {}
  // 一格: 各段连着写, 超出格宽的裁掉 (同 Ink 的 overflow hidden); Button plain 画成默认前景色, dimColor 画成暗色
  const cell = (r, x, c) => {
    const max = x + c.w
    let col = x
    for (const p of c.parts) {
      if (p.t === 'crab') {
        g.raster(r, col, miniPx(scene, s.frame), MINI_W, 1)
        col += MINI_W
        continue
      }
      const c0 = col
      if (p.t === 'text') col = g.text(r, col, p.text, { fg: p.color, bold: p.bold }, max)
      else {
        col = g.text(r, col, p.label, { fg: p.dim ? C.dimText : C.text }, max)
        buttons[p.act] = [r, c0, Math.min(col, max), p.label]
      }
    }
  }
  // 一行格子: 从 x 起, 格子之间空 view.gap 列
  const line = (r, x, cells) => {
    for (const c of cells) {
      cell(r, x, c)
      x += c.w + view.gap
    }
  }
  let x = col0 + view.marginL
  if (view.layout === 'compact') line(row, x, view.cells)
  else {
    if (view.crab) {
      g.raster(row, x, scenePx(scene, s.frame), SPRITE_W, 3)
      x += SPRITE_W + CRAB_GAP
    }
    view.rows.forEach((cells, r) => line(row + r, x, cells))
  }
  return { buttons }
}

// 子代理看板的内容: kids = [{ id, desc, type, startedAt, lastAt, lastTool, tools, status, endedAt? }]
export function drawAgentsPane(g, row, col0, width, kids, now) {
  let r = row
  for (const l of agentsPaneView(kids, now, width).lines) {
    let c = col0
    for (const p of l.parts) c = g.text(r, c, p.text, { fg: p.color, bold: p.bold })
    r++
  }
  return r
}
