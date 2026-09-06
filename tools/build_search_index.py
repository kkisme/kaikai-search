#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 questions_raw.json 生成：
- data/questions.json：仅 verified 题目（保证答案与原文一致）
- data/search-index.json：搜索索引（全文/拼音/首字母/n-gram）
"""
import json
import re
from pathlib import Path

from pypinyin import Style, lazy_pinyin

PROJECT = Path(__file__).resolve().parents[1]
RAW = PROJECT / "data" / "questions_raw.json"
OUT_QUESTIONS = PROJECT / "data" / "questions.json"
OUT_INDEX = PROJECT / "data" / "search-index.json"


def norm_text(text: str) -> str:
    """全角转半角、去多余空格、小写。"""
    if not text:
        return ""
    # 全角 ASCII 转半角
    out = []
    for ch in text:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            out.append(chr(code - 0xFEE0))
        elif code == 0x3000:
            out.append(" ")
        else:
            out.append(ch)
    text = "".join(out).lower()
    # 全角中文标点保留，但统一空格
    text = re.sub(r"\s+", " ", text).strip()
    return text


def pinyin_full(text: str) -> str:
    """全拼，如 '安全生产' -> 'anquanshengchan'。"""
    return "".join(lazy_pinyin(text, style=Style.NORMAL)).replace(" ", "")


def pinyin_abbr(text: str) -> str:
    """首字母，如 '安全生产' -> 'aqsc'。"""
    return "".join(lazy_pinyin(text, style=Style.FIRST_LETTER)).replace(" ", "")


def ngrams(text: str, n: int = 2) -> list[str]:
    """中文/数字 n-gram，用于子串/模糊匹配。"""
    t = re.sub(r"\s+", "", text)
    if len(t) <= n:
        return [t]
    return [t[i:i + n] for i in range(len(t) - n + 1)]


def option_text(question) -> str:
    return " ".join(f"{o['key']}.{o['text']}" for o in question.get("options", []))


def make_search_doc(q, case_map=None) -> dict:
    case = None
    if case_map is not None and q.get("caseId"):
        case = case_map.get(q["caseId"])

    text_parts = [
        q.get("question", ""),
        option_text(q),
        q.get("answerText", ""),
        q.get("note", ""),
        q.get("chapter", ""),
        q.get("section", ""),
        q.get("materialText", ""),
    ]
    if case:
        text_parts.append(case.get("materialText", ""))
    text = " ".join(p for p in text_parts if p)
    normalized = norm_text(text)
    return {
        "id": q["id"],
        "type": q.get("type", ""),
        "typeName": q.get("typeName", ""),
        "chapter": q.get("chapter", ""),
        "section": q.get("section", ""),
        "sourceNo": q.get("sourceNo", ""),
        "question": q.get("questionClean") or q.get("question", ""),
        "options": q.get("options", []),
        "answer": q.get("answer", []),
        "answerText": q.get("answerText", ""),
        "note": q.get("note", ""),
        "materialText": q.get("materialText", ""),
        "caseId": q.get("caseId", ""),
        "caseTitle": case.get("title", "") if case else "",
        "caseMaterial": case.get("materialText", "") if case else "",
        "rawText": q.get("rawText", ""),
        "sourceParagraphStart": q.get("sourceParagraphStart"),
        "sourceParagraphEnd": q.get("sourceParagraphEnd"),
        "verificationStatus": q.get("verificationStatus", ""),
        "text": normalized,
        "textRaw": text,
        "pinyin": pinyin_full(normalized),
        "pinyinAbbr": pinyin_abbr(normalized),
        "grams": ngrams(normalized),
    }


# 题号前缀：91、 / 165、 / (1) / ① / 第1题
_QN_PREFIX_RE = re.compile(
    r"^(?:\d+[、.．](?!\d)\s*|\d+题[:：]?\s*|第\d+题[:：]?\s*|[（(]\d+[)）]\s*|[①②③④⑤⑥⑦⑧⑨⑩])"
)


def strip_qn_prefix(text: str) -> str:
    return _QN_PREFIX_RE.sub("", text).strip()


def make_knowledge_doc(k) -> dict:
    title = k.get("title", "")
    content = k.get("content", "")
    # 正文首行通常与标题相同（标题已在 question 字段单独显示），去掉避免重复
    lines = content.split("\n")
    if lines and lines[0].strip() and (
        lines[0].strip() == title.strip()
        or strip_qn_prefix(lines[0].strip()) == title.strip()
    ):
        content_view = "\n".join(lines[1:])
    else:
        content_view = content
    text = " ".join(x for x in [title, content_view] if x)
    normalized = norm_text(text)
    return {
        "id": "k_" + str(k.get("sourceParagraphStart", "0")) + "_" + str(k.get("sourceParagraphEnd", "0")),
        "type": "knowledge",
        "typeName": "知识卡片",
        "chapter": k.get("chapter", ""),
        "section": "", "sourceNo": "",
        "question": title,
        "options": [], "answer": [], "answerText": "",
        "note": "", "materialText": content_view,
        "caseId": "", "caseTitle": "", "caseMaterial": "",
        "rawText": content,
        "sourceParagraphStart": k.get("sourceParagraphStart"),
        "sourceParagraphEnd": k.get("sourceParagraphEnd"),
        "verificationStatus": "verified",
        "text": normalized,
        "textRaw": text,
        "pinyin": pinyin_full(normalized),
        "pinyinAbbr": pinyin_abbr(normalized),
        "grams": ngrams(normalized),
    }


def question_key(q) -> str:
    text = norm_text(q.get("questionClean") or q.get("question") or "")
    # 去空格/括号，尽量让“同一题不同写法”归并
    text = text.replace(" ", "")
    for ch in ("（", "）", "(", ")", "【", "】", "[", "]", "，", ","):
        text = text.replace(ch, "")
    return text


def main() -> None:
    data = json.loads(RAW.read_text(encoding="utf-8"))
    all_qs = data["questions"]
    case_map = {g["id"]: g for g in data.get("case_groups", [])}
    # 只有 verified 才进正式题库，并按题干去重
    verified_all = [q for q in all_qs if q.get("verificationStatus") == "verified"]
    review = [q for q in all_qs if q.get("verificationStatus") != "verified"]
    verified = []
    seen_keys = set()
    duplicate_count = 0
    for q in verified_all:
        key = question_key(q)
        if key in seen_keys:
            duplicate_count += 1
            continue
        seen_keys.add(key)
        verified.append(q)

    docs = [make_search_doc(q, case_map) for q in verified]
    knowledge_docs = [make_knowledge_doc(k) for k in data.get("knowledge_cards", [])]
    docs.extend(knowledge_docs)

    index = {
        "version": "v0.2",
        "count": len(docs),
        "questionCount": len(verified),
        "duplicateQuestionCount": duplicate_count,
        "knowledgeCount": len(knowledge_docs),
        "totalParsed": len(all_qs),
        "reviewCount": len(review),
        "docs": docs,
    }

    OUT_QUESTIONS.write_text(
        json.dumps({"questions": verified, "duplicateRemoved": duplicate_count, "review": review}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUT_INDEX.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"总解析题目: {len(all_qs)}")
    print(f"已入库(verified): {len(verified)}")
    print(f"知识/记录卡片: {len(knowledge_docs)}")
    print(f"待确认(review): {len(review)}")
    print(f"写出: {OUT_QUESTIONS}")
    print(f"写出: {OUT_INDEX}")


if __name__ == "__main__":
    main()
