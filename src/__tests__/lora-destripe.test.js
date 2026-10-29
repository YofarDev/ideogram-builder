// 2026-10-29: built-in MOSS destripe LoRAs (pinned HF revisions) and the
// negative-capable strength slider.
import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

describe('built-in destripe LoRAs', () => {
  it('ships both SFT banding fixes pinned to immutable revisions', async () => {
    const { BUILTIN_LORAS } = await import('../lora-library.js')
    const top64 = BUILTIN_LORAS.find(l => l.id === 'moss-destripe-top64')
    expect(top64).toBeTruthy()
    expect(top64.model).toBe('moss')
    expect(top64.strengths.positive).toBe(1.0)
    expect(top64.source_url).toBe(
      'https://huggingface.co/nynxz/MOSS-Image/resolve/59d3547a788ca6ebc4f5005a82d461904628df26/loras/moss_sft_destripe_top64_bf16.safetensors')

    const kijai = BUILTIN_LORAS.find(l => l.id === 'moss-destripe-blocks')
    expect(kijai).toBeTruthy()
    expect(kijai.model).toBe('moss')
    expect(kijai.strengths.positive).toBe(-0.5)
    expect(kijai.source_url).toBe(
      'https://huggingface.co/Kijai/MOSS-image_experimental/resolve/9869b2855d0921c10ecee0011c88f7b961a736a6/loras/moss_image_sft_lora_blocks_21_to_49_rank_512_bf16.safetensors')
  })

  it('strength slider supports negative values', async () => {
    const { activeCard } = await import('../lora-cards.js')
    const card = activeCard({ id: 'x', label: 'L', strengths: { positive: -0.5 } })
    const range = card.match(/<input[^>]*class="lora-strength-range"[^>]*>/)[0]
    expect(range).toContain('min="-1"')
    expect(range).toContain('value="-0.5"')
  })
})
