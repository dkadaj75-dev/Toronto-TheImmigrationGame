// fullscreen.test.ts — pure coverage for game/fullscreen.ts (PROJECT_CONTEXT §7.77).
// Run: npx tsx test/fullscreen.test.ts

import {
  FULLSCREEN_CHANGE_EVENTS,
  fullscreenSupported,
  isFullscreen,
  setFullscreen,
  type FullscreenDocumentLike,
  type FullscreenElementLike,
} from '../game/fullscreen';

let passed = 0;
function ok(cond: boolean, label: string) {
  if (!cond) { console.error('FAIL', label); process.exit(1); }
  passed++; console.log('  ok ', label);
}

console.log('fullscreen.test — support detection');
ok(!fullscreenSupported(undefined), 'no element => unsupported');
ok(!fullscreenSupported({}), 'element without any API => unsupported (iPhone Safari)');
ok(fullscreenSupported({ requestFullscreen: () => {} }), 'standard API => supported');
ok(fullscreenSupported({ webkitRequestFullscreen: () => {} }), 'webkit prefix alone => supported');

console.log('fullscreen.test — state detection');
ok(!isFullscreen(undefined), 'no document => not fullscreen');
ok(!isFullscreen({}), 'no fullscreen element => not fullscreen');
ok(isFullscreen({ fullscreenElement: {} }), 'standard fullscreenElement => fullscreen');
ok(isFullscreen({ webkitFullscreenElement: {} }), 'webkit fullscreenElement => fullscreen');

console.log('fullscreen.test — driving state');
{
  const calls: string[] = [];
  const el: FullscreenElementLike = { requestFullscreen: () => { calls.push('request'); } };
  const doc: FullscreenDocumentLike = { exitFullscreen: () => { calls.push('exit'); } };
  ok(setFullscreen(true, el, doc) && calls.join() === 'request', 'enter issues requestFullscreen');
  ok(!setFullscreen(false, el, doc) && calls.length === 1, 'exit while not fullscreen is a no-op');
  doc.fullscreenElement = {};
  ok(!setFullscreen(true, el, doc) && calls.length === 1, 'enter while already fullscreen is a no-op');
  ok(setFullscreen(false, el, doc) && calls.join() === 'request,exit', 'exit issues exitFullscreen');
}
{
  const calls: string[] = [];
  const el: FullscreenElementLike = { webkitRequestFullscreen: () => { calls.push('webkitRequest'); } };
  const doc: FullscreenDocumentLike = { webkitFullscreenElement: {}, webkitExitFullscreen: () => { calls.push('webkitExit'); } };
  ok(setFullscreen(false, el, doc) && calls.join() === 'webkitExit', 'webkit prefixes drive exit');
  delete (doc as { webkitFullscreenElement?: unknown }).webkitFullscreenElement;
  ok(setFullscreen(true, el, doc) && calls.join() === 'webkitExit,webkitRequest', 'webkit prefixes drive enter');
}
{
  // Refusal paths must never throw or leak an unhandled rejection.
  const rejecting: FullscreenElementLike = { requestFullscreen: () => Promise.reject(new Error('denied')) };
  ok(setFullscreen(true, rejecting, {}) === true, 'a rejecting request still counts as issued and never throws');
  const throwing: FullscreenElementLike = { requestFullscreen: () => { throw new Error('gesture required'); } };
  ok(setFullscreen(true, throwing, {}) === false, 'a synchronously throwing request degrades to false');
  ok(setFullscreen(true, {}, {}) === false, 'no API => no request, returns false');
}
ok(FULLSCREEN_CHANGE_EVENTS.includes('fullscreenchange') && FULLSCREEN_CHANGE_EVENTS.includes('webkitfullscreenchange'),
  'change-event list covers standard + webkit');

// Give the rejected promise's swallow a microtask to run before declaring victory, so an
// unhandled rejection (which exits non-zero under tsx) would fail this suite.
await Promise.resolve();
console.log(`\nall ${passed} fullscreen tests passed`);
