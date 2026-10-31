// lora-library.js — LoRA library data: built-in Ideogram and MOSS entries plus
// user entries persisted to localStorage. Data only; lora.js owns the panel DOM.

export const BUILTIN_LORAS = [
  {
    id: 'kiki-v2',
    label: 'Kiki (Studio Ghibli)',
    model: 'ideogram',
    filename: 'kiki_ideogram4_v2.safetensors',
    source_url: 'https://huggingface.co/Yofardev/kiki_ideogram4_v2/resolve/main/kiki_ideogram4_v2.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'naoki-urasawa-v1',
    label: 'Naoki Urasawa',
    model: 'ideogram',
    filename: 'naoki_urasawa_ideogram4_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/naoki_urasawa_ideogram4_v1/resolve/main/naoki_urasawa_ideogram4_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'tintin-v1',
    label: 'Tintin (v1)',
    model: 'ideogram',
    filename: 'tintin_v3.safetensors',
    source_url: 'https://huggingface.co/Yofardev/tintin_id4_v3/resolve/main/tintin_v3.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'tintin-v2',
    label: 'Tintin v2 (final)',
    model: 'ideogram',
    filename: 'tintin_id4_v2.safetensors',
    source_url: 'https://huggingface.co/Yofardev/tintin_id4_v2/resolve/main/tintin_id4_v2.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'tuniques-bleues-v1',
    label: 'Les Tuniques Bleues (v1)',
    model: 'ideogram',
    filename: 'tuniques_id4_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/tuniques_bleues_id4_v1/resolve/main/tuniques_id4_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'tuniques-bleues-v1-5000',
    label: 'Les Tuniques Bleues (v1, 5000 steps)',
    model: 'ideogram',
    filename: 'tuniques_id4_v1_000005000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/tuniques_bleues_id4_v1/resolve/main/tuniques_id4_v1_000005000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'yofardev-v1',
    label: 'Yofardev (v1)',
    model: 'ideogram',
    filename: 'yofardev_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/yofardev_id4_v1/resolve/main/yofardev_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'test-mil-v1-final',
    label: 'Test Mil v1 (final)',
    model: 'ideogram',
    filename: 'test_mil_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/test_mil_v1/resolve/main/test_mil_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'retro-pokemon-v1',
    label: 'Retro Pokémon (v1)',
    model: 'ideogram',
    filename: 'retro_pokémon_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/retro_pokemon_id4_v1/resolve/main/retro_pok%C3%A9mon_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-v1',
    label: 'Ovi Style (v1)',
    model: 'ideogram',
    filename: 'ovi_style_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-5k',
    label: 'Berserk (5k)',
    model: 'ideogram',
    filename: 'berserk_id4_v1_000005000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/berserk_id4_v1_000005000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'retro-anime-id4-v1',
    label: 'Retro Anime (v1, final)',
    model: 'ideogram',
    filename: 'retro_anime_id4_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/retro_anime_id4_v1/resolve/main/retro_anime_id4_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'retro-anime-id4-v1-1500',
    label: 'Retro Anime (v1, 1500 steps)',
    model: 'ideogram',
    filename: 'retro_anime_id4_v1_000001500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/retro_anime_id4_v1/resolve/main/retro_anime_id4_v1_000001500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'retro-anime-id4-v1-3000',
    label: 'Retro Anime (v1, 3000 steps)',
    model: 'ideogram',
    filename: 'retro_anime_id4_v1_000003000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/retro_anime_id4_v1/resolve/main/retro_anime_id4_v1_000003000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'yofardev-moss-v1',
    label: 'Yofardev (v1) — MOSS',
    model: 'moss',
    filename: 'user/moss/yofardev_moss_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/yofardev_moss_v1/resolve/main/yofardev_moss_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'kiki-ghibli-style-moss',
    label: 'Kiki Ghibli Style — MOSS',
    model: 'moss',
    filename: 'user/moss/kiki_ghibli_style_moss.safetensors',
    source_url: 'https://huggingface.co/Yofardev/kiki_ghibli_style_moss/resolve/main/kiki_ghibli_style_moss.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'kiki-ghibli-style-moss-epoch20',
    label: 'Kiki Ghibli Style — MOSS (epoch 20)',
    model: 'moss',
    filename: 'user/moss/kiki_ghibli_style_moss_epoch20.safetensors',
    source_url: 'https://huggingface.co/Yofardev/kiki_ghibli_style_moss_epoch20/resolve/main/kiki_ghibli_style_moss_epoch20.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  // SFT vertical-banding fixes (guide §10). Opt-in per request, SFT only.
  // top64: strength 1 around ≤768², up to 1.5 at ~1024² (author guidance).
  {
    id: 'moss-destripe-top64',
    label: 'SFT Destripe (top64, 1.9 MB) — MOSS',
    model: 'moss',
    filename: 'user/moss/moss_sft_destripe_top64_bf16.safetensors',
    source_url: 'https://huggingface.co/nynxz/MOSS-Image/resolve/59d3547a788ca6ebc4f5005a82d461904628df26/loras/moss_sft_destripe_top64_bf16.safetensors',
    strengths: { positive: 1.0, unconditional: 0.0 },
  },
  // Kijai block reversion, referenced by the official Comfy-Org template:
  // negative −0.5 strength (the slider supports negatives for this reason).
  {
    id: 'moss-destripe-blocks',
    label: 'SFT DeBand blocks 21–49 (Kijai) — MOSS',
    model: 'moss',
    filename: 'user/moss/moss_image_sft_lora_blocks_21_to_49_rank_512_bf16.safetensors',
    source_url: 'https://huggingface.co/Kijai/MOSS-image_experimental/resolve/9869b2855d0921c10ecee0011c88f7b961a736a6/loras/moss_image_sft_lora_blocks_21_to_49_rank_512_bf16.safetensors',
    strengths: { positive: -0.5, unconditional: 0.0 },
  },
  {
    id: 'urasawa-moss-further-epoch12',
    label: 'Naoki Urasawa (further, epoch 12) — MOSS',
    model: 'moss',
    filename: 'user/moss/urasawa_moss_further_epoch12.safetensors',
    source_url: 'https://huggingface.co/Yofardev/urasawa_moss_further_epoch12/resolve/main/urasawa_moss_further_epoch12.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
];

/** User-added entries: [{ id, label, filename, source_url, model, strengths }] */
export function loadUserLoras() {
  try {
    const raw = JSON.parse(localStorage.getItem('ideogram_loras_user') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveUserLoras(entries) {
  localStorage.setItem('ideogram_loras_user', JSON.stringify(entries));
}
