// Cache-busting through the publish command: a changed cached file gets a fresh tag in index.html, in the same commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {publish} from '../publish.mjs';
import {sh, fixture, done} from './publish-fixture.mjs';

const PAGE = '<link rel="stylesheet" href="style.css?v=a1">\n<script src="frame.js?v=b2"></script>\n<script type="module" src="liquid.mjs?v=c3"></script>\n';
const tagOf = (dir, file) => readFileSync(path.join(dir, 'index.html'), 'utf8').match(new RegExp(file.replace('.', String.raw`\.`) + String.raw`\?v=([^"]+)`))[1];

// A clone whose published state already holds the page and the cached files.
function seeded() {
  const f = fixture();
  for (const [name, text] of [['index.html', PAGE], ['style.css', 'a{}\n'], ['frame.js', 'f1\n'], ['liquid.mjs', 'l1\n']]) writeFileSync(path.join(f.root, name), text);
  writeFileSync(path.join(f.root, '.gitignore'), '/*\n!/.gitignore\n!/index.html\n!/*.css\n!/*.js\n!/*.mjs\n');
  sh(f.root, 'add', '-A'); sh(f.root, 'commit', '-qm', 'seed');
  for (const name of ['index.html', 'style.css', 'frame.js', 'liquid.mjs']) writeFileSync(path.join(f.source, name), readFileSync(path.join(f.root, name)));
  return f;
}

test('a changed cached file gets a new tag in the same commit; unchanged files keep theirs', async () => {
  const f = seeded();
  writeFileSync(path.join(f.source, 'style.css'), 'a{color:red}\n');
  const sha = await publish({...f, files: ['style.css'], message: 'Restyle', noPush: true});
  assert.notEqual(tagOf(f.root, 'style.css'), 'a1');
  assert.equal(tagOf(f.root, 'frame.js'), 'b2');
  assert.equal(tagOf(f.root, 'liquid.mjs'), 'c3');
  assert.deepEqual(sh(f.root, 'show', '--name-only', '--format=', sha).split('\n').sort(), ['index.html', 'style.css']);
  done(f);
});

test('a listed file that did not change keeps its tag, and a listed index.html is published as edited plus the new tags', async () => {
  const f = seeded();
  writeFileSync(path.join(f.source, 'liquid.mjs'), 'l2\n');
  writeFileSync(path.join(f.source, 'index.html'), PAGE + '<p>edited</p>\n');
  await publish({...f, files: ['index.html', 'frame.js', 'liquid.mjs'], message: 'm', noPush: true});
  const html = readFileSync(path.join(f.root, 'index.html'), 'utf8');
  assert.match(html, /<p>edited<\/p>/);
  assert.equal(tagOf(f.root, 'frame.js'), 'b2');
  assert.equal(tagOf(f.root, 'style.css'), 'a1');
  assert.notEqual(tagOf(f.root, 'liquid.mjs'), 'c3');
  done(f);
});

test('the same content always gets the same tag, different content a different one', async () => {
  const [a, b] = [seeded(), seeded()];
  for (const f of [a, b]) writeFileSync(path.join(f.source, 'frame.js'), 'same\n');
  writeFileSync(path.join(b.source, 'style.css'), 'other\n');
  for (const f of [a, b]) await publish({...f, files: ['frame.js', 'style.css'], message: 'm', noPush: true});
  assert.equal(tagOf(a.root, 'frame.js'), tagOf(b.root, 'frame.js'));
  assert.notEqual(tagOf(a.root, 'frame.js'), tagOf(a.root, 'style.css'));
  done(a); done(b);
});
