import assert from 'node:assert/strict';
import { InitialLoadTracker, phraseAt } from '../game/loading';

assert.equal(phraseAt(['A', 'B', 'C'], 0, 2), 'A');
assert.equal(phraseAt(['A', 'B', 'C'], 2, 2), 'B');
assert.equal(phraseAt(['A', 'B', 'C'], 6, 2), 'A');
assert.equal(phraseAt([], 99, 0), 'Loading condo…');
assert.equal(phraseAt(['A', 'B'], -4, 0), 'A');

const tracker = new InitialLoadTracker();
const seen: string[] = [];
tracker.subscribe((p) => seen.push(`${p.settled}/${p.started}:${p.sealed}:${p.complete}`));
let resolveA!: () => void;
let rejectB!: (reason: Error) => void;
const a = tracker.track(new Promise<void>((resolve) => { resolveA = resolve; }));
const b = tracker.track(new Promise<void>((_resolve, reject) => { rejectB = reject; })).catch(() => {});
resolveA();
await a;
assert.equal(tracker.progress.complete, false, 'not complete before registration is sealed');
tracker.seal();
assert.equal(tracker.progress.complete, false, 'not complete while a tracked fallback is pending');
rejectB(new Error('expected fallback'));
await b;
await tracker.done;
assert.deepEqual(tracker.progress, { started: 2, settled: 2, ratio: 1, sealed: true, complete: true });
assert(seen.includes('1/2:false:false'));
assert(seen.at(-1) === '2/2:true:true');
assert.throws(() => tracker.track(Promise.resolve()), /after seal/);

const empty = new InitialLoadTracker();
empty.seal();
await empty.done;
assert.equal(empty.progress.ratio, 1);

console.log('ALL LOADING TESTS PASSED');
