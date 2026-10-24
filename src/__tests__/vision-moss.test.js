import { describe, it, expect } from 'vitest'
import { visionToMoss } from '../vision-moss.js'

const IDEOGRAM_JSON = {
  high_level_description: 'A snowy street',
  style_description: {
    aesthetics: 'calm, muted',
    lighting: 'dusk',
    medium: 'illustration',
    art_style: 'watercolor',
    color_palette: ['#AABBCC'],
  },
  compositional_deconstruction: { background: 'quiet town', elements: [] },
}

describe('visionToMoss', () => {
  it('converts Ideogram globals into a moss state:loaded payload', () => {
    expect(visionToMoss(IDEOGRAM_JSON)).toEqual({
      caption: 'A snowy street quiet town',
      meta: ['illustration', 'calm', 'muted', 'dusk', 'watercolor'],
      canvas: '',
      palette: ['#AABBCC'],
    })
  })

  it('tolerates missing style_description entirely', () => {
    expect(visionToMoss({ high_level_description: 'x' })).toEqual({
      caption: 'x',
      meta: [],
      canvas: '',
      palette: [],
    })
  })
})
