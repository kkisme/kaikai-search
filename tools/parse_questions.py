#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
交安复习题全部.docx 第一版解析器。

思路：
1. 从 raw_paragraphs.json 读取原文档段落。
2. 把“一行内混有多个选项/下一题”的段落拆成逻辑行。
3. 用状态机切分：章节标题 / 案例背景 / 知识卡片 / 普通题目。
4. 解析题目：题号、题干、选项、答案、备注。
5. 输出 questions_raw.json 和 parse_report.json（含答案对齐统计）。

本版本优先保证：答案必须来自原文；有冲突/缺失时标记 review，不猜答案。
"""
import json
import re
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
RAW = PROJECT / "data" / "raw_paragraphs.json"
OUT_QUESTIONS = PROJECT / "data" / "questions_raw.json"
OUT_REPORT = PROJECT / "data" / "parse_report.json"

# ---------- 正则 ----------
HEADING_RE = re.compile(
    r"^(?:"
    r"[一二三四五六七八九十]+[、.．]\s*"
    r"|[（(][一二三四五六七八九十]+[)）]\s*"
    r"|第[一二三四五六七八九十]+章\s*"
    r")"
)
TYPE_HEADING_KEYWORDS = ("单选题", "多选题", "判断题", "填空题", "案例分析题", "综合知识", "法律")
QUESTION_START_RE = re.compile(
    r"^(?:"
    r"\d+[、.．]\s*"
    r"|\d+题[:：]?\s*"
    r"|第\d+题[:：]?\s*"
    r"|[（(]\d+[)）]\s*问[:：]?\s*"
    r"|[①②③④⑤⑥⑦⑧⑨⑩]"
    r")"
)
CASE_SUB_RE = re.compile(r"^(?:[（(]\d+[)）]\s*问[:：]?|[①②③④⑤⑥⑦⑧⑨⑩])")
OPTION_RE = re.compile(r"^([A-H])[、.．]\s*(.*)$")
ANSWER_RE = re.compile(r"^(?:正确答案|答案)\s*[:：]\s*(.+)$")
INLINE_ANSWER_RE = re.compile(r"[（(]\s*([A-HA-H,，√×]+)\s*[)）]")


def split_logical_lines(paragraphs):
    """把原始段落拆成逻辑行，保留原段落序号 src。"""
    lines = []
    for para in paragraphs:
        text = para["text"].replace("\r", " ").replace("\n", " ")
        # 选项切分：A.xxxB.xxx
        text = re.sub(r"(?=[A-H][、.．])", "\n", text)
        # 题目号切分：D.xxx 3、xxx
        text = re.sub(r"(?<![0-9])(?=\d+[、.．])", "\n", text)
        text = re.sub(r"(?<=\S)(?=\d+题[:：])", "\n", text)
        text = re.sub(r"(?<=\S)(?=第\d+题)", "\n", text)
        text = re.sub(r"(?<=\S)(?=[（(]\d+[)）]\s*问[:：]?)", "\n", text)
        text = re.sub(r"(?<=\S)(?=[①②③④⑤⑥⑦⑧⑨⑩])", "\n", text)
        # 章节标题切分：E.能排水上浮三、判断题
        text = re.sub(r"(?<=\S)(?=[一二三四五六七八九十]+、)", "\n", text)
        for seg in text.split("\n"):
            seg = re.sub(r"\s+", " ", seg).strip()
            if seg:
                lines.append({"text": seg, "src": para["index"]})
    return lines


def is_heading(line):
    text = line["text"]
    if not HEADING_RE.match(text):
        return False
    # 已知“一、一次性工亡补助金……”这类是正文，不是章节标题
    if re.match(r"^[一二三四五六七八九十]+、一次性|^[一二三四五六七八九十]+、丧葬|^[一二三四五六七八九十]+、供养|^[一二三四五六七八九十]+、特别重大|^[一二三四五六七八九十]+、重大事故|^[一二三四五六七八九十]+、较大事故|^[一二三四五六七八九十]+、一般事故", text):
        return False
    # 行很短/含题型关键词/含章关键词才认为是标题
    if any(k in text for k in TYPE_HEADING_KEYWORDS):
        return True
    if len(text) <= 30:
        return True
    return False


def is_question_start(line):
    return bool(QUESTION_START_RE.match(line["text"]))


def is_case_material_start(line):
    text = line["text"]
    return text.startswith("背景资料") or "印刷资料" in text[:20]


def normalize_answer_text(ans_part):
    """归一化 'A，C，E' / 'AB' / '正确' / '错误' / '√' / '×'。"""
    ans_part = ans_part.strip()
    # 全角逗号/顿号/空格 -> 半角逗号
    ans_part = re.sub(r"[，、\s]+", ",", ans_part)
    if ans_part in ("正确", "对"):
        return {"letters": [], "answerText": "正确", "rawAnswer": ans_part}
    if ans_part in ("错误", "错"):
        return {"letters": [], "answerText": "错误", "rawAnswer": ans_part}
    if ans_part == "√":
        return {"letters": [], "answerText": "正确", "rawAnswer": ans_part}
    if ans_part == "×":
        return {"letters": [], "answerText": "错误", "rawAnswer": ans_part}
    # 字母列表：A,B,C 或 AB 或 A B C
    letters = re.findall(r"[A-Ha-h]", ans_part)
    letters = [x.upper() for x in letters]
    # 去重保序
    seen = []
    for x in letters:
        if x not in seen:
            seen.append(x)
    if seen:
        return {"letters": seen, "answerText": ",".join(seen), "rawAnswer": ans_part}
    return {"letters": [], "answerText": ans_part, "rawAnswer": ans_part}


def split_note_from_answer(raw):
    """从 'C（注：xxx）' 中分离答案和备注。"""
    m = re.match(r"^([^（(]+?)\s*[（(](.+)[)）]\s*$", raw)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return raw.strip(), ""


def parse_answer_line(line_text):
    m = ANSWER_RE.match(line_text)
    if not m:
        return None
    raw = m.group(1).strip()
    ans_part, note = split_note_from_answer(raw)
    nt = normalize_answer_text(ans_part)
    return {
        "answerRaw": line_text.strip(),
        "answerValue": ans_part,
        "answerSource": "answer_line",
        "answerConfidence": "high",
        "letters": nt["letters"],
        "answerText": nt["answerText"],
        "note": note,
    }


def parse_inline_answer(text):
    """从题干中提取内嵌答案，如 ( C ) / （√） / （ACD）。"""
    m = INLINE_ANSWER_RE.search(text)
    if not m:
        return None, None
    raw = m.group(1).strip()
    if not raw:
        return None, None
    if raw in ("√", "×"):
        nt = normalize_answer_text(raw)
        return nt, m.group(0)
    # 字母
    letters = re.findall(r"[A-Ha-h]", raw)
    if not letters:
        return None, None
    letters = [x.upper() for x in letters]
    seen = []
    for x in letters:
        if x not in seen:
            seen.append(x)
    return {"letters": seen, "answerText": ",".join(seen), "rawAnswer": raw}, m.group(0)


def strip_question_prefix(text):
    m = QUESTION_START_RE.match(text)
    if not m:
        return text
    return text[m.end():].strip()


def build_question(bucket, context, case_group):
    """从 question bucket 解析一道题。"""
    lines = bucket["lines"]
    first = lines[0]
    text = first["text"]
    src_start = first["src"]
    src_end = lines[-1]["src"]

    q = {
        "id": "",
        "type": context.get("type") or "single",
        "typeName": context.get("typeName") or "单选题",
        "chapter": context.get("chapter") or "",
        "section": context.get("section") or "",
        "sourceNo": "",
        "sourceParagraphStart": src_start,
        "sourceParagraphEnd": src_end,
        "rawText": "\n".join(x["text"] for x in lines),
        "question": "",
        "questionClean": "",
        "options": [],
        "answer": [],
        "answerText": "",
        "answerRaw": "",
        "answerSource": "",
        "answerConfidence": "low",
        "verificationStatus": "review",
        "note": "",
        "caseId": "",
        "materialText": "",
    }

    # 题号
    m_no = re.match(r"^(\d+)[、.．]?\s*|^\d+题[:：]?\s*|^第(\d+)题[:：]?\s*|^[（(](\d+)[)）]\s*问[:：]?\s*", text)
    if m_no:
        groups = [g for g in m_no.groups() if g]
        if groups:
            q["sourceNo"] = groups[0]

    # 判断是否为案例子题
    is_case_sub = bool(CASE_SUB_RE.match(text))

    # 题干首行
    stem = strip_question_prefix(text)
    q["question"] = stem

    # 后续行解析
    options = []
    orphan_pre = []   # 第一个选项出现前的非选项文本（可能是缺失标签的选项）
    orphan_post = []  # 选项出现后的非选项文本（可能是缺失中间标签/续行）
    answer_info = None
    inline_info = None
    seen_option = False

    for line in lines[1:]:
        lt = line["text"]
        ans = parse_answer_line(lt)
        if ans:
            answer_info = ans
            continue
        mo = OPTION_RE.match(lt)
        if mo:
            key = mo.group(1)
            opt_text = mo.group(2).strip()
            options.append({"key": key, "text": opt_text})
            seen_option = True
            continue
        # 非选项、非答案文本
        if not seen_option:
            orphan_pre.append(lt)
        else:
            orphan_post.append(lt)

    # 内嵌答案
    all_text = " ".join(x["text"] for x in lines)
    inline_info, inline_matched = parse_inline_answer(all_text)
    if inline_info:
        # 用题干首行 + 后续文本中的内嵌答案作为来源
        q["answerSource"] = "inline_paren"
        q["answerConfidence"] = "high"
        q["answerRaw"] = inline_matched

    # 显式答案优先
    if answer_info:
        q["answerSource"] = answer_info["answerSource"]
        q["answerConfidence"] = answer_info["answerConfidence"]
        q["answerRaw"] = answer_info["answerRaw"]
        q["note"] = answer_info["note"]
        q["answer"] = answer_info["letters"]
        q["answerText"] = answer_info["answerText"]
        if inline_info and inline_info["letters"]:
            inline_letters = sorted(inline_info["letters"])
            answer_letters = sorted(answer_info["letters"])
            if inline_letters != answer_letters:
                q["verificationStatus"] = "review"
                q["answerConflict"] = {
                    "inline": inline_letters,
                    "answer_line": answer_letters,
                }
            else:
                q["verificationStatus"] = "verified"
        else:
            q["verificationStatus"] = "verified"
    elif inline_info:
        q["answer"] = inline_info["letters"]
        q["answerText"] = inline_info["answerText"]
        q["answerRaw"] = inline_info["rawAnswer"]
        # 即使是 √/×，也算从原文明确提取，直接 verified
        q["verificationStatus"] = "verified"

    # 填空题（题干有括号但无答案）→ 缺失
    if not q["answer"] and not q["answerText"]:
        q["answerConfidence"] = "low"
        q["verificationStatus"] = "missing" if re.search(r"[（(]\s*[)）]", q["question"]) else "review"

    # 缺失选项标签修复：如果第一个选项不是 A，且前面有孤立文本
    if options and orphan_pre:
        first_key_ord = ord(options[0]["key"]) - ord("A")
        # 第一个选项出现前所有孤立文本按顺序补到 A..first_key-1
        need = max(0, first_key_ord)
        fill = orphan_pre[:need]
        rest_pre = orphan_pre[need:]
        if fill:
            filled = []
            for i, txt in enumerate(fill):
                filled.append({"key": chr(ord("A") + i), "text": txt})
            options = filled + options
            # 剩余可能属于题干续行，暂时并入题干
            if rest_pre:
                q["question"] += " " + " ".join(rest_pre)
        else:
            q["question"] += " " + " ".join(orphan_pre)
    elif orphan_pre:
        # 没有选项时，孤立文本并入题干
        q["question"] += " " + " ".join(orphan_pre)

    # 选项后缺失标签的候补：如果文本短、不像完整句子，且选项还没到 H，则按顺序补下一个字母
    if options and orphan_post:
        next_ord = ord(options[-1]["key"]) - ord("A") + 1
        for txt in orphan_post:
            looks_option = (
                len(txt) <= 60
                and not txt.endswith(("。", "；", "；", "："))
                and next_ord <= ord("H") - ord("A")
            )
            if looks_option:
                options.append({"key": chr(ord("A") + next_ord), "text": txt})
                next_ord += 1
            else:
                q["question"] += " " + txt
    elif orphan_post:
        # 没有选项时，孤立文本并入题干
        q["question"] += " " + " ".join(orphan_post)

    # 去括号内答案，生成 questionClean（用于展示干净题干）
    if inline_matched and q["question"]:
        q["questionClean"] = q["question"].replace(inline_matched, "（ ）")
    else:
        q["questionClean"] = q["question"]

    # 把解析出的选项写回题目
    q["options"] = options

    # 答案合法性校验
    if q["answer"]:
        answer_keys = [x.upper() for x in q["answer"]]
        option_keys = [x["key"] for x in options]
        if option_keys:
            bad = [k for k in answer_keys if k not in option_keys]
            if bad:
                q["verificationStatus"] = "review"
                q["answerOutOfOptions"] = bad
        # 单选校验
        if q.get("type") == "single" and len(answer_keys) > 1:
            q["verificationStatus"] = "review"
            q["answerConflict"] = q.get("answerConflict") or {"multi_in_single": answer_keys}

    # 案例子题挂到 case_group
    if is_case_sub and case_group:
        q["caseId"] = case_group["id"]
        q["type"] = "case"
        q["typeName"] = "案例分析题"

    return q


def finalize_bucket(bucket, context, case_groups, questions, knowledge_cards, case_materials):
    kind = bucket["kind"]
    lines = bucket["lines"]
    if not lines:
        return
    first_text = lines[0]["text"]

    if kind == "case_material":
        case_groups.append({
            "id": f"case_{len(case_groups)+1:03d}",
            "title": first_text,
            "type": "case",
            "chapter": context.get("chapter") or "案例分析题",
            "materialText": "\n".join(x["text"] for x in lines),
            "sourceParagraphStart": lines[0]["src"],
            "sourceParagraphEnd": lines[-1]["src"],
            "subQuestionIds": [],
        })
        return

    if kind == "question":
        # 没有答案、没有选项、也没有括号答案的知识/背景段落不当作题
        joined = "\n".join(x["text"] for x in lines)
        has_answer_line = bool(ANSWER_RE.search(joined))
        has_inline = bool(re.search(r"[（(]\s*[A-H√×]+\s*[)）]", joined))
        has_option = bool(OPTION_RE.search(joined))
        if not (has_answer_line or has_inline or has_option):
            # 可能是知识卡片/背景资料
            knowledge_cards.append({
                "type": "knowledge",
                "title": strip_question_prefix(first_text) if is_question_start(lines[0]) else first_text,
                "content": "\n".join(x["text"] for x in lines),
                "sourceParagraphStart": lines[0]["src"],
                "sourceParagraphEnd": lines[-1]["src"],
            })
            return
        q = build_question(bucket, context, case_groups[-1] if case_groups else None)
        q["id"] = f"q_{len(questions)+1:06d}"
        if q["caseId"] and case_groups:
            case_groups[int(q["caseId"].split("_")[1]) - 1]["subQuestionIds"].append(q["id"])
        questions.append(q)
        return

    # unknown：当成知识/材料
    knowledge_cards.append({
        "type": "knowledge",
        "title": first_text[:50],
        "content": "\n".join(x["text"] for x in lines),
        "sourceParagraphStart": lines[0]["src"],
        "sourceParagraphEnd": lines[-1]["src"],
    })


def parse():
    with open(RAW, encoding="utf-8") as f:
        paragraphs = json.load(f)

    logical_lines = split_logical_lines(paragraphs)
    questions = []
    knowledge_cards = []
    case_groups = []
    case_materials = []
    context = {"chapter": "", "section": "", "type": None, "typeName": ""}
    bucket = None
    warnings = []

    def flush():
        nonlocal bucket
        if bucket is not None:
            finalize_bucket(bucket, context, case_groups, questions, knowledge_cards, case_materials)
            bucket = None

    for line in logical_lines:
        text = line["text"]

        if is_heading(line):
            flush()
            # 更新上下文
            if any(k in text for k in ("单选题", "多选题", "判断题", "填空题")):
                for t in ("单选题", "多选题", "判断题", "填空题"):
                    if t in text:
                        context["type"] = {"单选题": "single", "多选题": "multiple", "判断题": "judge", "填空题": "fill"}[t]
                        context["typeName"] = t
                        break
            if "案例分析" in text:
                context["chapter"] = text
                context["section"] = "案例分析题"
                context["type"] = "case"
                context["typeName"] = "案例分析题"
            elif any(k in text for k in ("综合知识", "法律", "隧道工程")):
                context["chapter"] = text
                context["section"] = context.get("section") or text
            continue

        if is_case_material_start(line):
            flush()
            bucket = {"kind": "case_material", "lines": [line]}
            # 创建 case group 由 finalize 处理；提前创建以支持题组
            continue

        if is_question_start(line):
            flush()
            bucket = {"kind": "question", "lines": [line]}
            continue

        # 非题目内容
        if bucket is None:
            bucket = {"kind": "unknown", "lines": [line]}
        else:
            bucket["lines"].append(line)

    flush()

    # 汇总统计
    stats = {
        "totalParagraphs": len(paragraphs),
        "logicalLines": len(logical_lines),
        "recognizedQuestions": len(questions),
        "caseGroups": len(case_groups),
        "caseSubQuestions": sum(1 for q in questions if q.get("type") == "case"),
        "knowledgeCards": len(knowledge_cards),
        "missingAnswer": sum(1 for q in questions if q.get("verificationStatus") == "missing"),
        "answerConflict": sum(1 for q in questions if q.get("answerConflict")),
        "answerOutOfOptions": sum(1 for q in questions if q.get("answerOutOfOptions")),
        "reviewQuestions": sum(1 for q in questions if q.get("verificationStatus") == "review"),
        "verifiedQuestions": sum(1 for q in questions if q.get("verificationStatus") == "verified"),
        "warnings": warnings,
    }

    # 写入
    out = {
        "questions": questions,
        "case_groups": case_groups,
        "knowledge_cards": knowledge_cards,
        "stats": stats,
    }
    OUT_QUESTIONS.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_REPORT.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parse()
