/**
 * Decompose a Lottie ("bodymovin") document into editable FreeCut timeline
 * items — the inverse of `../export/build-lottie-document.ts`.
 *
 * Shape (`ty:4`) and text (`ty:5`) layers become one `ShapeItem`/`TextItem`
 * each, on its own track; precomp (`ty:0`) layers become folder tracks
 * (`isGroup`) whose asset layers recurse as children. Track `order` is a global
 * DFS pre-order index (lower = rendered on top), matching the creator's z-order
 * convention. The output plugs directly into a `kind:'lottie'` sub-composition's
 * `items`/`tracks`/`keyframes`.
 *
 * This targets the vector subset FreeCut itself emits, so a document produced by
 * the exporter round-trips into editable layers. Features outside that subset
 * (image/solid layers, gradients, mattes, non-identity precomp transforms) are
 * skipped or approximated and reported in `warnings`.
 */
import type { ItemKeyframes, PropertyKeyframes } from '@/types/keyframe'
import type { ShapeItem, TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { DEFAULT_TRACK_HEIGHT } from '@/shared/timeline/defaults'
import {
  staticVec,
  type ReaderAsset,
  type ReaderDocument,
  type ReaderLayer,
} from './lottie-reader-schema'
import { invertShape } from './shape-from-lottie'
import { invertText } from './text-from-lottie'
import { invertTransform } from './transform-from-lottie'
import type { LottieImportWarning } from './warnings'

export interface DecomposedLottieScene {
  name: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  tracks: TimelineTrack[]
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
  warnings: LottieImportWarning[]
}

export interface DecomposeOptions {
  /** Injectable id factory (tests pass a deterministic counter). */
  makeId?: () => string
}

interface WalkContext {
  centerX: number
  centerY: number
  makeId: () => string
  warnings: LottieImportWarning[]
  tracks: TimelineTrack[]
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
  assetsById: Map<string, ReaderAsset>
  orderRef: { n: number }
}

function newTrack(id: string, name: string, order: number, parentTrackId?: string): TimelineTrack {
  return {
    id,
    name,
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
    ...(parentTrackId ? { parentTrackId } : {}),
  }
}

function pushKeyframes(ctx: WalkContext, itemId: string, properties: PropertyKeyframes[]): void {
  if (properties.length > 0) ctx.keyframes.push({ itemId, properties })
}

/** A layer's timing: `from` = in-point, duration = span. Creator layers are ip:0. */
function layerTiming(layer: ReaderLayer): { from: number; durationInFrames: number } {
  const ip = layer.ip ?? 0
  const op = layer.op ?? ip + 1
  return { from: ip, durationInFrames: Math.max(1, Math.round(op - ip)) }
}

function buildShapeLayer(
  layer: ReaderLayer,
  parentTrackId: string | undefined,
  ctx: WalkContext,
): void {
  const name = layer.nm || 'Shape'
  const shape = invertShape(layer.shapes, name, ctx.warnings)
  const anchor = staticVec(layer.ks?.a) ?? [shape.width / 2, shape.height / 2]
  const anchorX = anchor[0] ?? shape.width / 2
  const anchorY = anchor[1] ?? shape.height / 2
  const { from, durationInFrames } = layerTiming(layer)

  const inverted = invertTransform({
    ks: layer.ks ?? {},
    // Anchor-origin (Lottie) → center-origin (FreeCut), plus a path's bbox origin.
    offsetX: ctx.centerX - shape.width / 2 + anchorX - shape.originX,
    offsetY: ctx.centerY - shape.height / 2 + anchorY - shape.originY,
    width: shape.width,
    height: shape.height,
    anchorX,
    anchorY,
    itemFrom: from,
    makeId: ctx.makeId,
    warnings: ctx.warnings,
    layerName: name,
  })

  const trackId = ctx.makeId()
  ctx.tracks.push(newTrack(trackId, name, ctx.orderRef.n++, parentTrackId))

  const itemId = ctx.makeId()
  const item: ShapeItem = {
    id: itemId,
    trackId,
    type: 'shape',
    from,
    durationInFrames,
    label: name,
    transform: inverted.transform,
    ...shape.fields,
  }
  ctx.items.push(item)
  pushKeyframes(ctx, itemId, inverted.properties)
}

function buildTextLayer(
  layer: ReaderLayer,
  parentTrackId: string | undefined,
  ctx: WalkContext,
): void {
  const name = layer.nm || 'Text'
  const text = invertText(layer)
  const { from, durationInFrames } = layerTiming(layer)

  const inverted = invertTransform({
    ks: layer.ks ?? {},
    // Text origin is the baseline; the exporter offsets by the comp center and a
    // baseline nudge, with anchor at [0,0].
    offsetX: ctx.centerX,
    offsetY: ctx.centerY + text.baselineAdjust,
    width: text.width,
    height: text.height,
    anchorX: 0,
    anchorY: 0,
    itemFrom: from,
    makeId: ctx.makeId,
    warnings: ctx.warnings,
    layerName: name,
  })

  const trackId = ctx.makeId()
  ctx.tracks.push(newTrack(trackId, name, ctx.orderRef.n++, parentTrackId))

  const itemId = ctx.makeId()
  const item: TextItem = {
    id: itemId,
    trackId,
    type: 'text',
    from,
    durationInFrames,
    label: name,
    text: text.text,
    color: text.color,
    fontSize: text.fontSize,
    transform: inverted.transform,
  }
  ctx.items.push(item)
  pushKeyframes(ctx, itemId, inverted.properties)
}

function isIdentityPrecompTransform(layer: ReaderLayer): boolean {
  const ks = layer.ks
  if (!ks) return true
  const p = staticVec(ks.p)
  const a = staticVec(ks.a)
  const s = staticVec(ks.s)
  const near = (v: number | undefined, target: number): boolean =>
    Math.abs((v ?? target) - target) < 0.5
  return (
    near(p?.[0], 0) &&
    near(p?.[1], 0) &&
    near(a?.[0], 0) &&
    near(a?.[1], 0) &&
    near(s?.[0], 100) &&
    near(s?.[1], 100)
  )
}

function walkLayers(
  layers: ReaderLayer[],
  parentTrackId: string | undefined,
  seenAssets: ReadonlySet<string>,
  ctx: WalkContext,
): void {
  for (const layer of layers) {
    switch (layer.ty) {
      case 0: {
        const asset = layer.refId ? ctx.assetsById.get(layer.refId) : undefined
        if (!asset) {
          ctx.warnings.push({
            code: 'missing-asset',
            message: `Group "${layer.nm ?? layer.refId ?? '?'}" references a missing precomp; skipped.`,
          })
          break
        }
        if (asset.id && seenAssets.has(asset.id)) {
          ctx.warnings.push({
            code: 'missing-asset',
            message: `Group "${layer.nm ?? asset.id}" is recursively nested; skipped to avoid a cycle.`,
          })
          break
        }
        if (!isIdentityPrecompTransform(layer)) {
          ctx.warnings.push({
            code: 'precomp-transform-dropped',
            message: `Group "${layer.nm ?? 'Group'}" has a transform on the group itself; it was flattened to identity.`,
          })
        }
        const trackId = ctx.makeId()
        ctx.tracks.push({
          ...newTrack(trackId, layer.nm || 'Group', ctx.orderRef.n++, parentTrackId),
          isGroup: true,
        })
        const nextSeen = asset.id ? new Set(seenAssets).add(asset.id) : seenAssets
        walkLayers(asset.layers ?? [], trackId, nextSeen, ctx)
        break
      }
      case 4:
        buildShapeLayer(layer, parentTrackId, ctx)
        break
      case 5:
        buildTextLayer(layer, parentTrackId, ctx)
        break
      default:
        ctx.warnings.push({
          code: 'unsupported-layer-type',
          message: `Layer "${layer.nm ?? '?'}" (type ${layer.ty ?? '?'}) isn't an editable shape/text/group and was skipped.`,
        })
    }
  }
}

export function decomposeLottieDocument(
  input: unknown,
  options?: DecomposeOptions,
): DecomposedLottieScene {
  const doc = (input ?? {}) as ReaderDocument
  const makeId = options?.makeId ?? (() => crypto.randomUUID())
  const width = doc.w ?? 512
  const height = doc.h ?? 512
  const fps = doc.fr ?? 30
  const ip = doc.ip ?? 0
  const durationInFrames = Math.max(1, Math.round((doc.op ?? ip + fps * 3) - ip))
  const name = doc.nm ?? 'Lottie'

  const assetsById = new Map<string, ReaderAsset>()
  for (const asset of doc.assets ?? []) {
    // Only precomp assets (those with a `layers` array) are relevant here.
    if (asset.id && Array.isArray(asset.layers)) assetsById.set(asset.id, asset)
  }

  const ctx: WalkContext = {
    centerX: width / 2,
    centerY: height / 2,
    makeId,
    warnings: [],
    tracks: [],
    items: [],
    keyframes: [],
    assetsById,
    orderRef: { n: 0 },
  }

  walkLayers(doc.layers ?? [], undefined, new Set(), ctx)

  if (ctx.items.length === 0) {
    ctx.warnings.push({
      code: 'empty-document',
      message: 'No editable shape or text layers were found in this Lottie.',
    })
  }

  return {
    name,
    width,
    height,
    fps,
    durationInFrames,
    tracks: ctx.tracks,
    items: ctx.items,
    keyframes: ctx.keyframes,
    warnings: ctx.warnings,
  }
}
