import { describe, expect, it } from 'vitest'
import type { TimelineTrack } from '@/types/timeline'
import { moveTrackInTree } from './reorder-tree'

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

/** Visual order (by resulting `order`) as `id` strings, top-first. */
function orderedIds(tracks: TimelineTrack[]): string[] {
  return [...tracks].sort((a, b) => a.order - b.order).map((t) => t.id)
}

function byId(tracks: TimelineTrack[], id: string) {
  return tracks.find((t) => t.id === id)!
}

describe('moveTrackInTree', () => {
  it('reorders root siblings (drop before)', () => {
    const tracks = [track('a', 0), track('b', 1), track('c', 2)]
    const next = moveTrackInTree(tracks, 'c', { refTrackId: 'a', position: 'before' })
    expect(orderedIds(next)).toEqual(['c', 'a', 'b'])
    expect(byId(next, 'c').parentTrackId).toBeUndefined()
  })

  it('reorders down within a parent, accounting for the removed slot (drop after)', () => {
    const tracks = [track('a', 0), track('b', 1), track('c', 2)]
    const next = moveTrackInTree(tracks, 'a', { refTrackId: 'b', position: 'after' })
    expect(orderedIds(next)).toEqual(['b', 'a', 'c'])
  })

  it('drops a layer into a folder (inside → top of folder, reparented)', () => {
    const tracks = [track('folder', 0, { isGroup: true }), track('a', 1), track('b', 2)]
    const next = moveTrackInTree(tracks, 'a', { refTrackId: 'folder', position: 'inside' })
    expect(byId(next, 'a').parentTrackId).toBe('folder')
    // DFS renumber: folder(0), a(1, its child), b(2)
    expect(orderedIds(next)).toEqual(['folder', 'a', 'b'])
  })

  it('drops a layer out of a folder to the root (after a root sibling)', () => {
    const tracks = [
      track('folder', 0, { isGroup: true }),
      track('child', 1, { parentTrackId: 'folder' }),
      track('b', 2),
    ]
    const next = moveTrackInTree(tracks, 'child', { refTrackId: 'b', position: 'after' })
    expect(byId(next, 'child').parentTrackId).toBeUndefined()
    expect(orderedIds(next)).toEqual(['folder', 'b', 'child'])
  })

  it('refuses to drop a folder into its own descendant', () => {
    const tracks = [
      track('outer', 0, { isGroup: true }),
      track('inner', 1, { isGroup: true, parentTrackId: 'outer' }),
    ]
    expect(moveTrackInTree(tracks, 'outer', { refTrackId: 'inner', position: 'inside' })).toBe(
      tracks,
    )
  })

  it('refuses "inside" a non-folder and is a no-op onto itself', () => {
    const tracks = [track('a', 0), track('b', 1)]
    expect(moveTrackInTree(tracks, 'a', { refTrackId: 'b', position: 'inside' })).toBe(tracks)
    expect(moveTrackInTree(tracks, 'a', { refTrackId: 'a', position: 'before' })).toBe(tracks)
  })
})
