import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchPage} from '../lib/failures.mjs';

const origin = 'http://127.0.0.1:4000';
const failed = (url, errorText) => ({url: () => url, failure: () => ({errorText})});
const answered = (url, status) => ({url: () => url, status: () => status});

function watched() {
  const page = new EventEmitter();
  return {page, problems: watchPage(page, origin)};
}

test('an uncaught page error is recorded with its message', () => {
  const {page, problems} = watched();
  page.emit('pageerror', new Error('boom'));
  assert.match(problems[0], /boom/);
});

test('a failed request of our own origin is recorded', () => {
  const {page, problems} = watched();
  page.emit('requestfailed', failed(`${origin}/a.css`, 'net::ERR_FAILED'));
  assert.match(problems[0], /a\.css/);
});

test('a failed request to another origin is ignored', () => {
  const {page, problems} = watched();
  page.emit('requestfailed', failed('https://fonts.example/f.woff', 'net::ERR_INTERNET_DISCONNECTED'));
  assert.deepEqual(problems, []);
});

test('a cancelled .webm is ignored, a cancelled anything else is not', () => {
  const {page, problems} = watched();
  page.emit('requestfailed', failed(`${origin}/clip.webm?x=1`, 'net::ERR_ABORTED'));
  assert.deepEqual(problems, []);
  page.emit('requestfailed', failed(`${origin}/a.js`, 'net::ERR_ABORTED'));
  assert.equal(problems.length, 1);
});

test('HTTP 404 on our origin is recorded; 200 and foreign 404 are not', () => {
  const {page, problems} = watched();
  page.emit('response', answered(`${origin}/ok.js`, 200));
  page.emit('response', answered('https://elsewhere.example/x', 404));
  assert.deepEqual(problems, []);
  page.emit('response', answered(`${origin}/gone.css`, 404));
  assert.match(problems[0], /gone\.css.*404/);
});
