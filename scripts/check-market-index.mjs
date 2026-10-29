/**
 * check-market-index.mjs — 自检 `market/index.json` 是否满足宿主认可的 format 1 规则。
 *
 *   node scripts/check-market-index.mjs
 *
 * CI 里没有 `@deepseek-ai/dsh-plugin-market-index` 这个包，所以这里按它的校验规则重写了一份
 * 最小实现：字段名、必填项、枚举、SemVer、commit 形态、图标可解析性都对齐，任何一条不满足
 * 就以非零码退出。本地如果装了宿主包，可以再用真解析器交叉验证一遍。
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = join(root, 'market', 'index.json')

const LANGUAGE_ID = /^[a-z][a-z0-9-]*$/u
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const COMMIT = /^[0-9a-f]{40}$/u
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u

const failures = []

/**
 * Record a rule violation.
 * @param path - dotted location inside the document.
 * @param message - what is wrong.
 */
function fail(path, message) {
  failures.push(`${path}: ${message}`)
}

/**
 * Ensure a value is a non-array object.
 * @param value - candidate.
 * @param path - dotted location.
 * @returns the object, or undefined after recording a failure.
 */
function objectAt(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object')
    return undefined
  }
  return value
}

/**
 * Localized text: every member is a string, keys are lowercase language ids, `en` is mandatory.
 * @param value - candidate.
 * @param path - dotted location.
 * @returns localized record or undefined.
 */
function localizedText(value, path) {
  const object = objectAt(value, path)
  if (object === undefined) return undefined
  for (const [language, text] of Object.entries(object)) {
    if (!LANGUAGE_ID.test(language)) fail(`${path}.${language}`, 'must be keyed by a lowercase language id')
    if (typeof text !== 'string') fail(`${path}.${language}`, 'must be a string')
  }
  if (!Object.hasOwn(object, 'en')) fail(path, 'must contain en')
  return object
}

/**
 * SemVer range check, permissive but rejects obvious junk.
 * @param value - candidate.
 * @param path - dotted location.
 */
function semverRange(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(path, 'must be a SemVer range')
    return
  }
  if (value.startsWith('workspace:')) fail(path, 'must not be a workspace: range')
}

/**
 * Validate one plugin entry.
 * @param plugin - entry object.
 * @param at - dotted location.
 * @param index - validated top-level metadata.
 * @param indexUrl - absolute URL the index would be served from.
 */
function validatePlugin(plugin, at, index, indexUrl) {
  const object = objectAt(plugin, at)
  if (object === undefined) return

  if (typeof object.name !== 'string' || !PACKAGE_NAME.test(object.name) || object.name.length > 214) {
    fail(`${at}.name`, 'must be a valid npm package name')
  }
  if (object.title !== undefined) localizedText(object.title, `${at}.title`)
  if (object.description !== undefined) localizedText(object.description, `${at}.description`)

  if (object.icon !== undefined) {
    if (typeof object.icon !== 'string') fail(`${at}.icon`, 'must be a string')
    else if (object.icon.startsWith('data:')) {
      const payload = DATA_ICON.exec(object.icon)?.[1]
      if (payload === undefined || payload === '' || !BASE64.test(payload)) {
        fail(`${at}.icon`, 'must be a base64 SVG, PNG, JPEG, or WebP data URL')
      } else {
        const bytes = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
        if (bytes > 32768) fail(`${at}.icon`, 'must not exceed 32 KiB of decoded bytes')
      }
    } else {
      let resolved
      try {
        resolved = new URL(object.icon, indexUrl)
      } catch {
        fail(`${at}.icon`, 'must be a URL reference')
      }
      if (resolved !== undefined && resolved.protocol !== 'https:' && resolved.origin !== new URL(indexUrl).origin) {
        fail(`${at}.icon`, 'must resolve to https or the index origin')
      }
    }
  }

  if (object.repository !== undefined) {
    const repository = objectAt(object.repository, `${at}.repository`)
    if (repository !== undefined) {
      if (typeof repository.url !== 'string' || !URL.canParse(repository.url)) {
        fail(`${at}.repository.url`, 'must be an absolute URL')
      }
      if (repository.directory !== undefined) {
        if (typeof repository.directory !== 'string' || repository.directory.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
          fail(`${at}.repository.directory`, 'must be a relative directory without . or .. segments')
        }
      }
    }
  }

  if (object.metadata !== undefined) {
    const metadata = objectAt(object.metadata, `${at}.metadata`)
    if (metadata !== undefined) {
      if (metadata.category !== undefined && !Object.hasOwn(index.categories, metadata.category)) {
        fail(`${at}.metadata.category`, `references undeclared category ${JSON.stringify(metadata.category)}`)
      }
      if (metadata.labels !== undefined) {
        if (!Array.isArray(metadata.labels)) fail(`${at}.metadata.labels`, 'must be an array')
        else {
          const seen = new Set()
          for (const label of metadata.labels) {
            if (!Object.hasOwn(index.labels, label)) fail(`${at}.metadata.labels`, `references undeclared label ${JSON.stringify(label)}`)
            if (seen.has(label)) fail(`${at}.metadata.labels`, 'must not repeat a label')
            seen.add(label)
          }
        }
      }
      if (metadata.keywords !== undefined && (!Array.isArray(metadata.keywords) || metadata.keywords.some((word) => typeof word !== 'string'))) {
        fail(`${at}.metadata.keywords`, 'must be an array of strings')
      }
    }
  }

  if (!Array.isArray(object.versions) || object.versions.length === 0) {
    fail(`${at}.versions`, 'must be a non-empty array')
    return
  }
  const seenVersions = new Set()
  object.versions.forEach((version, position) => {
    const versionAt = `${at}.versions[${String(position)}]`
    const entry = objectAt(version, versionAt)
    if (entry === undefined) return

    if (typeof entry.version !== 'string' || !SEMVER.test(entry.version)) fail(`${versionAt}.version`, 'must be an exact SemVer version')
    else if (seenVersions.has(entry.version)) fail(`${versionAt}.version`, `duplicates ${entry.version}`)
    else seenVersions.add(entry.version)

    if (!Number.isInteger(entry.publishTimestamp) || entry.publishTimestamp < 0 || entry.publishTimestamp >= 1e11) {
      fail(`${versionAt}.publishTimestamp`, 'must be an integer number of Unix seconds in [0, 10^11)')
    }

    const source = objectAt(entry.source, `${versionAt}.source`)
    if (source !== undefined) {
      if (source.type === 'npm') {
        if (source.registry !== undefined) {
          if (typeof source.registry !== 'string' || !URL.canParse(source.registry)) fail(`${versionAt}.source.registry`, 'must be an absolute URL')
        }
      } else if (source.type === 'git') {
        if (typeof source.url !== 'string' || !URL.canParse(source.url) || !source.url.startsWith('https://')) {
          fail(`${versionAt}.source.url`, 'must be an https URL')
        } else if (!/^(?:\/[^/]+){2,}$/u.test(new URL(source.url).pathname)) {
          fail(`${versionAt}.source.url`, 'must name a repository with at least two path segments')
        } else if (/\.(?:tgz|tar\.gz)$/iu.test(new URL(source.url).pathname)) {
          fail(`${versionAt}.source.url`, 'must name a repository, not a tarball')
        }
        if (typeof source.commit !== 'string' || !COMMIT.test(source.commit)) {
          fail(`${versionAt}.source.commit`, 'must be a lowercase 40-hex-digit commit SHA')
        }
      } else {
        fail(`${versionAt}.source.type`, 'must be "npm" or "git"')
      }
    }

    if (entry.engines !== undefined) {
      const engines = objectAt(entry.engines, `${versionAt}.engines`)
      if (engines !== undefined && engines.dsh !== undefined) semverRange(engines.dsh, `${versionAt}.engines.dsh`)
    }
  })
}

const document = JSON.parse(await readFile(indexPath, 'utf8'))

if (document.format !== 1) fail('$.format', 'must be 1')

const metadata = document.metadata === undefined ? {} : objectAt(document.metadata, '$.metadata') ?? {}
const index = { categories: {}, labels: {}, sortKeys: {} }
for (const group of ['categories', 'labels', 'sortKeys']) {
  if (metadata[group] === undefined) continue
  const declared = objectAt(metadata[group], `$.metadata.${group}`) ?? {}
  for (const [id, declaration] of Object.entries(declared)) {
    const at = `$.metadata.${group}.${id}`
    if (id === '') fail(at, 'must not declare an empty id')
    const body = objectAt(declaration, at)
    if (body === undefined) continue
    localizedText(body.title, `${at}.title`)
    if (group === 'sortKeys' && body.order !== 'asc' && body.order !== 'desc') fail(`${at}.order`, 'must be "asc" or "desc"')
    index[group][id] = body
  }
}

// Icon paths are relative to the index URL; validate against the deployment URL this repo uses.
const indexUrl = 'https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USER/dsh-session-delete@main/market/index.json'

if (!Array.isArray(document.plugins) || document.plugins.length === 0) {
  fail('$.plugins', 'must be a non-empty array')
} else {
  const names = new Set()
  document.plugins.forEach((plugin, position) => {
    validatePlugin(plugin, `$.plugins[${String(position)}]`, index, indexUrl)
    if (typeof plugin?.name === 'string') {
      if (names.has(plugin.name)) fail(`$.plugins[${String(position)}].name`, `duplicates ${plugin.name}`)
      names.add(plugin.name)
    }
  })
}

if (failures.length > 0) {
  console.error(`market/index.json is invalid (${failures.length}):`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('market/index.json is a valid format-1 index')
