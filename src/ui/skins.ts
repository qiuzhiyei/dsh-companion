/**
 * dsh-companion — 皮肤系统。
 *
 * 皮肤 = `assets/skins/<name>/` 目录 + manifest.json。新增皮肤只需放入目录
 * 并在 Settings/Config 里改 skin 字段；缺状态资源按 PET_STATE_FALLBACK 回退。
 * 资源支持 svg/png/gif/webp（svg 可内嵌动画，第一版无需二进制图）。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PET_STATE_FALLBACK, PET_STATES } from '../types.js'
import type { PetState } from '../types.js'

/** 默认皮肤（下拉排序时永远第一位）。 */
const DEFAULT_SKIN = 'whale'

/** 互动反应帧：pat=抚摸 / angry=生气 / dizzy=晕头 / drag=被拎起。
 *  manifest 可选段，缺帧的皮肤页面自动退回纯 CSS 动画。 */
export const PET_REACTIONS = ['pat', 'angry', 'dizzy', 'drag'] as const
export type PetReaction = (typeof PET_REACTIONS)[number]

export interface SkinStateAsset {
  file: string
  /** 缺省回退状态（由解析器填写）。 */
  fallbackFor?: PetState
}

export interface SkinManifest {
  name: string
  displayName: string
  author?: string
  version?: string
  /** 皮肤人设文案（按状态覆盖默认中性文案；如 whale 的鲸鱼娘人设）。 */
  labels?: Partial<Record<PetState, string>>
  states: Partial<Record<PetState, { file: string }>>
  /** 互动反应帧（可选）：抚摸/生气/晕头/被拎起时临时整图替换。 */
  reactions?: Partial<Record<PetReaction, { file: string }>>
}

export interface Skin {
  name: string
  displayName: string
  dir: string
  manifest: SkinManifest
  /** 已解析（含回退）的状态 → 文件名。 */
  resolved: Partial<Record<PetState, string>>
  /** 已解析的反应帧 → 文件名（只含真实存在的帧，无回退链）。 */
  resolvedReactions: Partial<Record<PetReaction, string>>
}

export interface SkinInfo {
  name: string
  displayName: string
  states: string[]
  /** 可用反应帧名（空数组 = 页面退回纯 CSS 互动动画）。 */
  reactions: string[]
}

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.apng': 'image/apng',
}

export function contentTypeFor(file: string): string {
  const dot = file.lastIndexOf('.')
  const ext = dot < 0 ? '' : file.slice(dot).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** 插件包根（dist/ui/ → ../../）。安装进 profile 后同样成立（files 含 assets）。 */
export function defaultSkinsRoot(): string {
  return fileURLToPath(new URL('../../assets/skins', import.meta.url))
}

export class SkinRegistry {
  private readonly cache = new Map<string, Skin | null>()

  constructor(private readonly root: string = defaultSkinsRoot()) {}

  /** 列出可用皮肤（扫描目录 + manifest；坏目录跳过不炸）。默认皮肤排最前。 */
  async list(): Promise<SkinInfo[]> {
    let entries: Array<{ isDirectory: () => boolean; name: string }>
    try {
      entries = await readdir(this.root, { withFileTypes: true })
    } catch {
      return []
    }
    const skins: SkinInfo[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skin = await this.load(entry.name)
      if (skin) {
        skins.push({
          name: skin.name,
          displayName: skin.displayName,
          states: PET_STATES.filter((state) => skin.resolved[state] !== undefined),
          reactions: PET_REACTIONS.filter((r) => skin.resolvedReactions[r] !== undefined),
        })
      }
    }
    // 默认皮肤（whale 鲸鱼娘）第一位，其余按名字排序。
    skins.sort((a, b) => {
      if (a.name === DEFAULT_SKIN) return -1
      if (b.name === DEFAULT_SKIN) return 1
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    return skins
  }

  /** 解析一个皮肤（带缓存；不存在返回 null）。 */
  async load(name: string): Promise<Skin | null> {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return null
    if (this.cache.has(name)) return this.cache.get(name) ?? null
    const skin = await this.loadUncached(name)
    this.cache.set(name, skin)
    return skin
  }

  /** 状态资源绝对路径（含回退链解析；无资源返回 null）。 */
  async stateAssetPath(name: string, state: PetState): Promise<string | null> {
    const skin = await this.load(name)
    if (!skin) return null
    const file = skin.resolved[state] ?? skin.resolved[PET_STATE_FALLBACK[state]]
    if (!file) return null
    return join(skin.dir, file)
  }

  /** 读取状态资源字节；不存在返回 null。 */
  async readStateAsset(
    name: string,
    state: PetState,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const path = await this.stateAssetPath(name, state)
    if (!path) return null
    try {
      const body = await readFile(path)
      return { body, contentType: contentTypeFor(path) }
    } catch {
      return null
    }
  }

  /** 反应帧资源绝对路径（无回退链；缺帧返回 null）。 */
  async reactionAssetPath(name: string, reaction: string): Promise<string | null> {
    const skin = await this.load(name)
    if (!skin) return null
    const file = skin.resolvedReactions[reaction as PetReaction]
    if (!file) return null
    return join(skin.dir, file)
  }

  /** 读取反应帧资源字节；不存在返回 null。 */
  async readReactionAsset(
    name: string,
    reaction: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const path = await this.reactionAssetPath(name, reaction)
    if (!path) return null
    try {
      const body = await readFile(path)
      return { body, contentType: contentTypeFor(path) }
    } catch {
      return null
    }
  }

  invalidate(): void {
    this.cache.clear()
  }

  private async loadUncached(name: string): Promise<Skin | null> {
    const dir = resolvePath(this.root, name)
    let manifest: SkinManifest
    try {
      const dirStat = await stat(dir)
      if (!dirStat.isDirectory()) return null
      manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as SkinManifest
    } catch {
      return null
    }
    if (!manifest || typeof manifest !== 'object' || !manifest.states) return null
    const resolved: Partial<Record<PetState, string>> = {}
    for (const state of PET_STATES) {
      const declared = manifest.states[state]?.file
      if (typeof declared === 'string' && declared.length > 0) {
        // 文件名安全：只允许皮肤目录内的相对文件名。
        if (/[\\/]|\.\./.test(declared)) continue
        try {
          await stat(join(dir, declared))
          resolved[state] = declared
        } catch {
          // 声明了但文件缺失：走回退。
        }
      }
    }
    // 回退链：缺的状态指向回退目标的文件。
    for (const state of PET_STATES) {
      if (resolved[state] !== undefined) continue
      let target: PetState | null = PET_STATE_FALLBACK[state]
      while (target) {
        const file = resolved[target]
        if (file !== undefined) {
          resolved[state] = file
          break
        }
        target = PET_STATE_FALLBACK[target]
      }
    }
    // 反应帧（可选）：与状态帧同样校验（文件名安全 + 文件存在），无回退链。
    const resolvedReactions: Partial<Record<PetReaction, string>> = {}
    for (const reaction of PET_REACTIONS) {
      const declared = manifest.reactions?.[reaction]?.file
      if (typeof declared !== 'string' || declared.length === 0) continue
      if (/[\\/]|\.\./.test(declared)) continue
      try {
        await stat(join(dir, declared))
        resolvedReactions[reaction] = declared
      } catch {
        // 声明了但文件缺失：视为无反应帧，页面退回纯 CSS 动画。
      }
    }
    return {
      name,
      displayName: manifest.displayName ?? name,
      dir,
      manifest,
      resolved,
      resolvedReactions,
    }
  }
}
