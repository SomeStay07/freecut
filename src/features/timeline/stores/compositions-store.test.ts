import { createDefaultMotionLayoutSettings } from '../utils/motion-layout'
import {
  getLibraryVisibleCompositions,
  useCompositionsStore,
  type SubComposition,
} from './compositions-store'

function makeComposition(id: string, name = id): SubComposition {
  return {
    id,
    name,
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 180,
  }
}

describe('composition ownership', () => {
  beforeEach(() => {
    useCompositionsStore.getState().setCompositions([])
  })

  it('infers managed Motion Layout slots in legacy projects and hides them from the library', () => {
    const slot = makeComposition('slot-a', 'Source A')
    const parent: SubComposition = {
      ...makeComposition('layout-a', 'Motion Layout · Grid Reveal'),
      motionLayout: {
        templateId: 'grid-reveal',
        templateVersion: 1,
        settings: createDefaultMotionLayoutSettings('grid-reveal'),
        slotOrder: [slot.id],
        slots: [{ id: 'binding-a', compositionId: slot.id, label: slot.name }],
      },
    }
    const ordinary = makeComposition('compound-a', 'Compound A')

    useCompositionsStore.getState().setCompositions([parent, slot, ordinary])

    expect(useCompositionsStore.getState().getComposition(parent.id)).toMatchObject({
      assetRole: 'motion-layout',
      libraryVisibility: 'visible',
    })
    expect(useCompositionsStore.getState().getComposition(slot.id)).toMatchObject({
      assetRole: 'motion-slot',
      libraryVisibility: 'managed',
      managedBy: {
        kind: 'motion-layout-slot',
        ownerCompositionId: parent.id,
        slotId: 'binding-a',
      },
    })
    expect(
      getLibraryVisibleCompositions(useCompositionsStore.getState().compositions).map(
        (composition) => composition.id,
      ),
    ).toEqual([parent.id, ordinary.id])
  })

  it('promotes a managed slot when its owner no longer exists', () => {
    const slot = makeComposition('slot-a', 'Source A')
    const parent: SubComposition = {
      ...makeComposition('layout-a'),
      motionLayout: {
        templateId: 'grid-reveal',
        templateVersion: 1,
        settings: createDefaultMotionLayoutSettings('grid-reveal'),
        slots: [{ id: 'binding-a', compositionId: slot.id, label: slot.name }],
      },
    }
    useCompositionsStore.getState().setCompositions([parent, slot])

    useCompositionsStore.getState().removeComposition(parent.id)

    expect(useCompositionsStore.getState().getComposition(slot.id)).toMatchObject({
      assetRole: 'compound',
      libraryVisibility: 'visible',
      managedBy: undefined,
    })
  })
})
