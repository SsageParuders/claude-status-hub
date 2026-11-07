# 演示动图生成脚本

`assets/` 里的四张 GIF（`usage-hud.gif`、`html-shelf.gif`、`quickstart.gif`、`client.gif`）都由这里的脚本生成。每张图是 `scenes/` 里的一个 HTML 页面，页面提供 `renderFrame(t)`，按时间直接算出画面。`render.mjs` 用无头 Chrome（DevTools 协议）按 2 倍像素逐帧截图，再用 ffmpeg（`palettegen` / `paletteuse`）缩回 1 倍合成 GIF。动图里画的 usage-hud 不是移植版，就是插件自己的代码：`render.mjs` 把 `usage-hud/hooks/` 下的 `sprites.ts`（像素螃蟹）、`panel.ts`（终端面板和子代理看板的排版、格式化、配速）、`desktop.ts`（客户端的 SVG 面板）去掉类型标注后放在 `/vendor/`，场景直接调用。`lib/hud.js` 只负责把 `panelView` / `agentsPaneView` 的排版结果写进画布格子（插件里这一步是 Box / Text / Button），所以插件改了面板，重新生成动图就跟着变，不用手动同步。

```bash
node tools/demo/render.mjs                 # 全部重新生成 (约 6 分钟)
node tools/demo/render.mjs html-shelf      # 只做一张
node tools/demo/render.mjs --gif-only      # 用已有的帧重新合成
node tools/demo/check-strings.mjs          # 校验脚本里没有本机路径和内部名字
```

`scenes/_smoke.html` 是管线冒烟场景（`node tools/demo/render.mjs _smoke`），名字以 `_` 开头的场景输出只留在 `out/`，不进 `assets/`。需要 Node 23 以上、Chrome 或 Edge、ffmpeg。找不到时设置环境变量 `CHROME_PATH` / `FFMPEG_PATH`。中间帧、抽查帧（`out/check/`）和尺寸清单（`out/manifest.json`）都在 `out/` 里，不进仓库。字体用系统里的 Cascadia Mono 和 Microsoft YaHei（Windows）；macOS 上没有这两个时自动换成自带的 Menlo 和苹方，格子尺寸不变，只是字形不同。
