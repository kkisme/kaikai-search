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

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function isSubsequence(needle, haystack) {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function fuzzyWindowMatch(q, haystack, maxDist) {
  const len = q.length;
  if (len < 2 || haystack.length < len) return false;
  for (let i = 0; i <= haystack.length - len; i++) {
    if (levenshtein(q, haystack.slice(i, i + len)) <= maxDist) return true;
  }
  return false;
}

function scoreDoc(doc, nq) {
  let score = 0;
  const q = (doc.question || '').toLowerCase();
  const text = (doc.text || '').toLowerCase();
  const textCompact = text.replace(/\s+/g, '');
  const pinyin = (doc.pinyin || '').toLowerCase();
  const pinyinAbbr = (doc.pinyinAbbr || '').toLowerCase();
  const answerText = (doc.answerText || '').toLowerCase();
  let strong = false;
  if (q === nq) { score += 200; strong = true; }
  else if (q.startsWith(nq)) { score += 120; strong = true; }
  if (text.includes(nq)) { score += 80; strong = true; }
  if (pinyin.includes(nq)) { score += 60; strong = true; }
  if (pinyinAbbr.includes(nq)) { score += 50; strong = true; }
  if (answerText && answerText.includes(nq)) { score += 20; strong = true; }
  const grams = doc.grams || [];
  for (let i = 0; i < nq.length - 1; i++) {
    const g = nq.slice(i, i + 2);
    if (grams.includes(g)) { score += 15; strong = true; }
  }
  if (nq.length >= 2 && isSubsequence(nq, textCompact)) { score += 30; strong = true; }
  const maxDist = nq.length <= 4 ? 1 : 2;
  if (nq.length >= 2 && fuzzyWindowMatch(nq, textCompact, maxDist)) { score += 35; strong = true; }
  return strong ? score : 0;
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

for (const q of ['安全评估', '安去', '安全评', '安生', '桥量', '隧道']) {
  const r = search(q);
  console.log(`\n== ${q} -> ${r.length} ==`);
  for (const x of r.slice(0, 5)) console.log(x.id, x.score, x.q.slice(0, 30));
}
