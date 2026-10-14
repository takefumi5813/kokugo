const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const readData = text => JSON.parse(text.match(/<script id="data"[^>]*>(.*?)<\/script>/s)[1]);
const DATA = readData(html);
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/yoji-consolidation.json'), 'utf8'));
const before = readData(execFileSync('git', ['show', report.baseCommit + ':index.html'], { cwd: root, encoding: 'utf8', maxBuffer: 20e6 }));
const original = new Map(before.map(q => [q.id, q]));
const actual = new Map(DATA.map(q => [q.id, q]));
const sourceIds = new Set(report.groups.flatMap(g => g.sourceIds));
// 後の修正で意図して変えた問題（送りがな修正 2026-10-14）は比較から外す
const laterFix = JSON.parse(fs.readFileSync(path.join(root, 'docs/reading-okurigana-fix.json'), 'utf8'));
const laterIds = new Set([...laterFix.edited.map(e => e.id), ...laterFix.merged.flatMap(m => [m.from, m.into])]);
assert.equal(actual.size, DATA.length, 'IDs remain unique');
assert.equal(report.groups.length, 108);
assert.equal(DATA.filter(q => q.f === '四字熟語').length, 287);
for (const q of before) {
  if (!sourceIds.has(q.id) && !laterIds.has(q.id)) assert.deepEqual(actual.get(q.id), q, 'Unrelated question changed: ' + q.id);
}
for (const g of report.groups) {
  const q = actual.get(g.id);
  assert.equal(q.yoji, g.term);
  let i = 0;
  assert.equal(g.mask.replace(/□/g, () => q.a[i++]), g.term);
  assert.equal(i, q.a.length);
  assert.ok(i > 0 && i < 4);
  assert.equal(q.e, undefined, 'Old example must not override fill-in prompt');
  assert.deepEqual(new Set([q.id, ...(q.mergedIds || [])]), new Set(g.sourceIds));
  assert.deepEqual(new Set(q.u), new Set(g.sourceIds.flatMap(id => original.get(id).u)));
  for (const id of q.mergedIds || []) assert.ok(!actual.has(id), 'Old question still active');
  if (q.k === 'K') assert.ok(q.c.includes(q.a));
  else assert.equal(q.kc, 1);
}

const migration = html.slice(html.indexOf('  function mergeYojiProgress('), html.indexOf('  var fittedS ='));
const context = vm.createContext({ DATA });
vm.runInContext(migration, context);
const merge = context.mergeYojiProgress;
const plain = value => JSON.parse(JSON.stringify(value));
// Every original ID can be the user's sole learned question, including full-word IDs.
let checked = 0;
for (const g of report.groups) {
  for (const id of g.sourceIds) {
    const state = { [id]: { l: 4, d: 2000000000000 }, unrelated: { l: 2, d: 55 } };
    merge(state);
    assert.deepEqual(plain(state[g.id]), { l: 4, d: 2000000000000 });
    assert.deepEqual(state.unrelated, { l: 2, d: 55 });
    assert.equal(merge(state), false, 'Migration must be idempotent');
    checked++;
  }
}
const g = report.groups.find(g => g.sourceIds.length >= 3);
const oldIds = g.sourceIds.filter(id => id !== g.id);
const state = { [g.id]: { l: 1, d: 9999 }, [oldIds[0]]: { l: 4, d: 100 }, [oldIds[1]]: { l: 4, d: 200 } };
merge(state);
assert.deepEqual(plain(state[g.id]), { l: 4, d: 200 }, 'Highest stars, then latest due date');
state[g.id] = { l: 3, d: 300 }; // A later mistake must not be undone by stale aliases on reload.
merge(state);
assert.deepEqual(state[g.id], { l: 3, d: 300 });
assert.deepEqual(plain(merge({})), false);

// Exercise the actual startup migration, including persistence.
const saved = [];
Object.assign(context, { S: { [oldIds[0]]: { l: 4, d: 2000000000000 } }, KEY: 'srs', fitS: () => false, save: (key, value) => saved.push(plain(value)) });
vm.runInContext(html.slice(html.indexOf('  var fittedS ='), html.indexOf('  function saveS')), context);
assert.equal(saved[0][g.id].l, 4);
assert.equal(saved[0][oldIds[0]], undefined);

// Exercise the real backup handler: old backups, lower-rank backups and tied ranks.
const elements = {};
const $ = id => elements[id] || (elements[id] = {});
Object.assign(context, { $, P: {}, LOG: [], b64d: v => Buffer.from(v, 'base64').toString('utf8'), fitS: () => {}, saveS: () => {}, saveP: () => {}, saveLog: () => {}, initParty: () => {}, buildHome: () => {} });
vm.runInContext(html.slice(html.indexOf("  $('bkin').onclick ="), html.indexOf('  // ===== 結果ログ')), context);
function importState(S) {
  $('bktext').value = 'KOKUGO1.' + Buffer.from(JSON.stringify({ S })).toString('base64');
  $('bkin').onclick();
  assert.match($('bkmsg').textContent, /読み込みました/);
}
context.S = { [g.id]: { l: 2, d: 999 } };
importState({ [oldIds[0]]: { l: 4, d: 100 }, [oldIds[1]]: { l: 4, d: 200 } });
assert.deepEqual(plain(context.S[g.id]), { l: 4, d: 200 });
importState({ [oldIds[0]]: { l: 1, d: 99999 } });
assert.deepEqual(plain(context.S[g.id]), { l: 4, d: 200 }, 'Import cannot lower stars');
importState({ [oldIds[0]]: { l: 4, d: 500 } });
assert.deepEqual(plain(context.S[g.id]), { l: 4, d: 500 });
assert.ok(oldIds.every(id => !context.S[id]));
console.log(`PASS: ${checked} original question records preserve progress; data, startup, reload and backup import verified.`);
