import { describe, expect, it } from 'vite-plus/test'
import {
  buildMotionLayoutPlan,
  createDefaultMotionLayoutSettings,
  MOTION_LAYOUT_TEMPLATES,
  motionLayoutDepthProperty,
  resolveMotionLayoutFrameSize,
  resolveMotionLayoutSlot,
} from './motion-layout'

describe('motion layout compiler', () => {
  it('fits frame presets inside the project resolution with even dimensions', () => {
    expect(resolveMotionLayoutFrameSize(1920, 1080, '16:9')).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(resolveMotionLayoutFrameSize(1920, 1080, '1:1')).toEqual({
      width: 1080,
      height: 1080,
    })
    expect(resolveMotionLayoutFrameSize(1920, 1080, '4:5')).toEqual({
      width: 864,
      height: 1080,
    })
    expect(resolveMotionLayoutFrameSize(1920, 1080, '9:16')).toEqual({
      width: 608,
      height: 1080,
    })
  })

  it('builds bounded, sorted keyframes for every first-slice template', () => {
    for (const template of MOTION_LAYOUT_TEMPLATES) {
      const slotIds = Array.from(
        { length: Math.max(template.minSlots, template.preferredSlots) },
        (_, index) => `${template.id}-${index}`,
      )
      const plan = buildMotionLayoutPlan({
        templateId: template.id,
        slotIds,
        width: 1920,
        height: 1080,
        fps: 30,
        settings: createDefaultMotionLayoutSettings(template.id),
      })

      expect(plan.slots).toHaveLength(slotIds.length)
      expect(plan.durationInFrames).toBe(Math.round(template.defaultDurationSeconds * 30))
      for (const slot of plan.slots) {
        expect(slot.keyframes.properties.length).toBeGreaterThan(0)
        for (const property of slot.keyframes.properties) {
          const frames = property.keyframes.map((keyframe) => keyframe.frame)
          expect(frames).toEqual([...frames].sort((left, right) => left - right))
          expect(new Set(frames).size).toBe(frames.length)
          expect(frames[0]).toBeGreaterThanOrEqual(0)
          expect(frames.at(-1)).toBeLessThan(plan.durationInFrames)
        }
      }
    }
  })

  it('reveals grid tiles between hidden loop endpoints', () => {
    const plan = buildMotionLayoutPlan({
      templateId: 'grid-reveal',
      slotIds: ['a', 'b', 'c', 'd'],
      width: 1920,
      height: 1080,
      fps: 30,
      settings: createDefaultMotionLayoutSettings('grid-reveal'),
    })
    const slot = plan.slots[0]!

    expect(resolveMotionLayoutSlot(slot, 0).opacity).toBe(0)
    expect(resolveMotionLayoutSlot(slot, Math.round(plan.durationInFrames * 0.5)).opacity).toBe(1)
    expect(resolveMotionLayoutSlot(slot, plan.durationInFrames - 1).opacity).toBe(0)
  })

  it('moves focus between the main panel and the rail', () => {
    const plan = buildMotionLayoutPlan({
      templateId: 'focus-shift',
      slotIds: ['a', 'b', 'c'],
      width: 1920,
      height: 1080,
      fps: 30,
      settings: createDefaultMotionLayoutSettings('focus-shift'),
    })
    const first = plan.slots[0]!
    const second = plan.slots[1]!
    const startFirst = resolveMotionLayoutSlot(first, 0)
    const startSecond = resolveMotionLayoutSlot(second, 0)
    const nextPhaseFrame = Math.round(plan.durationInFrames / 3)
    const nextFirst = resolveMotionLayoutSlot(first, nextPhaseFrame)
    const nextSecond = resolveMotionLayoutSlot(second, nextPhaseFrame)

    expect(startFirst.width).toBeGreaterThan(startSecond.width)
    expect(nextSecond.width).toBeGreaterThan(nextFirst.width)
  })

  it('keeps flat carousel cards opaque while projective cards use depth dimming', () => {
    const carousel = buildMotionLayoutPlan({
      templateId: 'carousel-flow',
      slotIds: ['a', 'b', 'c', 'd', 'e'],
      width: 1920,
      height: 1080,
      fps: 30,
      settings: createDefaultMotionLayoutSettings('carousel-flow'),
    })
    const carouselFrame = Math.round(carousel.durationInFrames * 0.3)
    expect(
      carousel.slots.map((slot) => resolveMotionLayoutSlot(slot, carouselFrame).opacity),
    ).toEqual([1, 1, 1, 1, 1])
    expect(
      carousel.slots.map((slot) => resolveMotionLayoutSlot(slot, carouselFrame).depthDim),
    ).toEqual([0, 0, 0, 0, 0])

    const showcase = buildMotionLayoutPlan({
      templateId: 'showcase-stream',
      slotIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      width: 1920,
      height: 1080,
      fps: 30,
      settings: createDefaultMotionLayoutSettings('showcase-stream'),
    })
    const resolved = showcase.slots.map((slot) => resolveMotionLayoutSlot(slot, 0))
    expect(resolved.every((slot) => slot.opacity === 1)).toBe(true)
    expect(Math.max(...resolved.map((slot) => slot.depthDim))).toBeGreaterThan(0.4)
    expect(
      showcase.slots.some((slot) =>
        slot.keyframes.properties.some(
          (property) => property.property === motionLayoutDepthProperty(slot.itemId),
        ),
      ),
    ).toBe(true)
  })

  it('alternates the visible media set in flip grids', () => {
    const plan = buildMotionLayoutPlan({
      templateId: 'flip-grid',
      slotIds: ['a', 'b', 'c', 'd'],
      width: 1920,
      height: 1080,
      fps: 30,
      settings: createDefaultMotionLayoutSettings('flip-grid'),
    })
    const midpoint = Math.round(plan.durationInFrames * 0.7)

    expect(resolveMotionLayoutSlot(plan.slots[0]!, 0).opacity).toBe(1)
    expect(resolveMotionLayoutSlot(plan.slots[2]!, 0).opacity).toBe(0)
    expect(resolveMotionLayoutSlot(plan.slots[0]!, midpoint).opacity).toBe(0)
    expect(resolveMotionLayoutSlot(plan.slots[2]!, midpoint).opacity).toBeGreaterThan(0.95)
  })
})
