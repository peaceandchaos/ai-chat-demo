// App probe. Served only by tools/native-transport/app-metro.config.cjs in place
// of index.js. It hides development toasts so screenshots show only app screens,
// and reports JS frame intervals to the local app server every two seconds.
import { LogBox } from 'react-native';
import '../index';

LogBox.ignoreAllLogs();

const reportUrl = 'http://localhost:8794/harness/report';
let intervals: number[] = [];
let last = 0;
let windowStart = Date.now();

function frame(time: number) {
  if (last) intervals.push(time - last);
  last = time;
  if (Date.now() - windowStart >= 2000) {
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    void fetch(reportUrl, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'frames',
        at: Date.now(),
        frames: sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        max: at(1),
        over20: sorted.filter(value => value > 20).length,
      }),
    }).catch(() => undefined);
    intervals = [];
    windowStart = Date.now();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
