/**
 * pack.mjs — 产出一个可直接分发的 `.tgz`，并打印包含的文件清单。
 *
 *   node scripts/pack.mjs
 *
 * 输出到 `release/dsh-session-delete-<version>.tgz`。GitHub Release 附件、
 * `dsh plugin add <url>`、`npm install <file>` 都能直接用这个包。
 *
 * 只打包 `package.json` 的 `files` 里声明的路径，外加 package.json 自身，
 * 所以测试、脚本、market 目录不会进产物。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/**
 * Expand one entry of `files` into concrete paths.
 * @param entry - 文件或目录的相对路径。
 * @returns 绝对路径列表。
 */
async function expand(entry) {
  const absolute = join(root, entry)
  const info = await stat(absolute).catch(() => undefined)
  if (info === undefined) throw new Error(`files 里声明的路径不存在：${entry}`)
  if (info.isFile()) return [absolute]
  const out = []
  for (const child of await readdir(absolute, { withFileTypes: true })) {
    out.push(...await expand(join(entry, child.name)))
  }
  return out
}

const entries = new Set([join(root, 'package.json')])
for (const entry of pkg.files ?? []) {
  for (const path of await expand(entry)) entries.add(path)
}

/**
 * Minimal POSIX ustar header. npm/pnpm only need the file entries, the
 * checksum and the 512-byte alignment.
 * @param name - archive path.
 * @param size - byte length.
 * @param mode - permission bits.
 * @returns 512-byte header block.
 */
function tarHeader(name, size, mode) {
  const buffer = Buffer.alloc(512, 0)
  const write = (value, offset, length) => {
    Buffer.from(value, 'utf8').copy(buffer, offset, 0, length)
  }
  write(name, 0, 100)
  write(mode.toString(8).padStart(7, '0'), 100, 8)
  write('0000000', 108, 8)
  write('0000000', 116, 8)
  write(size.toString(8).padStart(11, '0'), 124, 12)
  write('00000000000', 136, 12)
  write('        ', 148, 8)
  write('0', 156, 1)
  write('ustar\u000000', 257, 8)
  write('root', 265, 32)
  write('root', 297, 32)
  let checksum = 0
  for (const byte of buffer) checksum += byte
  write(checksum.toString(8).padStart(6, '0') + '\u0000 ', 148, 8)
  return buffer
}

const blocks = []
const list = []
for (const path of [...entries].sort()) {
  const name = `package/${relative(root, path).split(sep).join('/')}`
  const content = await readFile(path)
  const mode = (await stat(path)).mode & 0o777
  blocks.push(tarHeader(name, content.length, mode))
  blocks.push(content)
  const padding = (512 - (content.length % 512)) % 512
  if (padding !== 0) blocks.push(Buffer.alloc(padding, 0))
  list.push(`${name}  ${content.length} B`)
}
blocks.push(Buffer.alloc(1024, 0))

const tarball = gzipSync(Buffer.concat(blocks), { level: 9 })
const targetDir = join(root, 'release')
await mkdir(targetDir, { recursive: true })
const target = join(targetDir, `${pkg.name}-${pkg.version}.tgz`)
await writeFile(target, tarball)

console.log(list.join('\n'))
console.log(`\n${relative(root, target)}  ${tarball.length} B`)
console.log(`sha256  ${createHash('sha256').update(tarball).digest('hex')}`)
