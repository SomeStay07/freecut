import { describe, expect, it } from 'vitest'
import type { ShapeItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  buildLayerTree,
  groupTracksIntoFolder,
  ungroupFolder,
  type LayerTreeFolder,
} from './folder-tree'

function track(id: string, order: number, extra: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id,
    name: id,
    kind: 'video',
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
    ...extra,
  }
}

function layerItem(id: string, trackId: string): TimelineItem {
  return {
    id,
    trackId,
    type: 'shape',
    from: 0,
    durationInFrames: 90,
    label: id,
  } as unknown as ShapeItem
}

describe('buildLayerTree', () => {
  it('orders sibling layers by track order (ascending = top)', () => {
    const tracks = [track('tb', 1), track('ta', 0)]
    const items = [layerItem('b', 'tb'), layerItem('a', 'ta')]
    const tree = buildLayerTree(items, tracks)
    expect(tree.map((n) => (n.type === 'layer' ? n.item.id : n.trackId))).toEqual(['a', 'b'])
  })

  it('nests layers under a group track and skips empty non-group tracks', () => {
    const tracks = [
      track('folder', 0, { isGroup: true }),
      track('child2', 1, { parentTrackId: 'folder' }),
      track('child1', 0, { parentTrackId: 'folder' }),
      track('empty', 5), // no item, not a group -> skipped
    ]
    const items = [layerItem('c1', 'child1'), layerItem('c2', 'child2')]
    const tree = buildLayerTree(items, tracks)

    expect(tree).toHaveLength(1)
    const folder = tree[0] as LayerTreeFolder
    expect(folder.type).toBe('folder')
    expect(folder.children.map((n) => (n.type === 'layer' ? n.item.id : n.trackId))).toEqual([
      'c1',
      'c2',
    ])
  })
})

describe('groupTracksIntoFolder', () => {
  it('wraps members under a new folder at their shared parent, taking the top order', () => {
    const tracks = [track('a', 0), track('b', 1), track('c', 2)]
    const next = groupTracksIntoFolder(tracks, ['b', 'c'], 'folder', 'Group')

    const folder = next.find((t) => t.id === 'folder')!
    expect(folder.isGroup).toBe(true)
    expect(folder.parentTrackId).toBeUndefined()
    expect(folder.order).toBe(1) // topmost member's order
    expect(next.find((t) => t.id === 'b')!.parentTrackId).toBe('folder')
    expect(next.find((t) => t.id === 'c')!.parentTrackId).toBe('folder')
    expect(next.find((t) => t.id === 'a')!.parentTrackId).toBeUndefined()
  })

  it('inherits the shared parent when grouping inside an existing folder', () => {
    const tracks = [
      track('outer', 0, { isGroup: true }),
      track('a', 0, { parentTrackId: 'outer' }),
      track('b', 1, { parentTrackId: 'outer' }),
    ]
    const next = groupTracksIntoFolder(tracks, ['a', 'b'], 'inner', 'Inner')
    expect(next.find((t) => t.id === 'inner')!.parentTrackId).toBe('outer')
  })

  it('is a no-op when no members match', () => {
    const tracks = [track('a', 0)]
    expect(groupTracksIntoFolder(tracks, ['missing'], 'folder', 'Group')).toBe(tracks)
  })
})

describe('ungroupFolder', () => {
  it('reparents children up to the folder parent and drops the folder', () => {
    const tracks = [
      track('folder', 0, { isGroup: true }),
      track('a', 0, { parentTrackId: 'folder' }),
      track('b', 1, { parentTrackId: 'folder' }),
    ]
    const next = ungroupFolder(tracks, 'folder')
    expect(next.find((t) => t.id === 'folder')).toBeUndefined()
    expect(next.find((t) => t.id === 'a')!.parentTrackId).toBeUndefined()
    expect(next.find((t) => t.id === 'b')!.parentTrackId).toBeUndefined()
  })

  it('raises a nested folder one level intact', () => {
    const tracks = [
      track('outer', 0, { isGroup: true }),
      track('inner', 0, { isGroup: true, parentTrackId: 'outer' }),
      track('leaf', 0, { parentTrackId: 'inner' }),
    ]
    const next = ungroupFolder(tracks, 'outer')
    expect(next.find((t) => t.id === 'inner')!.parentTrackId).toBeUndefined()
    expect(next.find((t) => t.id === 'leaf')!.parentTrackId).toBe('inner')
  })
})
