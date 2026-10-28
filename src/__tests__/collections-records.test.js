import { expect, it } from 'vitest';
import { normalizeCollections, parseCollectionFile } from '../collections-records.js';

it('recovers valid stored prompts while excluding invalid records and unsafe identifiers', () => {
  const valid = '{"high_level_description":"A fox"}';
  const normalized = normalizeCollections([null, { items: false }, {
    id: '" onmouseover="alert(1)', name: 'Recovered', items: [
      null, { id: 'same', importJson: 5 },
      { id: 'same', importJson: valid, model: 'moss', tokenValues: { subject: 'fox', invalid: false } },
      { id: 'same', importJson: 'A MOSS caption', imageUrl: 'https://untrusted.invalid/image.png' },
    ],
  }], () => 'new-id');
  expect(normalized).toHaveLength(1);
  expect(normalized[0].id).toBe('new-id');
  expect(normalized[0].items).toHaveLength(2);
  expect(normalized[0].items[0]).toMatchObject({ importJson: valid, model: 'ideogram', tokenValues: { subject: 'fox' } });
  expect(normalized[0].items[1]).toMatchObject({ model: 'moss', imageUrl: null });
  const ids = normalized[0].items.map(item => item.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('keeps legacy exports readable and supplies a name when it is missing or malformed', () => {
  const parsed = parseCollectionFile(JSON.stringify({ name: 12, items: [{ importJson: 'Caption' }] }), () => 'fresh');
  expect(parsed.name).toBe('Imported');
  expect(parsed.items[0]).toMatchObject({ id: 'fresh', model: 'moss', importJson: 'Caption' });
});

it('explains invalid JSON without changing the text of valid prompt strings', () => {
  expect(() => parseCollectionFile('{unfinished', () => 'id')).toThrow('not valid JSON');
  const raw = '  {"high_level_description": "two  spaces"}\n';
  expect(parseCollectionFile(JSON.stringify({ items: [{ importJson: raw }] }), () => 'id').items[0].importJson).toBe(raw);
});
