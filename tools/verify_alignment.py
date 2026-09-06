#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
与源文件对齐校验：
- 每题 rawText 是否确实来自 sourceParagraphStart~End 的原文段落
- 答案 answerRaw / answerText 是否能在 rawText 中找到
- 汇总 verified / review / 不一致
"""
import json
import re
from collections import Counter
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
RAW_PARAS = PROJECT / "data" / "raw_paragraphs.json"
RAW_QS = PROJECT / "data" / "questions_raw.json"
OUT = PROJECT / "data" / "alignment_report.json"

import sys
sys.path.insert(0, str(PROJECT / "tools"))
import parse_questions


def normalize(s: str) -> str:
    s = s.replace("\u3000", " ").strip()
    s = re.sub(r"\s+", " ", s)
    return s


def main():
    paras = json.loads(RAW_PARAS.read_text(encoding="utf-8"))
    data = json.loads(RAW_QS.read_text(encoding="utf-8"))
    questions = data["questions"]
    logical_lines = parse_questions.split_logical_lines(paras)

    # 按 src 建立 logical lines 索引
    by_src = {}
    for line in logical_lines:
        by_src.setdefault(line["src"], []).append(line["text"])

    issues = []
    verified_ok = 0
    source_ok = 0
    answer_ok = 0
    answer_traceable = 0

    for q in questions:
        start = q.get("sourceParagraphStart")
        end = q.get("sourceParagraphEnd")
        if start is None or end is None:
            issues.append(f"{q['id']}: 缺少 sourceParagraphStart/End")
            continue

        # 1) rawText 来源校验：rawText 的每一行都必须来自 sourceParagraphStart~End 的原文逻辑行
        src_available = []
        for i in range(start, end + 1):
            src_available.extend(by_src.get(i, []))
        raw_lines = [x for x in q.get("rawText", "").split("\n") if x]
        if Counter(raw_lines) <= Counter(src_available):
            source_ok += 1
        else:
            issues.append(f"{q['id']}: rawText 中存在不在源段落范围的内容")

        # 2) 答案可溯源校验
        raw = q.get("rawText", "")
        answerRaw = q.get("answerRaw", "")
        answerText = q.get("answerText", "")
        letters = [x.upper() for x in q.get("answer") or []]
        trace_ok = False
        if answerRaw and normalize(answerRaw) in normalize(raw):
            trace_ok = True
        if answerText and normalize(answerText) in normalize(raw):
            trace_ok = True
        if letters and all(x in raw for x in letters):
            trace_ok = True
        if trace_ok:
            answer_traceable += 1
        else:
            issues.append(f"{q['id']}: 答案无法在原文中找到 answerRaw={answerRaw!r} answerText={answerText!r}")

        if q.get("verificationStatus") == "verified":
            verified_ok += 1
            answer_ok += 1
        elif q.get("verificationStatus") == "review":
            answer_ok += 0
        else:
            answer_ok += 0

        # 3) 答案字母是否在选项内
        option_keys = [o["key"] for o in q.get("options", [])]
        if letters and option_keys:
            bad = [k for k in letters if k not in option_keys]
            if bad:
                issues.append(f"{q['id']}: 答案字母不在选项内 {bad}")

    report = {
        "totalQuestions": len(questions),
        "sourceSpanOk": source_ok,
        "answerTraceable": answer_traceable,
        "verifiedQuestions": verified_ok,
        "reviewQuestions": len([q for q in questions if q.get("verificationStatus") != "verified"]),
        "answerOutOfOptions": len([q for q in questions if q.get("answerOutOfOptions")]),
        "issues": issues[:200],
        "issueCount": len(issues),
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "issues"}, ensure_ascii=False, indent=2))
    if issues:
        print(f"\n问题数: {len(issues)}")
        for i in issues[:30]:
            print(i)


if __name__ == "__main__":
    main()
