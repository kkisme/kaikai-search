const fs = require('fs');
const data = JSON.parse(fs.readFileSync('dist/search-index.json', 'utf-8'));
const docs = data.docs;

function normalize(s) {
  if (!s) return '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xFF01 && code <= 0xFF5E) out += String.fromCharCode(code - 0xFEE0);
    else if (code === 0x3000) out += ' ';
    else out += s[i];
  }
  return out.toLowerCase().replace(/\s+/g, '').trim();
}

function scoreDoc(doc, nq) {
  let score = 0;
  const q = (doc.question || '').toLowerCase();
  const text = (doc.text || '').toLowerCase();
  const pinyin = (doc.pinyin || '').toLowerCase();
  const pinyinAbbr = (doc.pinyinAbbr || '').toLowerCase();
  const answerText = (doc.answerText || '').toLowerCase();
  if (q === nq) score += 200;
  else if (q.startsWith(nq)) score += 120;
  if (text.includes(nq)) score += 80;
  if (pinyin.includes(nq)) score += 60;
  if (pinyinAbbr.includes(nq)) score += 50;
  if (answerText && answerText.includes(nq)) score += 20;
  const grams = doc.grams || [];
  for (let i = 0; i < nq.length - 1; i++) {
    const g = nq.slice(i, i + 2);
    if (grams.includes(g)) score += 15;
  }
  let charHit = 0;
  for (const ch of nq) if (text.includes(ch)) charHit++;
  score += charHit * 5;
  return score;
}

function search(query) {
  const nq = normalize(query);
  const results = [];
  for (const doc of docs) {
    const score = scoreDoc(doc, nq);
    if (score > 0) results.push({ id: doc.id, score, q: doc.question });
  }
  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return results.slice(0, 10);
}

for (const q of ['安全评估', 'aqsc', '安去', '78', '第78题', '隧道']) {
  const r = search(q);
  console.log(`\n== ${q} -> ${r.length} ==`);
  for (const x of r.slice(0, 5)) console.log(x.id, x.score, x.q.slice(0, 30));
}
