import { describe, it, expect } from 'vitest'
import { detectPromptFormat, ideogramGlobalsToMoss, mossGlobalsToIdeogram } from '../prompt-convert.js'

const IDEOGRAM_JSON = JSON.stringify({
  high_level_description: 'A sunset',
  style_description: { aesthetics: 'warm' },
  compositional_deconstruction: { background: 'mountains', elements: [] },
})

const MOSS_COMPILED = JSON.stringify({
  summary: { caption: 'A poster', meta: ['poster'], canvas: 'single' },
  items: [{ label: 'object', caption: 'd', bbox: [-256, -256, 256, 256] }],
  bbox_coord_space: 'abs_centralized',
  bbox_format: 'yxyx',
})

const MOSS_DRAFT = JSON.stringify({
  width: 1024,
  height: 1024,
  bbox_coord_space: 'abs',
  bbox_format: 'xyxy',
  summary: { caption: 'A poster', meta: ['poster'] },
  items: [{ label: 'object', caption: 'd', bbox: [256, 256, 768, 768] }],
})

describe('detectPromptFormat', () => {
  it('detects ideogram JSON', () => {
    expect(detectPromptFormat(IDEOGRAM_JSON)).toBe('ideogram')
  })

  it('detects compiled MOSS layout', () => {
    expect(detectPromptFormat(MOSS_COMPILED)).toBe('moss')
  })

  it('detects captioner MOSS draft', () => {
    expect(detectPromptFormat(MOSS_DRAFT)).toBe('moss-draft')
  })

  it('plain text → caption', () => {
    expect(detectPromptFormat('A red fox in snow')).toBe('caption')
  })

  it('whitespace-only → empty', () => {
    expect(detectPromptFormat('')).toBe('empty')
    expect(detectPromptFormat('   \n ')).toBe('empty')
  })

  it('other JSON falls through to caption', () => {
    expect(detectPromptFormat('{"foo":1}')).toBe('caption')
  })
})

describe('ideogramGlobalsToMoss', () => {
  it('joins hld + background into caption, splits/trims aesthetics into meta', () => {
    expect(ideogramGlobalsToMoss({
      high_level_description: 'A sunset',
      background: 'mountains',
      medium: 'photograph',
      aesthetics: ' warm , cinematic ',
      lighting: 'golden hour',
      photo: 'portrait',
    })).toEqual({
      caption: 'A sunset mountains',
      meta: ['photograph', 'warm', 'cinematic', 'golden hour', 'portrait'],
    })
  })

  it('uses art_style when photo is empty (art mode)', () => {
    expect(ideogramGlobalsToMoss({
      high_level_description: 'A poster',
      background: '',
      medium: 'illustration',
      aesthetics: 'flat',
      lighting: '',
      photo: '',
      art_style: 'flat vector',
    })).toEqual({
      caption: 'A poster',
      meta: ['illustration', 'flat', 'flat vector'],
    })
  })

  it('drops empty fields entirely', () => {
    expect(ideogramGlobalsToMoss({ high_level_description: 'Only hld' })).toEqual({
      caption: 'Only hld',
      meta: [],
    })
  })
})

describe('mossGlobalsToIdeogram', () => {
  it('recovers a known medium, remaining tags become aesthetics', () => {
    expect(mossGlobalsToIdeogram({ caption: 'A poster', meta: ['poster', 'illustration', 'flat'] })).toEqual({
      high_level_description: 'A poster',
      medium: 'illustration',
      aesthetics: 'poster, flat',
    })
  })

  it('no known medium → empty medium, all tags in aesthetics', () => {
    expect(mossGlobalsToIdeogram({ caption: 'cap', meta: ['poster', 'dark'] })).toEqual({
      high_level_description: 'cap',
      medium: '',
      aesthetics: 'poster, dark',
    })
  })

  it('empty meta → empty fields', () => {
    expect(mossGlobalsToIdeogram({ caption: 'cap', meta: [] })).toEqual({
      high_level_description: 'cap',
      medium: '',
      aesthetics: '',
    })
  })
})

describe('converter round trip', () => {
  it('ideogram → moss → ideogram keeps caption and known medium', () => {
    const moss = ideogramGlobalsToMoss({
      high_level_description: 'A lake at dawn',
      background: 'misty pines',
      medium: 'illustration',
      aesthetics: 'calm',
      lighting: 'soft light',
      art_style: 'watercolor',
    })
    const back = mossGlobalsToIdeogram(moss)
    expect(back.high_level_description).toBe('A lake at dawn misty pines')
    expect(back.medium).toBe('illustration')
    expect(back.aesthetics).toBe('calm, soft light, watercolor')
  })
})
