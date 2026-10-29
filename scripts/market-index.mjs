/**
 * market-index.mjs — 生成 format 1 市场索引 `market/index.json`。
 *
 *   node scripts/market-index.mjs                 # 用当前 HEAD 的 commit
 *   node scripts/market-index.mjs --commit <sha>  # 指到指定 commit
 *   node scripts/market-index.mjs --source npm    # 改成 npm 源（需先 npm publish）
 *
 * 索引规范来自宿主包 `@deepseek-ai/dsh-plugin-market-index`：
 *   - 顶层 `format: 1` + `metadata`（categories / labels / sortKeys 的声明）+ `plugins`
 *   - 每个插件必须有 `name` 与至少一个 `versions`
 *   - 每个 version 的 `source` 只能是 `npm` 或 `git`（git 必须钉死 40 位小写 commit）
 *   - `icon` 可以是相对索引文件的路径，解析后必须落在 https 或索引同源上
 *
 * 发布新版本后重跑本脚本，把新的 commit 写进索引，再提交。
 */

import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 读 `--flag value` 形式的参数。
 * @param argv - process.argv.slice(2)
 * @param flag - 旗标名（含 --）
 * @returns 值或 undefined
 */
function flag(argv, flag) {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

const argv = process.argv.slice(2)
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

const commit = flag(argv, '--commit') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const useNpm = argv.includes('--source') && flag(argv, '--source') === 'npm'
const repositoryUrl = 'https://github.com/YOUR_GITHUB_USER/dsh-session-delete'

if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit 必须是 40 位小写十六进制，拿到的是 ${commit}`)

const source = useNpm
  ? { type: 'npm' }
  : { type: 'git', url: `${repositoryUrl}.git`, commit }

const index = {
  format: 1,
  metadata: {
    categories: {
      sessions: { title: { en: 'Sessions', zh: '会话管理' } },
      tools: { title: { en: 'Tools', zh: '工具' } },
    },
    labels: {
      destructive: { title: { en: 'Destructive', zh: '破坏性操作' } },
    },
    sortKeys: {},
  },
  plugins: [
    {
      name: pkg.name,
      title: {
        en: 'Session Delete',
        zh: '会话删除',
      },
      description: {
        en: 'Real session deletion: the row menu gains a destructive action that archives, removes the session directory, prunes workspace accounting and clears the projection cache.',
        zh: '真正删除会话：会话行「⋯」菜单里多一条危险操作，归档 + 删目录 + 摘工作区记账 + 清投影缓存，并逐项报告结果。',
      },
      icon: '../icon.svg',
      author: pkg.author,
      homepage: 'https://github.com/YOUR_GITHUB_USER/dsh-session-delete#readme',
      repository: {
        url: `${repositoryUrl}.git`,
      },
      metadata: {
        category: 'sessions',
        keywords: ['会话', '删除', '归档', '清理', 'session', 'delete', 'archive'],
        labels: ['destructive'],
        sortKeys: {},
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source,
          engines: {
            dsh: '>=0.2.0-0',
          },
        },
      ],
    },
  ],
}

const target = join(root, 'market', 'index.json')
await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify(index, undefined, 2)}\n`, 'utf8')
console.log(`wrote ${target}`)
console.log(`source: ${source.type}${useNpm ? '' : ` @ ${commit}`}`)
