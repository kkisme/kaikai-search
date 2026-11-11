import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rank} from '../docs/search.js';

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
  const pasted = `23. [单选题] ${roadVariant.stem} ${shuffled} 参考答案：D`;
  first(rank(road, pasted, '单选'), 'ROAD0589');
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

check('existing pinyin search remains within the bank', () => {
  assert.ok(rank(safety, 'lianhuahepan').some(result => result.entry.id === 'DT00099'));
  assert.equal(rank(road, 'lianhuahepan').length, 0);
});

console.log(`Search quality: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
