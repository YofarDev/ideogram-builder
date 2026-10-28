import { describe, expect, it, vi } from 'vitest'
import { buildGalleryCard, describeItem } from '../gallery-cards.js'

describe('gallery card metadata', () => {
  it('reads MOSS and Ideogram descriptions, captions, and missing prompts', () => {
    expect(describeItem({ prompt_json: '{"summary":{"caption":"A fox"}}' })).toMatchObject({ description: 'A fox', model: 'moss' })
    expect(describeItem({ prompt_json: '{"high_level_description":"A cat"}' })).toMatchObject({ description: 'A cat', model: 'ideogram' })
    expect(describeItem({ prompt_json: 'A simple caption', meta: { model: 'moss' } })).toMatchObject({ description: 'A simple caption', model: 'moss' })
    expect(describeItem({ prompt_json: '' }).description).toBe('No prompt saved')
    expect(describeItem({ prompt_json: 'null' }).description).toBe('null')
  })

  it('escapes prompts and encodes filenames without injecting markup', () => {
    const description = '<img src=x onerror="alert(1)">'
    const card = buildGalleryCard({ img: 'a #1.png', mtime: 1, prompt_json: JSON.stringify({ high_level_description: description }) }, { load: vi.fn(), remove: vi.fn() })
    expect(card.querySelectorAll('img')).toHaveLength(1)
    expect(card.querySelector('.gallery-card-prompt').textContent).toBe(description)
    expect(card.querySelector('img').getAttribute('src')).toContain('a%20%231.png')
    expect(card.querySelector('.gallery-card-open').getAttribute('aria-label')).toContain(description)
  })
})
