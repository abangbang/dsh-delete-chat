/**
 * rename-owner.mjs — 一次性替换仓库里的占位符。
 *
 *   node scripts/rename-owner.mjs <github-user> [display-name]
 *
 * 替换 `abangbang`、`abangbang`，并顺手把 `repository` / `homepage` /
 * `bugs` / `dsh.install` 里的地址一起改掉。跑完打印改了哪些文件。
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [user, displayName = user] = process.argv.slice(2)

if (user === undefined || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user)) {
  console.error('usage: node scripts/rename-owner.mjs <github-user> [display-name]')
  process.exit(1)
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'release', 'coverage'])
const TEXT_EXTENSIONS = new Set([
  '.md', '.json', '.js', '.mjs', '.cjs', '.yml', '.yaml', '.svg', '.txt', '.ps1', '.ts', '',
])

/**
 * Walk the repository, skipping vendored and generated directories.
 * @param dir - absolute directory.
 * @returns absolute file paths.
 */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...await walk(join(dir, entry.name)))
    } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const touched = []
for (const path of await walk(root)) {
  const before = await readFile(path, 'utf8')
  if (!before.includes('abangbang') && !before.includes('abangbang')) continue
  const after = before
    .replaceAll('abangbang', user)
    .replaceAll('abangbang', displayName)
  await writeFile(path, after, 'utf8')
  touched.push(relative(root, path).split(sep).join('/'))
}

if (touched.length === 0) {
  console.log('没有找到占位符，可能已经替换过了。')
} else {
  console.log(`已替换 ${touched.length} 个文件：`)
  for (const file of touched) console.log(`  ${file}`)
}
console.log(`\n下一步：node scripts/market-index.mjs 重新生成索引，然后 git commit。`)
