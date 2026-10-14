const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const DATA = JSON.parse(html.match(/<script id="data"[^>]*>(.*?)<\/script>/s)[1]);
const rep = JSON.parse(fs.readFileSync(path.join(root, 'docs/reading-okurigana-fix.json'), 'utf8'));
const byId = new Map(DATA.map(q => [q.id, q]));
assert.equal(byId.size, DATA.length, 'IDs remain unique');
for (const e of rep.edited) {
  const q = byId.get(e.id);
  assert.ok(q, 'edited question kept: ' + e.id);
  assert.equal(q.q, e.to.q); assert.equal(q.a, e.to.a);
}
for (const m of rep.merged) {
  assert.ok(!byId.has(m.from), 'merged question removed: ' + m.from);
  assert.ok(byId.get(m.into).mergedIds.includes(m.from), 'merged id recorded: ' + m.from);
}
const kan = /[一-鿿々]/g;
const bad = DATA.filter(q => q.k === 'R').filter(({ q, a }) => {
  const tail = (q.match(/[ぁ-ん]+$/) || [''])[0];
  return !a.endsWith(tail) || a.length < (q.match(kan) || []).length || /[()（）]/.test(a) ||
    (q.match(/[ぁ-ん]+/g) || []).some(k => !a.includes(k));
});
assert.deepEqual(bad.map(q => q.id), [], 'reading answers missing okurigana');
console.log('PASS: ' + rep.edited.length + ' edited, ' + rep.merged.length + ' merged; no reading answer is missing its okurigana.');
