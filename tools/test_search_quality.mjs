import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {highlightRanges, rank} from '../docs/search.js';

function readBank(file) {
  return JSON.parse(readFileSync(new URL(`../docs/${file}.json`, import.meta.url), 'utf8')).entries;
}

const road = readBank('road-skills-bank');
const safety = readBank('question-bank');

function question(bank, id) {
  const block = bank.find(entry => entry.id === id)?.blocks.find(block => block.kind === 'question');
  assert.ok(block, `Missing fixture ${id}`);
  return block;
}

function options(block, delimiter = '、', separator = '\n') {
  return block.options.map(option => `${option.key}${delimiter}${option.text}`).join(separator);
}

function first(results, expected) {
  assert.equal(results[0]?.entry.id, expected, `Top results: ${results.slice(0, 5).map(result => result.entry.id).join(', ')}`);
}

function excludes(results, ids) {
  assert.ok(!results.some(result => ids.includes(result.entry.id)), `Unexpected result: ${results.map(result => result.entry.id).join(', ')}`);
}

function expectHighlight(result, field, text, marked = true) {
  const start = field.indexOf(text);
  assert.ok(start >= 0, `Fixture does not contain ${text}`);
  const ranges = result.similarHighlights?.get(field);
  assert.ok(ranges?.length, 'The matching field should have highlight ranges');
  for (let offset = start; offset < start + text.length; offset++) {
    if (/\s/u.test(field[offset])) continue;
    const covered = ranges.some(([from, to]) => from <= offset && offset < to);
    assert.equal(covered, marked, `Unexpected highlight at ${offset} within ${text}`);
  }
}

let passed = 0;
let failed = 0;
function check(name, run) {
  try {
    run();
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failed++;
  }
}

const roadVariant = question(road, 'ROAD0589');
const standard = question(road, 'ROAD0016');
const oven = question(road, 'ROAD0008');
const concrete = question(road, 'ROAD0002');
const radar = question(safety, 'DT00001');

check('exact search still finds a stem beginning with a standard number', () => {
  first(rank(road, standard.stem, '单选'), 'ROAD0016');
});

check('pasted choices distinguish same-stem questions even when pasted answer disagrees', () => {
  const pasted = `第23题 【单选题】\n${roadVariant.stem}\n${options(roadVariant)}\n正确答案：C`;
  first(rank(road, pasted), 'ROAD0589');
});

check('shuffled choices with new option letters still distinguish same-stem questions', () => {
  const shuffled = [...roadVariant.options].reverse().map((option, index) =>
    `${String.fromCharCode(65 + index)}．${option.text}`
  ).join(' ');
  const pasted = `23. [单选题] ${roadVariant.stem} ${shuffled} 参考答案：B`;
  first(rank(road, pasted, '单选'), 'ROAD0589');
});

check('shuffled choices survive common pasted number and choice formats', () => {
  const shuffled = [...roadVariant.options].reverse();
  const newKey = index => String.fromCharCode(65 + index);
  for (const {name, prefix, separator, choice} of [
    {name: 'bare number and comma separators', prefix: '23 单选题 ', separator: '，',
      choice: (option, index) => `${newKey(index)}、${option.text}`},
    {name: 'compact choices', prefix: '23. ', separator: '',
      choice: (option, index) => `${newKey(index)}.${option.text}`},
    {name: 'exported choices with original labels', prefix: '23. ', separator: '\n',
      choice: (option, index) => `${newKey(index)}. ${option.key}. ${option.text}`},
  ]) {
    const choices = shuffled.map(choice).join(separator);
    const pasted = `${prefix}${roadVariant.stem}${separator}${choices}\n答案：A`;
    const results = rank(road, pasted, '单选');
    assert.equal(results[0]?.entry.id, 'ROAD0589', name);
  }
});

check('an attached answer label does not consume the last distinguishing choice', () => {
  const traceability = question(road, 'ROAD0525');
  const choices = [2, 0, 1, 3].map((index, letter) =>
    `${String.fromCharCode(65 + letter)}. ${traceability.options[index].text}`
  ).join('\n');
  const pasted = `51、${traceability.stem}\n${choices}正确答案：A`;
  first(rank(road, pasted, '单选'), 'ROAD0525');
});

check('a year at the start of the question remains part of the stem', () => {
  const block = question(safety, 'DT00003');
  const pasted = `${block.stem}\n${options(block, '. ')}`;
  first(rank(safety, pasted, '单选'), 'DT00003');
  excludes(rank(safety, pasted.replace(/^2002/u, '2022'), '单选'), ['DT00003']);
});

check('submitted answer labels do not consume the last choice', () => {
  const traceability = question(road, 'ROAD0525');
  const pasted = `51、${traceability.stem}\n${options(traceability)}\n您的答案：B\n正确答案：D`;
  first(rank(road, pasted, '单选'), 'ROAD0525');
});

check('exported question-number caption does not consume the choices', () => {
  const traceability = question(road, 'ROAD0525');
  const pasted = `51. ${traceability.stem}\n原卷单选题第 3 题\n${options(traceability, '. ')}\n答案 D\n解析 依据试验检测仪器设备服务手册`;
  first(rank(road, pasted, '单选'), 'ROAD0525');
});

check('pasted Windows line breaks, answer slot, and submitted answer are handled', () => {
  const stem = radar.stem.replace('( C )', '（____）');
  const pasted = `39、${stem}\r\n${options(radar, '. ', '\r\n')}\r\n您的答案：B\r\n正确答案：C`;
  first(rank(safety, pasted, '单选'), 'DT00001');
  excludes(rank(safety, pasted, '判断'), ['DT00001']);
  assert.equal(rank(road, pasted).length, 0);
});

check('inline choices do not erase standard numbers or numeric option text', () => {
  const pasted = `39. ${standard.stem} ${options(standard, '. ', ' ')}`;
  first(rank(road, pasted), 'ROAD0016');
  assert.equal(rank(safety, pasted).length, 0);
});

check('pasted choices and answer alone cannot rescue an unrelated stem', () => {
  const pasted = `53、没有明确出处的仪器设定题应该选哪一个？\n${options(oven, '．')}\n参考答案：A`;
  assert.equal(rank(road, pasted).length, 0);
});

for (const {name, block, before, after, ids} of [
  {name: 'temperature value', block: oven, before: '110℃', after: '112℃', ids: ['ROAD0008']},
  {name: 'standard edition', block: standard, before: '1499.1-2024', after: '1499.1-2025', ids: ['ROAD0016']},
  {name: 'comparison direction', block: concrete, before: '大于40.0mm', after: '小于40.0mm', ids: ['ROAD0002', 'ROAD1639']},
  {name: 'negation', block: concrete, before: '粒径不宜', after: '粒径宜', ids: ['ROAD0002', 'ROAD1639']},
]) {
  check(`copied options do not override a changed ${name}`, () => {
    assert.ok(block.stem.includes(before), `Fixture no longer contains ${before}`);
    const pasted = `53、${block.stem.replace(before, after)}\n${options(block, '．')}`;
    excludes(rank(road, pasted), ids);
  });
}

check('an explanation with a different standard code cannot rescue a changed full stem', () => {
  const nuclearDensity = question(road, 'ROAD2689');
  assert.ok(nuclearDensity.stem.includes('T 0924'));
  assert.ok(nuclearDensity.notes.some(note => note.includes('T 0925')));
  excludes(rank(road, nuclearDensity.stem.replace('T 0924', 'T 925'), '填空'), ['ROAD2689']);
});

check('question stem is ranked ahead of an explanation containing the same words', () => {
  first(rank(road, '烘干时间不宜'), 'ROAD0266');
});

check('literal and punctuation-insensitive matches both appear', () => {
  const ids = rank(road, '试样置于铂').map(result => result.entry.id);
  assert.ok(ids.includes('ROAD0088'));
  assert.ok(ids.includes('ROAD0089'));
});

check('a single phrase cannot join words across separate options', () => {
  const results = rank(safety, '董事长总经理');
  first(results, 'C20260924-0292');
  excludes(results, ['DT00002']);
});

check('keyword punctuation separates terms and keeps matches within the chosen type', () => {
  for (const separator of ['、', '；', '|']) {
    const results = rank(road, `路面渗水${separator}碾压成型`, '单选');
    assert.ok(['ROAD0564', 'ROAD0606'].includes(results[0]?.entry.id), separator);
    assert.ok(results.every(result => result.entry.type === '单选'), separator);
  }
});

check('keywords can span case material and a subquestion', () => {
  const results = rank(safety, '开放性骨折、死亡赔偿责任', '案例');
  first(results, 'DT01121');
  assert.equal(results[0].entry.blocks.filter(block => block.kind === 'question').length, 4);
});

check('four-character keyword tolerates one wrong character', () => {
  const results = rank(road, '细度模术', '单选');
  assert.ok(results.slice(0, 3).some(result => ['ROAD0379', 'ROAD0589'].includes(result.entry.id) && result.kind === 'similar'));
});

check('five-character keyword tolerates one missing character', () => {
  const results = rank(road, '层间结强度', '单选');
  assert.ok(results[0]?.entry.title.includes('层间粘结强度'));
  assert.equal(results[0].kind, 'similar');
});

check('multi-keyword typo recovery still requires the other term', () => {
  const results = rank(road, '细度模术|外加剂', '单选');
  assert.ok(results.slice(0, 3).some(result => ['ROAD0379', 'ROAD0589'].includes(result.entry.id) && result.kind === 'similar'));
  assert.equal(rank(road, '细度模术|无关词xyz').length, 0);
});

check('near matches highlight the shared wording and measurements around multiple edits', () => {
  const query = concrete.stem.replace('普通混凝土', '普通混泥土').replace('粗骨料宜采用', '粗骨料采用');
  const results = rank(road, query, '单选');
  first(results, 'ROAD0002');
  const [match] = results;
  assert.equal(match.kind, 'similar');
  expectHighlight(match, concrete.stem, 'JGJ 55-2011');
  expectHighlight(match, concrete.stem, '40.0mm');
  expectHighlight(match, concrete.stem, '粗骨料');
  expectHighlight(match, concrete.stem, '采用');
  expectHighlight(match, concrete.stem, '凝', false);
  expectHighlight(match, concrete.stem, '宜', false);
});

check('a reordered question highlights shared phrases in their original order', () => {
  const query = '减少人员伤亡，防止事故扩大，妥善保护现场。法律规定施工单位负责人接到事故报告后，应当迅速组织抢救，不得（ ）';
  const match = rank(safety, query, '多选').find(result => result.entry.id === 'DT00011');
  assert.equal(match?.kind, 'similar');
  const block = question(safety, 'DT00011');
  expectHighlight(match, block.stem, '法律规定施工单位负责人接到事故报告后');
  expectHighlight(match, block.stem, '应当迅速组织抢救');
  expectHighlight(match, block.stem, '减少人员伤亡');
  expectHighlight(match, block.stem, '妥善保护现场');
  assert.ok(!match.similarHighlights.has(block.options[0].text));
});

check('a similar case subquestion highlights its matched words in the complete case', () => {
  const results = rank(safety, '钱某的死亡赔偿则任主要应该由（ ）承担', '案例');
  first(results, 'DT01121');
  const [match] = results;
  assert.equal(match.kind, 'similar');
  const block = match.entry.blocks.find(block => block.kind === 'question' && block.stem.includes('死亡赔偿责任'));
  assert.ok(block);
  expectHighlight(match, block.stem, '钱某的死亡赔偿');
  expectHighlight(match, block.stem, '任主要应该由');
  expectHighlight(match, block.stem, '责', false);
  assert.ok(!match.similarHighlights.has(match.entry.title));
});

check('keyword fallback highlights the exact anchor and shared part of the misspelled keyword', () => {
  const match = rank(road, '细度模术|外加剂', '单选').find(result => result.entry.id === 'ROAD0379');
  assert.equal(match?.kind, 'similar');
  const stem = question(road, 'ROAD0379').stem;
  expectHighlight(match, stem, '外加剂');
  expectHighlight(match, stem, '细度模');
  expectHighlight(match, stem, '数', false);
});

check('a heavily corrupted pasted stem still finds both forms of the original question', () => {
  const query = '《普通混凝土配合比设计规程》JGJ 55-2011 预应力混凝土拌合物按时打算都是性氯离子最大含量是（  ）';
  const results = rank(road, query);
  for (const id of ['ROAD0001', 'ROAD1984']) {
    const match = results.slice(0, 3).find(result => result.entry.id === id);
    assert.equal(match?.kind, 'similar', id);
    const stem = question(road, id).stem;
    expectHighlight(match, stem, 'JGJ 55-2011');
    expectHighlight(match, stem, '预应力混凝土拌合物');
    expectHighlight(match, stem, '氯离子最大含量');
    expectHighlight(match, stem, '水溶', false);
  }
});

check('strong stem phrases can find the question with the citation omitted', () => {
  const query = '预应力混凝土拌合物按时打算都是性氯离子最大含量是（  ）';
  const match = rank(road, query).slice(0, 3).find(result => result.entry.id === 'ROAD0001');
  assert.equal(match?.kind, 'similar');
  const stem = question(road, 'ROAD0001').stem;
  expectHighlight(match, stem, '氯离子最大含量');
  expectHighlight(match, stem, 'JGJ 55-2011', false);
  excludes(rank(road, 'JGJ 55-2012 ' + query), ['ROAD0001', 'ROAD1984']);
});

check('the closest stem ranks first when two results share much of the same wording', () => {
  const original = question(safety, 'C20260924-0330').stem;
  const query = original.replace('全生产设施或者安全生产条', '按时打算都已经写在里面');
  assert.notEqual(query, original);
  const results = rank(safety, query, '判断');
  first(results, 'C20260924-0330');
  assert.equal(results[0].kind, 'similar');
  assert.ok(results.some(result => result.entry.id === 'C20260924-0279'));
});

const rewrittenConcrete = '《普通混凝土配合比设计规程》JGJ 55-2011 试验室进行配合比设计时对材料选型和检验都有专门规定，粗骨料宜采用连续级配，最大公称粒径不宜大于40.0mm，含泥量不得大于（ ），泥块含量不得大于（ ）。';

check('a rewritten stem can be found by several unchanged technical phrases', () => {
  const match = rank(road, rewrittenConcrete, '单选').slice(0, 3).find(result => result.entry.id === 'ROAD0002');
  assert.equal(match?.kind, 'similar');
  expectHighlight(match, concrete.stem, '粗骨料宜采用连续级配');
  expectHighlight(match, concrete.stem, '最大公称粒径不宜大于40.0mm');
});

for (const {name, before, after} of [
  {name: 'standard edition', before: '55-2011', after: '55-2012'},
  {name: 'measurement', before: '40.0mm', after: '60.0mm'},
  {name: 'negation', before: '不宜大于', after: '宜大于'},
  {name: 'comparison direction', before: '大于40.0mm', after: '小于40.0mm'},
  {name: 'contrasting technical term', before: '连续级配', after: '间断级配'},
]) {
  check(`shared phrases do not override a changed ${name} in a rewritten stem`, () => {
    assert.ok(rewrittenConcrete.includes(before));
    excludes(rank(road, rewrittenConcrete.replace(before, after), '单选'), ['ROAD0002']);
  });
}

check('sharing a standard heading does not match an unrelated question', () => {
  const query = '《普通混凝土配合比设计规程》JGJ 55-2011中，试验机构的门卫访客登记记录保存时间是（ ）。';
  excludes(rank(road, query), ['ROAD0001', 'ROAD1984', 'ROAD0002']);
});

check('abridged case material can match several surviving phrases in the full case', () => {
  const query = '赵某与钱某因琐事发生口角，赵乘钱不备将钱的头部击伤。在赶往医院途中，钱某不慎跌入未设防护的涵洞内，造成左腿开放性骨折。';
  const match = rank(safety, query, '案例').slice(0, 3).find(result => result.entry.id === 'DT01121');
  assert.equal(match?.kind, 'similar');
  const material = match.entry.blocks.find(block => block.kind === 'material')?.paragraphs[0];
  assert.ok(material);
  expectHighlight(match, material, '赵某与钱某因琐事发生口角');
  expectHighlight(match, material, '未设防护的涵洞内');
  expectHighlight(match, material, '造成左腿开放性骨折');
  expectHighlight(match, material, '在一下坡路上', false);
  assert.equal(match.entry.blocks.filter(block => block.kind === 'question').length, 4);
});

check('range highlighting escapes HTML inside and outside UTF-16 ranges', () => {
  const original = '🧪<script>安全 &</script>';
  const start = original.indexOf('安全');
  const end = original.indexOf('</script>');
  assert.equal(highlightRanges(original, [[start, end]]), '🧪&lt;script&gt;<mark>安全 &amp;</mark>&lt;/script&gt;');
});

check('existing pinyin search remains within the bank', () => {
  assert.ok(rank(safety, 'lianhuahepan').some(result => result.entry.id === 'DT00099'));
  assert.equal(rank(road, 'lianhuahepan').length, 0);
});

console.log(`Search quality: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
