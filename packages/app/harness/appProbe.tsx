// App probe. Served only by tools/native-transport/app-metro.config.cjs in place
// of index.js. It hides development toasts so screenshots show only app screens
// and reports to the local app server:
// - launch: the moment the boot splash is gone, which happens when ChatScreen
//   first draws (the driver compares it with its own launch time);
// - reply: from the user turn appearing to the first reply text, and the
//   interval between text commits while the reply streams;
// - frames: JS frame intervals, every two seconds.
import { LogBox } from 'react-native';
import BootSplash from 'react-native-bootsplash';
import performance from 'react-native-performance';
import '../index';
import { chatView } from '../src/state/appSession';

LogBox.ignoreAllLogs();

const reportUrl = 'http://localhost:8794/harness/report';
type Quantiles = { count: number; p50: number; p95: number; max: number };
type Report =
  | { kind: 'launch' }
  | {
      kind: 'reply';
      status: string;
      firstTextMs: number | null;
      streamMs: number | null;
      chars: number;
      commits: Quantiles;
    }
  | ({ kind: 'frames'; over20: number } & Quantiles);

const post = (body: Report) =>
  void fetch(reportUrl, {
    method: 'POST',
    body: JSON.stringify({ at: Date.now(), ...body }),
  }).catch(() => undefined);

function quantiles(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

function chatStore() {
  try {
    return chatView().store;
  } catch {
    return null;
  }
}

let watching = false;
function watchReplies() {
  const store = chatStore();
  if (!store || watching) return;
  watching = true;
  let sentAt: number | null = null;
  let firstText: number | null = null;
  let lastCommit = 0;
  let lastText = '';
  let commits: number[] = [];
  let users = store.getState().messages.filter(m => m.role === 'user').length;
  store.subscribe(() => {
    const { messages } = store.getState();
    const now = performance.now();
    const userCount = messages.filter(m => m.role === 'user').length;
    if (userCount > users) {
      users = userCount;
      sentAt = now;
      firstText = null;
      lastText = '';
      commits = [];
    }
    const reply = messages.at(-1);
    if (sentAt === null || !reply || reply.role !== 'assistant') return;
    if (reply.text !== lastText) {
      if (firstText === null) firstText = now;
      else commits.push(now - lastCommit);
      lastCommit = now;
      lastText = reply.text;
    }
    if (reply.status !== 'streaming') {
      post({
        kind: 'reply',
        status: reply.status,
        firstTextMs: firstText === null ? null : firstText - sentAt,
        streamMs: firstText === null ? null : lastCommit - firstText,
        chars: reply.text.length,
        commits: quantiles(commits),
      });
      sentAt = null;
    }
  });
}

let launchReported = false;
let intervals: number[] = [];
let last = 0;
let windowStart = Date.now();
function frame(time: number) {
  if (!launchReported && !BootSplash.isVisible()) {
    launchReported = true;
    post({ kind: 'launch' });
  }
  watchReplies();
  if (last) intervals.push(time - last);
  last = time;
  if (Date.now() - windowStart >= 2000) {
    post({
      kind: 'frames',
      ...quantiles(intervals),
      over20: intervals.filter(value => value > 20).length,
    });
    intervals = [];
    windowStart = Date.now();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
