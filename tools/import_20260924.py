"""Import the 2026-09-24 C and review DOCX files into the deployed bank.

Uses researched answers for the eleven C-file conflicts, deduplicates complete
questions, and rejects structurally unrecoverable rows.
"""
from __future__ import annotations

import collections
import hashlib
import importlib.util
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from docx import Document
from pypinyin import Style, lazy_pinyin

ROOT = Path(__file__).resolve().parents[1]
BANK_PATH = ROOT / 'docs/question-bank.json'
C_SOURCE = ROOT / 'data/交安C题库(2026-09-24).docx'
REVIEW_SOURCE = ROOT / 'data/交安复习题(2026-09-24).docx'
OLD_PREFIX = ('C20260924-', 'R20260924-')
TOC = re.compile(r'TOC\s*\\o\s*"1-5"\s*\\h\s*\\z\s*')
INLINE_ANSWER = re.compile(r'[（(]\s*(?:[A-H]{1,6}|正确|错误|对|错)\s*[)）]', re.I)
REVIEW_NOVEL = '根据《生产安全事故报告调查处理条例》规定，对于发生特别重大事故的单位，给予罚款的最高限额为'
VERIFIED_C_ANSWERS = {
    'DT00446': '正确',
    'DT00093': 'ACDE',
    'DT00067': 'BCDE',
    'DT00158': 'ABCE',
    'DT00124': 'BCD',
    'DT00418': 'AB',
    'DT00422': 'ABDE',
    'DT00355': 'CE',
    'C20260924-1280': 'AC',
    'DT00280': 'BCDE',
    'DT00282': 'ACDE',
}


def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', TOC.sub('', text)).strip()


def key(text: str) -> str:
    text = unicodedata.normalize('NFKC', clean(text))
    text = INLINE_ANSWER.sub('', text)
    return re.sub(r'[^\u4e00-\u9fa5a-z0-9]', '', text.lower())


def grams(text: str) -> set[str]:
    return {text[i:i+2] for i in range(len(text)-1)}


def full_text(stem: str, options: list[dict]) -> str:
    return key(stem + ' ' + ' '.join(option['text'] for option in options))


def entry_question(entry: dict) -> dict | None:
    qs = [b for b in entry['blocks'] if b['kind'] == 'question']
    return qs[0] if len(qs) == 1 else None


class Matcher:
    def __init__(self, entries):
        self.rows = []
        self.answers = {}
        self.questions = {}
        self.index = collections.defaultdict(set)
        for e in entries:
            q = entry_question(e)
            if q:
                self.add(e['id'], q)

    def add(self, id, q):
        self.answers[id] = q['answer']
        self.questions[id] = q
        stem = grams(key(q['stem']))
        whole = grams(full_text(q['stem'], q['options']))
        i = len(self.rows)
        self.rows.append((id, stem, whole))
        for gram in whole:
            self.index[gram].add(i)

    def nearest(self, stem, options):
        sg, fg = grams(key(stem)), grams(full_text(stem, options))
        overlaps = collections.Counter(i for g in fg for i in self.index[g])
        best = (0.0, 0.0, '')
        for i in sorted(overlaps):
            overlap = overlaps[i]
            id, other_sg, other_fg = self.rows[i]
            full_score = overlap / max(1, len(fg | other_fg))
            if full_score < best[0]:
                continue
            stem_score = len(sg & other_sg) / max(1, len(sg | other_sg))
            if (full_score, stem_score) > best[:2]:
                best = (full_score, stem_score, id)
        return best


def search_fields(q):
    raw = '\n'.join([q['stem'], *[o['text'] for o in q['options']], q['answer'], *q['notes']])
    normalize = lambda t: re.sub(r'\s+', '', unicodedata.normalize('NFKC', t)).lower()
    return {
        'text': normalize(raw),
        'pinyin': normalize(''.join(lazy_pinyin(raw, style=Style.NORMAL))),
        'initials': normalize(''.join(lazy_pinyin(raw, style=Style.FIRST_LETTER))),
    }


def refresh_entry_search(entry):
    parts=[]
    for block in entry['blocks']:
        if block['kind']=='question':
            parts.extend([block['stem'], *[o['text'] for o in block['options']], block['answer'], *block['notes']])
        else:
            parts.extend(block['paragraphs'])
    raw='\n'.join(parts)
    normalize=lambda t: re.sub(r'\s+', '', unicodedata.normalize('NFKC', t)).lower()
    entry['search']={'text':normalize(raw),
                     'pinyin':normalize(''.join(lazy_pinyin(raw,style=Style.NORMAL))),
                     'initials':normalize(''.join(lazy_pinyin(raw,style=Style.FIRST_LETTER)))}


def set_answer(entry, answer):
    q = entry_question(entry)
    assert q is not None
    old_answer = q['answer']
    q['answer'] = answer
    if old_answer != answer:
        q['stem'] = re.sub(r'([（(]\s*)' + re.escape(old_answer) + r'(\s*[)）])',
                           lambda match: match.group(1) + answer + match.group(2),
                           q['stem'], count=1)
    q['notes'] = []
    entry['title'] = q['stem'][:100]
    refresh_entry_search(entry)


def new_entry(id, number, kind, stem, options, answer, source, notes=None):
    q = {'kind':'question','id':id+'-Q','type':kind,'stem':clean(stem),
         'options':options,'answer':answer,'notes':notes or []}
    return {'id':id,'sourceNo':str(number),'sourceDocument':source,
            'type':kind,'section':source,'blocks':[q],
            'title':q['stem'][:100],'search':search_fields(q)}


def parse_c():
    rows = []
    for paragraph in Document(C_SOURCE).paragraphs[1:]:
        text = paragraph.text.strip()
        m = re.match(r'^(\d+)、(.*?)——\[([^]]+)\](?:\n|$)(.*)', text, re.S)
        if not m:
            rows.append({'error':'题目边界无法识别','raw':text})
            continue
        num, stem, kind, tail = m.groups()
        answer = re.search(r'正确答案[：:]\s*(.*)', tail)
        options = [{'key':k,'text':clean(v)} for k,v in re.findall(r'^\s*([A-H])\s+([^\n]+)', tail, re.M)]
        rows.append({'number':int(num),'stem':clean(stem),'kind':kind,
                     'options':options,'answer':clean(answer.group(1)) if answer else '', 'raw':text})
    return rows


def c_question(row):
    """Return a complete question or a concrete reason to hold the source row."""
    if 'error' in row:
        return None, row['error']
    stem, options, answer, kind = row['stem'], row['options'], row['answer'], row['kind']
    if not answer or not stem:
        return None, '题干或答案缺失'
    if row['number'] in (38, 426, 491):
        return None, '题干在源文档中截断'
    if kind == '填空题':
        if row['number'] in (1448, 1449):
            if answer not in ('A','B'):
                return None, '判断答案无法对应'
            return ('判断',re.sub(r'A[.．]正确B[.．]错误$', '', stem),[],
                    '正确' if answer=='A' else '错误'), None
        # Fill-in rows supply the answer text, but no option list.
        value = re.sub(r'\b[A-H][.．]\s*', '', answer).replace('|','；')
        if not value:
            return None, '填空答案只有选项字母'
        return ('填空',stem,[],value), None
    keys = [o['key'] for o in options]
    if len(keys) < 2 or len(set(keys)) != len(keys) or keys != [chr(65+i) for i in range(len(keys))]:
        return None, '选项残缺或标签错乱'
    if any(not o['text'] or re.search(r'\\o\b|TOC',o['text']) for o in options):
        return None, '选项文字残缺'
    if not re.fullmatch(r'[A-H]+', answer) or not set(answer).issubset(keys):
        return None, '答案不在选项内'
    if kind == '单选题' and len(answer) != 1:
        return None, '单选答案格式异常'
    if kind == '多选题' and len(answer) < 2:
        return None, '多选答案格式异常'
    if len(options)==2:
        labels = [key(x['text']) for x in options]
        if labels[0] in ('正','正确','对') and labels[1] in ('错','错误','误'):
            return ('判断',stem,[],'正确' if answer=='A' else '错误'), None
    return ('单选' if kind=='单选题' else '多选',stem,options,answer), None


def parse_review_novel():
    """The revised review DOCX contains one genuinely new question, twice."""
    spec = importlib.util.spec_from_file_location('legacy_parser', ROOT/'tools/parse_questions.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    scratch = ROOT/'tmp'
    scratch.mkdir(exist_ok=True)
    paragraphs = [{'index':i,'text':p.text.strip()} for i,p in enumerate(Document(REVIEW_SOURCE).paragraphs) if p.text.strip()]
    mod.RAW = scratch/'review_20260924_raw.json'
    mod.OUT_QUESTIONS = scratch/'review_20260924_parsed.json'
    mod.OUT_REPORT = scratch/'review_20260924_report.json'
    mod.RAW.write_text(json.dumps(paragraphs,ensure_ascii=False),encoding='utf-8')
    mod.parse()
    parsed=json.loads(mod.OUT_QUESTIONS.read_text(encoding='utf-8'))['questions']
    found=[q for q in parsed if REVIEW_NOVEL in q.get('question','')]
    assert len(found)==2, f'Expected duplicate review question twice, found {len(found)}'
    assert all(q['answerText']=='D' and [o['key'] for o in q['options']]==list('ABCD') for q in found)
    return found[0],parsed


def main():
    bank=json.loads(BANK_PATH.read_text(encoding='utf-8'))
    entries=[e for e in bank['entries'] if not e['id'].startswith(OLD_PREFIX)]
    assert len(entries)==1206, 'The reviewed base bank has changed; reassess before importing'
    for entry in entries:
        changed=False
        for block in entry['blocks']:
            if block['kind']=='question':
                kept=[n for n in block['notes'] if not n.startswith(('【新版答案冲突】','【新版复习题答案冲突】'))]
                changed |= len(kept)!=len(block['notes'])
                block['notes']=kept
        if changed:
            refresh_entry_search(entry)
    by_id={e['id']:e for e in entries}
    # Some reviewed base questions are repeated under different IDs. Keep each
    # exact equivalent in sync so a search never returns the superseded answer.
    base_targets = {id: entry_question(by_id[id]) for id in VERIFIED_C_ANSWERS if id in by_id}
    for id, target in base_targets.items():
        signature = full_text(target['stem'], target['options'])
        for entry in entries:
            q = entry_question(entry)
            if q and full_text(q['stem'], q['options']) == signature:
                set_answer(entry, VERIFIED_C_ANSWERS[id])
    matcher=Matcher(entries)
    counts=collections.Counter()
    held=[]
    conflicts=[]
    for ordinal,row in enumerate(parse_c(),1):
        candidate,reason=c_question(row)
        if reason:
            counts['held']+=1
            held.append({'sourceNo':row.get('number'),'row':ordinal,'reason':reason})
            continue
        kind,stem,options,answer=candidate
        score,stem_score,matched_id=matcher.nearest(stem,options)
        if score>=.90 and stem_score>=.80:
            counts['duplicate']+=1
            previous=matcher.answers[matched_id]
            canonical=lambda value: ''.join(sorted(re.match(r'^[A-H]+',value).group())) if re.match(r'^[A-H]+',value) else value
            matched=matcher.questions[matched_id]
            equivalent=False
            if not options and matched['options'] and re.fullmatch(r'[A-H]+',previous):
                existing_words='；'.join(o['text'] for o in matched['options'] if o['key'] in previous)
                equivalent=key(existing_words)==key(answer)
            if canonical(answer)!=canonical(previous) and not equivalent:
                conflicts.append({'sourceNo':row['number'],'row':ordinal,'sourceAnswer':answer,
                                  'existingId':matched_id,'existingAnswer':previous})
                counts['duplicate_answer_conflicts']+=1
            continue
        id=f'C20260924-{ordinal:04d}'
        notes=[]
        if row['number']==1435:
            notes=['【校订说明】源文档将《公路工程施工安全技术规范》归为“部门规章”，此分类与规范的行业标准性质不符；原答案仅供辨认原题。']
        e=new_entry(id,row['number'],kind,stem,options,answer,C_SOURCE.name,notes)
        if id in VERIFIED_C_ANSWERS:
            set_answer(e, VERIFIED_C_ANSWERS[id])
        entries.append(e)
        by_id[id]=e
        matcher.add(id,e['blocks'][0])
        counts['C_imported']+=1
        counts[f'C_{kind}']+=1
    review,review_parsed=parse_review_novel()
    review_conflicts={
        'DT00093-Q':'ACE',
        'DT00124-Q':'BCDE',
        'DT00280-Q':'ABCDE',
        'DT00889-S04':'A',
        'DT01103-Q':'ABCD',
    }
    question_index={q['id']:(entry,q) for entry in entries for q in entry['blocks'] if q['kind']=='question'}
    for qid,source_answer in review_conflicts.items():
        entry,oldq=question_index[qid]
        oldgrams=grams(key(oldq['stem']))
        sources=[q for q in review_parsed if ''.join(q.get('answer',[]))==source_answer and
                 len(oldgrams & grams(key(q.get('question',''))))/max(1,len(oldgrams | grams(key(q.get('question','')))))>=.85]
        assert sources, f'Missing reviewed answer conflict for {qid}'
        if entry['id'] not in VERIFIED_C_ANSWERS:
            note=(f'【新版复习题答案冲突】2026-09-24复习题答案为{source_answer}，'
                  f'原题库答案为{oldq["answer"]}；两份材料不一致，尚未统一。')
            oldq['notes'].append(note)
            refresh_entry_search(entry)
        counts['review_answer_conflicts']+=1
    note=('【校订说明】原题答案 D=2000 万元保留。题干所引《生产安全事故报告和调查处理条例》第37条为 500 万元上限；'
          '《安全生产法》第114条对负有责任单位规定 1000 万至 2000 万元，情节特别严重、影响特别恶劣时可按该数额的 2 至 5 倍罚款。')
    stem=clean(review['question'])
    options=[{'key':o['key'],'text':clean(o['text'])} for o in review['options']]
    score,stem_score,_=matcher.nearest(stem,options)
    assert score<.90 or stem_score<.80, 'Review question is already in the bank'
    e=new_entry('R20260924-0001',review['sourceNo'],'单选',stem,options,'D',REVIEW_SOURCE.name,[note])
    entries.append(e)
    counts['review_imported']+=1
    bank['entries']=entries
    bank['generatedDate']=datetime.now().astimezone().date().isoformat()
    bank['sourceDocuments']=[
        {'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
        for p in (ROOT/'交安复习题全部.大题层级修正版-20260907.docx',C_SOURCE,REVIEW_SOURCE)
    ]
    BANK_PATH.write_text(json.dumps(bank,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    report={'counts':dict(counts),'totalEntries':len(entries),'held':held,'duplicateAnswerConflicts':conflicts}
    (ROOT/'tmp/import_20260924_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'counts':dict(counts),'totalEntries':len(entries),'held':held,'duplicateAnswerConflicts':conflicts},ensure_ascii=False))


if __name__=='__main__':
    main()
