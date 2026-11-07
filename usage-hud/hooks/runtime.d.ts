// hooks 的运行环境里有、TypeScript 的 es2023 lib 里还没有的 API (引擎生成的 tsconfig 只带 es2023); 只有类型, 不会被加载
interface Uint8Array {
  toBase64(): string
}
