"""Generate the road testing bank from the reviewed Word document."""

import argparse
import hashlib
import json
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile

from docx import Document
from docx.oxml.ns import qn
from pypinyin import Style, lazy_pinyin

from build_reviewed_bank import join_fragments, normalize


ROOT = Path(__file__).resolve().parents[1]
NAME = '公路试验-技能提升试题题库'
TYPES = {'单项选择题': '单选', '多项选择题': '多选', '判断题': '判断', '填空题': '填空'}
SUPERSCRIPT = str.maketrans('0123456789+-', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻')
SUBSCRIPT = str.maketrans('0123456789+-', '₀₁₂₃₄₅₆₇₈₉₊₋')


def math_text(node):
    def part(name):
        return math_text(node.find(qn(f'm:{name}')))

    if node.tag == qn('m:t'):
        return node.text or ''
    if node.tag == qn('m:f'):
        return f'({part("num")})/({part("den")})'
    if node.tag == qn('m:sSub'):
        return f'{part("e")}_{part("sub")}'
    if node.tag == qn('m:sSup'):
        exponent = part('sup')
        return part('e') + ('′' if exponent == '′' else f'^({exponent})')
    if node.tag not in {qn(f'm:{tag}') for tag in ('oMath', 'r', 'e', 'num', 'den', 'sub', 'sup')}:
        raise ValueError(f'不支持的公式元素 {node.tag}')
    return ''.join(math_text(child) for child in node if not child.tag.endswith('Pr'))


def paragraph_text(paragraph, number):
    parts = []
    for node in paragraph._p:
        if node.tag == qn('m:oMath'):
            parts.append(math_text(node))
        if node.tag != qn('w:r'):
            continue
        if node.find(qn('w:object')) is not None:
            # The reviewed radar question includes one embedded formula, transcribed from its Word preview.
            shape = node.find('.//{urn:schemas-microsoft-com:vml}shape')
            if number != 174 or shape is None or shape.get('id') != '_x0000_i1025':
                raise ValueError(f'第 {number} 题含有尚未转录的嵌入对象')
            parts.append('(3×10^8)/(√9)')
        text = ''.join(child.text or '' if child.tag == qn('w:t') else '\t'
                       for child in node if child.tag in (qn('w:t'), qn('w:tab')))
        vertical = node.find(f'{qn("w:rPr")}/{qn("w:vertAlign")}')
        alignment = vertical.get(qn('w:val')) if vertical is not None else None
        if text and alignment in ('superscript', 'subscript'):
            table = SUPERSCRIPT if alignment == 'superscript' else SUBSCRIPT
            text = text.translate(table) if re.fullmatch(r'[0-9+-]+', text) else f'{"^" if alignment == "superscript" else "_"}({text})'
        parts.append(text)
    return ''.join(parts).strip()


def finalize(entry):
    question = entry['blocks'][0]
    kind = question['type']
    keys = ''.join(option['key'] for option in question['options'])
    answer = question['answer']
    if kind in ('单选', '多选'):
        answer = re.sub(r'[、,，\s]', '', answer)
        size_ok = len(answer) == 1 if kind == '单选' else len(answer) > 1
        if len(keys) < 2 or keys != 'ABCDEFGH'[:len(keys)] or not size_ok or not set(answer) <= set(keys) or len(answer) != len(set(answer)):
            raise ValueError(f'{entry["sourceNo"]} 题的选项或答案格式不正确')
    elif keys or not answer or kind == '判断' and answer not in ('正确', '错误'):
        raise ValueError(f'{entry["sourceNo"]} 题的答案格式不正确')
    question['answer'] = answer
    entry['title'] = question['stem'][:100]
    raw = '\n'.join([question['stem'], *(option['text'] for option in question['options']), answer, *question['notes']])
    entry['search'] = {
        'text': normalize(raw),
        'pinyin': normalize(''.join(lazy_pinyin(raw, style=Style.NORMAL))),
        'initials': normalize(''.join(lazy_pinyin(raw, style=Style.FIRST_LETTER))),
    }


def build(source, date):
    source_bytes = source.read_bytes()
    entries = []
    section = ''
    question = None
    for p in Document(BytesIO(source_bytes)).paragraphs:
        style = p.style.name
        if style == 'Heading 1':
            section = p.text.strip()
            if section not in TYPES:
                raise ValueError(f'无法识别的题型 {section}')
            question = None
        elif style == '题库题干':
            number = len(entries) + 1
            match = re.fullmatch(r'(\d+)\.\t(.+)', paragraph_text(p, number))
            if not match or int(match[1]) != number:
                raise ValueError(f'题号应为 {number}，实际为 {p.text!r}')
            entry_id = f'ROAD{number:04d}'
            question = {'kind': 'question', 'id': f'{entry_id}-Q', 'type': TYPES[section],
                        'stem': match[2], 'options': [], 'answer': '', 'notes': []}
            entries.append({'id': entry_id, 'sourceNo': str(number), 'type': TYPES[section],
                            'section': section, 'blocks': [question]})
        elif style not in ('Title', '题库说明'):
            if question is None:
                raise ValueError(f'题干外出现 {style} 段落')
            text = paragraph_text(p, len(entries))
            if style == '题干续段':
                question['stem'] = join_fragments(question['stem'], text)
            elif style == '题库选项':
                key, value = text.split('.\t', 1)
                if not value.strip():
                    raise ValueError(f'第 {len(entries)} 题有空白选项')
                question['options'].append({'key': key, 'text': value})
            elif style == '选项续段':
                option = question['options'][-1]
                option['text'] = join_fragments(option['text'], text)
            elif style == '题库答案' and text.startswith('答案　') and not question['answer']:
                question['answer'] = text.removeprefix('答案　')
            elif style == '题库解析':
                question['notes'].append(re.sub(r'^(解析|补充解析)　', r'\1：', text))
            elif style == '题库来源':
                if text.startswith('难度　'):
                    question['notes'].append(text.replace('难度　', '难度：', 1))
                elif not text.startswith(('合并来源　', '同题干的其他选项版本见第 ')):
                    raise ValueError(f'未识别的题库来源 {text}')
            else:
                raise ValueError(f'第 {len(entries)} 题存在未处理的段落 {style} {text!r}')
    for entry in entries:
        finalize(entry)
    if not entries:
        raise ValueError('源文档中没有题目')
    return {'schemaVersion': 4, 'name': NAME, 'generatedDate': date, 'source': source.name,
            'sourceSha256': hashlib.sha256(source_bytes).hexdigest(), 'entries': entries}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / '公路-技能提升试题题库（核对修订版）.docx')
    parser.add_argument('--date', default=datetime.now().astimezone().date().isoformat())
    args = parser.parse_args()
    data = build(args.source, args.date)
    output = ROOT / 'docs' / 'road-skills-bank.json'
    with NamedTemporaryFile(dir=output.parent, mode='w', encoding='utf-8', delete=False) as file:
        temporary = Path(file.name)
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Exported {len(data["entries"])} complete entries to {output}')
