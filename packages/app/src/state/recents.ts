import Fuse from 'fuse.js';
import type { ChatRecord } from './archive';

export type Recent = { id: string; title: string; time: string };

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const dayMs = 24 * 60 * 60 * 1000;
const startOfDay = (time: number): number => {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

// The two shapes the Recents rows already show: calendar days for the last
// week ("3d ago"), then the date ("Nov 22, 2025").
export function recentTime(updatedAt: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(updatedAt)) / dayMs);
  if (days < 7) return `${Math.max(0, days)}d ago`;
  const date = new Date(updatedAt);
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function filterRecents(
  chats: ChatRecord[],
  query: string,
): ChatRecord[] {
  const trimmed = query.trim();
  if (!trimmed) return chats;
  return new Fuse(chats, {
    keys: ['title'],
    ignoreLocation: true,
    threshold: 0.4,
  })
    .search(trimmed)
    .map(result => result.item);
}
