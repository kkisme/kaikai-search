import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rank,highlight} from '../docs/search.js';
const bank=JSON.parse(readFileSync(new URL('../docs/question-bank.json',import.meta.url),'utf8'));
const entries=bank.entries;
assert.match(bank.generatedDate,/^\d{4}-\d{2}-\d{2}$/);
assert.equal(entries.length,2275);
assert.equal(entries.filter(e=>e.id.startsWith('C20260924-')).length,1068);
assert.equal(entries.filter(e=>e.id.startsWith('R20260924-')).length,1);
assert.equal(entries.flatMap(e=>e.blocks).flatMap(b=>b.kind==='question'?b.notes:[]).filter(n=>n.startsWith('【新版答案冲突】')).length,0);
assert.equal(entries.flatMap(e=>e.blocks).flatMap(b=>b.kind==='question'?b.notes:[]).filter(n=>n.startsWith('【新版复习题答案冲突】')).length,0);
const verified={DT00446:'正确',DT00093:'ACDE',DT00067:'BCDE',DT00158:'ABCE',DT00124:'BCD',DT00418:'AB',DT00422:'ABDE',DT00355:'CE','C20260924-1280':'AC',DT00280:'BCDE',DT00282:'ACDE',DT00715:'CE'};
for(const [id,answer] of Object.entries(verified)){
 const e=entries.find(e=>e.id===id);
 const q=e.blocks.find(b=>b.kind==='question');
 assert.equal(q.answer,answer,id);
 assert.deepEqual(q.notes,[],id);
 if(/\([A-E]{1,5}\)/.test(q.stem))assert(q.stem.includes(`(${answer})`),`${id} has an outdated answer in its stem`);
}
for(const [questionId,answer] of Object.entries({'DT00889-S04':'B','DT01103-Q':'ABC'})){
 const q=entries.flatMap(e=>e.blocks).find(b=>b.kind==='question'&&b.id===questionId);
 assert.equal(q.answer,answer,questionId);
 assert.deepEqual(q.notes,[],questionId);
}
assert.equal(entries.filter(e=>e.type==='知识卡').length,23);
for(const id of ['DT00099','DT01121'])assert.equal(entries.find(e=>e.id===id).blocks.filter(b=>b.kind==='question').length,4);
for(const id of ['DT00163','DT00165','DT00166','DT00197','DT00234'])assert(!entries.some(e=>e.id===id));
assert.equal(rank(entries,'赵某与钱某')[0].entry.id,'DT01121');
assert(rank(entries,'钱某 赔偿').some(r=>r.entry.id==='DT01121'));
assert(rank(entries,'lianhuahepan').some(r=>r.entry.id==='DT00099'));
assert(rank(entries,'lhhp').some(r=>r.entry.id==='DT00099'));
assert.equal(rank(entries,'绝不存在的检索词xyz').length,0);
assert.equal(rank(entries,'','案例').length,30);
assert(rank(entries,'现场调查法','填空').some(r=>r.entry.id==='C20260924-1419'));
assert(rank(entries,'罚款的最高限额').some(r=>r.entry.id==='R20260924-0001'));
assert.equal(highlight('<script>安全</script>','安全'),'&lt;script&gt;<mark>安全</mark>&lt;/script&gt;');
assert.equal(highlight('安 全Ａ','安全a'),'<mark>安 全Ａ</mark>');
assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
for(const e of entries){assert(e.blocks.length,e.id);for(const b of e.blocks)if(b.kind==='question')assert(b.stem,b.id);}
for(const e of entries)for(const b of e.blocks){
 if(b.kind==='question')assert(!/[\r\n\v\f]/.test(b.stem),`${b.id} has an artificial line break in its stem`);
 else assert(!b.paragraphs.some(p=>/^【(?:题内说明|校订说明|答案来源|待核|关联背景)】/.test(p)),`${e.id} exposes an editorial marker`);
}
const collapseCase=entries.find(e=>e.id==='DT00506').blocks.find(b=>b.kind==='material');
assert.equal(collapseCase.paragraphs.length,1);
assert.match(collapseCase.paragraphs[0],/总公司承建的某大道.*8 号主墩/s);
assert(entries.find(e=>e.id==='DT00120').blocks.some(b=>b.kind==='material'&&b.paragraphs.some(p=>p.includes('造成 9 人死亡'))));
assert(!entries.find(e=>e.id==='DT01019').blocks.some(b=>b.kind==='material'&&b.paragraphs.some(p=>p.includes('”0 '))));
for(const e of entries.filter(e=>['案例','综合'].includes(e.type))){
 const order=e.blocks.map(b=>b.kind==='material'?'M':'Q').join('');
 assert(!order.includes('QM'),`${e.id} has case material after a question: ${order}`);
}
console.log('PASS: reviewed boundaries, removals, 23 knowledge cards, search and safe highlighting');
