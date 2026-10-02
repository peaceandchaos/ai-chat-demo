import type { ChatRecord } from '../src/state/archive';
import { filterRecents, recentTime } from '../src/state/recents';

const now = new Date(2026, 9, 1, 9, 30).getTime();

test.each([
  ['earlier today', new Date(2026, 9, 1, 0, 5), '0d ago'],
  ['late yesterday', new Date(2026, 8, 30, 23, 55), '1d ago'],
  ['three days ago', new Date(2026, 8, 28, 12), '3d ago'],
  ['six calendar days ago', new Date(2026, 8, 25, 0, 1), '6d ago'],
  ['seven calendar days ago', new Date(2026, 8, 24, 23, 59), 'Sep 24, 2026'],
  ['last year', new Date(2025, 10, 22, 18), 'Nov 22, 2025'],
  ['ahead of this clock', new Date(2026, 9, 2, 8), '0d ago'],
])('a chat updated %s shows "%s"', (_label, updated, shown) => {
  expect(recentTime(updated.getTime(), now)).toBe(shown);
});

const titles = [
  'Explaining the Fourier transform',
  'Weekend trip ideas near Lisbon',
  'Sourdough starter troubleshooting',
  'Who founded Margelo?',
  'Margelo open-source libraries',
];
const chats = titles.map((title, index): ChatRecord => ({
  version: 1,
  id: `00000000-0000-4000-8000-00000000000${index}`,
  title,
  picker: 'auto',
  createdAt: index,
  updatedAt: index,
  basePathId: '00000000-0000-4000-8000-000000000100',
  leafId: '00000000-0000-4000-8000-000000000200',
}));
const shown = (query: string) =>
  filterRecents(chats, query).map(chat => chat.title);

test('an empty or blank search keeps every chat in recents order', () => {
  expect(filterRecents(chats, '')).toBe(chats);
  expect(filterRecents(chats, '   ')).toBe(chats);
});

test('a search keeps the titles that match anywhere, best match first, and tolerates a typo', () => {
  expect(shown('lisbon')).toEqual(['Weekend trip ideas near Lisbon']);
  expect(shown('sourdugh')).toEqual(['Sourdough starter troubleshooting']);
  expect(shown('margelo')).toEqual([
    'Who founded Margelo?',
    'Margelo open-source libraries',
  ]);
  expect(shown('quantum')).toEqual([]);
});
