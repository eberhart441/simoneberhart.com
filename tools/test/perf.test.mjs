import test from 'node:test';
import assert from 'node:assert/strict';
import {isOnBattery, blankPageFps, trustWarnings} from '../perf.mjs';
import {launch} from '../lib/browser.mjs';

test('discharging battery counts as battery power', () => {
  assert.equal(isOnBattery(() => '1\r\n'), true);
});

test('charging or fully charged counts as mains', () => {
  assert.equal(isOnBattery(() => '2\r\n'), false);
  assert.equal(isOnBattery(() => '3'), false);
});

test('no battery (empty output) or a failing command counts as mains', () => {
  assert.equal(isOnBattery(() => ''), false);
  assert.equal(isOnBattery(() => { throw new Error('no powershell'); }), false);
});

test('a blank page in a real browser reports a plausible frame rate', async () => {
  const b = await launch();
  try {
    const fps = await blankPageFps(await b.newPage());
    assert.ok(fps > 10 && fps < 300, `fps ${fps}`);
  } finally { await b.close(); }
});

test('warns on battery, before anything else', () => {
  const w = trustWarnings({battery: true, fps: 60});
  assert.equal(w.length, 1);
  assert.match(w[0], /battery/i);
});

test('warns when a blank page only reaches about 30 fps', () => {
  const w = trustWarnings({battery: false, fps: 30});
  assert.equal(w.length, 1);
  assert.match(w[0], /30 fps/);
});

test('no warnings on mains at 60 fps', () => {
  assert.deepEqual(trustWarnings({battery: false, fps: 60}), []);
});

test('both problems give both warnings, battery first', () => {
  const w = trustWarnings({battery: true, fps: 29});
  assert.equal(w.length, 2);
  assert.match(w[0], /battery/i);
});

test('low and critical battery also count as battery power', () => {
  assert.equal(isOnBattery(() => '4\r\n'), true);
  assert.equal(isOnBattery(() => '5'), true);
});
