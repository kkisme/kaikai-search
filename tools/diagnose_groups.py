#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""临时诊断：把逻辑行按题号分组，看哪些题号没有答案/选项。"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parse_questions

paras = json.load(open(Path(__file__).resolve().parents[1] / "data" / "raw_paragraphs.json", encoding="utf-8"))
lines = parse_questions.split_logical_lines(paras)

groups = []
cur = []
for l in lines:
    if parse_questions.is_heading(l):
        if cur:
            groups.append(cur)
            cur = []
        continue
    if parse_questions.is_question_start(l):
        if cur:
            groups.append(cur)
            cur = []
        cur = [l]
    else:
        if cur:
            cur.append(l)
if cur:
    groups.append(cur)

bad = []
for g in groups:
    joined = "\n".join(x["text"] for x in g)
    has_ans = bool(parse_questions.ANSWER_RE.search(joined))
    has_inline = bool(re.search(r"[（(]\s*[A-H√×]+\s*[)）]", joined))
    has_opt = bool(parse_questions.OPTION_RE.search(joined))
    if not (has_ans or has_inline or has_opt):
        bad.append(g)

print("groups", len(groups), "bad_no_answer_or_options", len(bad))
for g in bad[:30]:
    print("---")
    for x in g[:8]:
        print(x["src"], x["text"][:100])
