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
    r"\d+[、.．](?!\d)\s*"
    r"|\d+题[:：]?\s*"
    r"|第\d+题[:：]?\s*"
    r"|[（(]\d+[)）]\s*"
    r"|[①②③④⑤⑥⑦⑧⑨⑩]"
    r"|问[:：]"
    r")"
)
CASE_SUB_RE = re.compile(r"^(?:[（(]\d+[)）]|[①②③④⑤⑥⑦⑧⑨⑩])")
ASK_LEAD_RE = re.compile(r"^问[:：]\s*")
# 选项标签：A. / B、 / C． / D, / E， / F 空格（原文有“B 造成重伤…”标签点丢失的情况）
OPTION_RE = re.compile(r"^([A-H])[、.．,，\s]\s*(.*)$")
ANSWER_RE = re.compile(r"^(?:正确答案|答案)\s*[:：]\s*(.+)$")
# 内嵌答案：字母组合 / √ / × / X / 正确 / 错误（原文有“（正确）”“(错误)”“(X)”等写法）
INLINE_ANSWER_RE = re.compile(
    r"[（(]\s*((?=[A-Ha-h])[A-Ha-h,，、\s]{1,10}|√|×|[Xx]|正确|错误|对|错)\s*[)）]"
)
# 整行只有答案括号的“答案行”（如 (A) / （√） / (X)）
PURE_ANSWER_LINE_RE = re.compile(
    r"^\s*[（(]\s*(?:[A-Ha-h][A-Ha-h,，、\s]*|√|×|[Xx]|正确|错误|对|错)\s*[)）]\s*"
    r"(?:[（(]?(?:注|解读|知识点)[:：].*)?$"
)
# 知识/注释引导行（“知识点:”“注:”“知识点(1)”等）
NOTE_LEAD_RE = re.compile(r"^(?:知识点|注|解读)(?:[:：]|[（(]\d+[)）])")
# 案例/知识中的纯标题行：第1题: / 第2题 / 第3题印刷资料
CASE_TITLE_LINE_RE = re.compile(r"^第?\d+题[:：]?\s*(?:印刷资料)?$")
# 编号列表项：1、2、3、或①②③ 或 (1)(2)（不匹配 13.6% 这类小数）
LIST_ITEM_RE = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+[、]|^\d+[.．](?!\d)|^[（(]\d+[)）]")
_CN_NUM_ORDER = "①②③④⑤⑥⑦⑧⑨⑩"


def list_item_number(text):
    """提取列表项编号：1、2、3 / ① ② ③ / (1)(2)。不是列表项返回 None。"""
    m = re.match(r"^([1-9]\d*)[、.．]", text)
    if m:
        return int(m.group(1))
    m = re.match(r"^[（(]([1-9]\d*)[)）]", text)
    if m:
        return int(m.group(1))
    if text and text[0] in _CN_NUM_ORDER:
        return _CN_NUM_ORDER.index(text[0]) + 1
    return None
# 知识区块标题（题号+关键词）：205、预备知识一… / 165、…的主要内容 / 240、…安全控制要求
KNOWLEDGE_TITLE_RE = re.compile(
    r"^\d+[、.．].{0,60}(?:预备知识|安全控制要求|主要内容|的概念|的种类|的知识|的管理)"
)


def split_logical_lines(paragraphs):
    """把原始段落拆成逻辑行，保留原段落序号 src。"""
    lines = []
    for para in paragraphs:
        text = para["text"].replace("\r", " ").replace("\n", " ")
        # 选项切分：A.xxxB.xxx；不切题干括号内答案（如 (A,B)），不切答案行（正确答案:A,B）
        text = re.sub(r"(?<![（(：:,])(?=[A-H][、.．])", "\n", text)
        # “C,36小时”这类选项标签为逗号且选项文本是数字时也切（“A,B,C”答案列表不切）
        text = re.sub(r"(?<![（(：:,，])(?=[A-H][,，](?![A-H]))", "\n", text)
        # 题目号切分：D.xxx 3、xxx；不切小数点（如 A.1.5年），不切比例（1:8:25.），不拆“第1题:”
        text = re.sub(r"(?<![0-9.:/：])(?=\d+(?:[、]|[.．](?!\d)))", "\n", text)
        text = re.sub(r"(?<=\S)(?=(?<!\d)(?<!第)\d+题[:：])", "\n", text)
        text = re.sub(r"(?<=\S)(?=第\d+题)", "\n", text)
        # “…受轻伤。 (1)问:…”：空格后也可能出现子题号，直接按子题模式切
        text = re.sub(r"(?=[（(]\d+[)）]\s*问[:：]?)", "\n", text)
        text = re.sub(r"(?<=\S)(?=[①②③④⑤⑥⑦⑧⑨⑩])", "\n", text)
        # 章节标题切分：E.能排水上浮三、判断题；只按关键词切，避免切碎选项文本里的“一、预防为主”
        text = re.sub(
            r"(?<=\S)(?=[一二三四五六七八九十]+、(?:单选题|多选题|判断题|填空题|案例分析题|综合知识|法律))",
            "\n", text)
        for seg in text.split("\n"):
            seg = re.sub(r"\s+", " ", seg).strip()
            # 原文模板占位垃圾行直接丢弃
            if re.match(r"^(?:文档标题|摘要|\[文档标题\])", seg):
                continue
            if seg:
                lines.append({"text": seg, "src": para["index"]})

    # 合并被误拆的数值选项：A. + 1.5 年 -> A.1.5 年；B. + 200 -> B.200
    merged = []
    for line in lines:
        if (
            merged
            and re.fullmatch(r"[A-H]\.", merged[-1]["text"])
            and re.match(r"^\d", line["text"])
            and merged[-1]["src"] == line["src"]
        ):
            merged[-1]["text"] = merged[-1]["text"] + line["text"]
        else:
            merged.append(line)

    # “A.xxx B yyy”行内混入下一条选项（原文标签点丢失）：按“ B ”拆开，保留剩余部分
    fixed = []
    for line in merged:
        if OPTION_RE.match(line["text"]) and re.search(r" [B-H] ", line["text"]):
            parts = re.split(r" (?=[B-H] )", line["text"])
            for part in parts:
                part = re.sub(r"\s+", " ", part).strip()
                if part:
                    fixed.append({"text": part, "src": line["src"]})
        else:
            fixed.append(line)
    merged = fixed
    return merged


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


def is_case_parent_candidate(bucket):
    """判断一个没有答案/选项的编号段落是否是案例分析题的父题/背景。"""
    lines = bucket["lines"]
    if not lines:
        return False
    first = lines[0]["text"]
    # 必须像“64、……”“78、……”这样的题号开头
    if not re.match(r"^\d+[、.．]", first):
        return False
    # 本身不能是子题
    if CASE_SUB_RE.match(first):
        return False
    # 至少包含一段背景叙述（不是单独一行）
    if len(lines) < 3:
        return False
    # 含连续编号列表项（1、2、3…）的是知识卡片列表，不是案例背景
    list_items = [l for l in lines if LIST_ITEM_RE.match(l["text"])]
    if len(list_items) >= 2:
        return False
    # 既然能走到这里，说明本桶没有答案、没有选项、没有内嵌答案
    return True


def is_single_line_case_parent(bucket):
    """判断是否像“62、上海莲花河畔景苑倒楼案”这种单行案例标题。"""
    lines = bucket["lines"]
    if not lines or len(lines) > 2:
        return False
    first = lines[0]["text"]
    if not re.match(r"^\d+[、.．]", first):
        return False
    if CASE_SUB_RE.match(first) or ASK_LEAD_RE.match(first):
        return False
    joined = "\n".join(x["text"] for x in lines)
    # 无答案、无选项、无内嵌答案，才可能是标题
    if re.search(r"(?:正确答案|答案)\s*[:：]", joined):
        return False
    if INLINE_ANSWER_RE.search(joined):
        return False
    if re.search(r"^[A-H][、.．,，]\s*", joined, re.M):
        return False
    return True


def line_has_answer_signal(text):
    """判断一行是否像“试题”：带内嵌答案、答案行、或选项。"""
    if INLINE_ANSWER_RE.search(text):
        return True
    if re.search(r"(?:正确答案|答案)\s*[:：]", text):
        return True
    if OPTION_RE.match(text):
        return True
    return False


def line_pure_answer(text):
    """整行是否只是一个答案括号（如 (A) / （√） / (X)），可带 (注:…) 尾巴。"""
    return bool(PURE_ANSWER_LINE_RE.match(text.strip()))


def _strip_tail_note(txt):
    """剥离选项文本尾部的（备注:…）/(解读:…)/(注:…) 注释。"""
    return re.sub(r"[（(](?:备注|注|解读|知识点)[:：].*[)）]?\s*$", "", txt).strip()


def _looks_like_option(txt, max_len=60, allow_period=False):
    """判断孤立文本是否像一条缺标签的选项。"""
    txt = _strip_tail_note(txt)
    if len(txt) > max_len:
        return False
    if not allow_period and txt.endswith(("。", "；", "：", "）", ")")):
        return False
    if re.match(r"^(?:[（(]\d+[)）]|知识点[:：]|注[:：]|[一二三四五六七八九十]+、|《)", txt):
        return False
    return True


def normalize_answer_text(ans_part):
    """归一化 'A，C，E' / 'AB' / '正确' / '错误' / '√' / '×' / 'X'。"""
    ans_part = ans_part.strip()
    # 全角逗号/顿号/空格 -> 半角逗号
    ans_part = re.sub(r"[，、\s]+", ",", ans_part)
    if ans_part in ("正确", "对", "√"):
        return {"letters": [], "answerText": "正确", "rawAnswer": ans_part}
    if ans_part in ("错误", "错", "×", "X", "x"):
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
    """从题干中提取内嵌答案，如 ( C ) / （√） / （ACD） / (X) / （正确）。"""
    m = INLINE_ANSWER_RE.search(text)
    if not m:
        return None, None
    raw = m.group(1).strip()
    if not raw:
        return None, None
    if raw in ("正确", "对", "√"):
        return {"letters": [], "answerText": "正确", "rawAnswer": raw}, m.group(0)
    if raw in ("错误", "错", "×", "X", "x"):
        return {"letters": [], "answerText": "错误", "rawAnswer": raw}, m.group(0)
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


def infer_question_type(q):
    """根据答案/选项推断题型，避免被前一个判断题章节污染。"""
    answer_text = q.get("answerText") or ""
    letters = [x.upper() for x in q.get("answer") or []]
    options = q.get("options") or []
    option_keys = [o["key"] for o in options]

    # 判断题：答案文字是正确/错误，或者 options 是 A.正确 B.错误
    if answer_text in ("正确", "错误"):
        return "judge", "判断题"
    if option_keys and len(option_keys) >= 2 and all(
        any(k in o["text"] for k in ("正确", "错误")) for o in options
    ):
        return "judge", "判断题"

    if len(letters) > 1:
        return "multiple", "多选题"
    if len(letters) == 1:
        return "single", "单选题"
    if len(option_keys) > 0:
        # 有选项但答案暂时缺失，按单选处理（后续人工确认）
        return "single", "单选题"
    return q.get("type") or "single", q.get("typeName") or "单选题"


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

    # 判断是否为案例子题（(1)/(2)、①②③、或“问:”开头）
    is_case_sub = bool(CASE_SUB_RE.match(text)) or bool(ASK_LEAD_RE.match(text))

    # 先扫描所有行中混排的答案，包括题干行
    answer_info = None
    for line in lines:
        m_ans = re.search(r"(?:正确答案|答案)\s*[:：]\s*(.+)", line["text"])
        if m_ans:
            answer_info = parse_answer_line(m_ans.group(0).strip())
            if answer_info:
                break

    # 题干首行
    stem = strip_question_prefix(text)
    # 题干行可能混入答案，如 “8题:...（ ）正确答案:正确”
    m_ans_in_stem = re.search(r"(?:正确答案|答案)\s*[:：]\s*(.+)", stem)
    if m_ans_in_stem:
        stem = (stem[:m_ans_in_stem.start()] + stem[m_ans_in_stem.end():]).strip()
    q["question"] = stem

    # 后续行解析
    options = []
    orphan_pre = []   # 第一个选项出现前的非选项文本（可能是缺失标签的选项）
    orphan_post = []  # 选项出现后的非选项文本（可能是缺失中间标签/续行）
    inline_info = None
    seen_option = False
    last_option_index = -1

    for line in lines[1:]:
        lt = line["text"]
        ans = parse_answer_line(lt)
        if ans:
            answer_info = ans
            continue
        # 答案可能混在选项行尾：如“E.xxx 正确答案:A,B,C,E”
        m_ans = re.search(r"(?:正确答案|答案)\s*[:：]\s*(.+)", lt)
        if m_ans:
            temp_ans = parse_answer_line(m_ans.group(0).strip())
            if temp_ans:
                answer_info = temp_ans
                lt = lt[:m_ans.start()].strip()
                if not lt:
                    continue
        mo = OPTION_RE.match(lt)
        if mo:
            key = mo.group(1)
            opt_text = mo.group(2).strip()
            options.append({"key": key, "text": opt_text})
            seen_option = True
            last_option_index = len(options) - 1
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

    # 缺失选项标签修复：先补最前面缺的字母，再按答案缺失字母补，最后补剩余候选
    orphan_pool = []
    if options and orphan_pre:
        first_key_ord = ord(options[0]["key"]) - ord("A")
        need = max(0, first_key_ord)
        fill = orphan_pre[:need]
        rest_pre = orphan_pre[need:]
        if fill:
            filled = []
            for i, txt in enumerate(fill):
                filled.append({"key": chr(ord("A") + i), "text": txt})
            options = filled + options
            orphan_pool = list(rest_pre)
        else:
            orphan_pool = list(orphan_pre)
    elif orphan_pre:
        orphan_pool = list(orphan_pre)

    if orphan_post:
        for txt in orphan_post:
            # “一、特别重大事故…”这类知识行不是选项续文，按孤立文本处理
            orphan_pool.append(txt)

    # 孤儿选项补键：优先补已出现选项之间的“缺口键”（如 A,C,D,E 缺 B），
    # 尾部孤儿再按后续字母继续（A、B 之后补 C、D…）。
    # 原文常见“A.xxx [无标签的B文本] C.xxx”混排，不再追加到 F/H 末尾制造乱窜。
    if options and orphan_pool:
        existing_keys = {o["key"] for o in options}
        max_ord = max(ord(k) for k in existing_keys)
        gap_keys = [chr(o) for o in range(ord("A"), max_ord) if chr(o) not in existing_keys]
        next_ord = max_ord + 1
        rest = []
        answer_keys = [x.upper() for x in q.get("answer") or []]
        missing_ans_keys = sorted(set(k for k in answer_keys if k not in existing_keys))
        for txt in orphan_pool:
            key = None
            # 答案中缺失的键优先（答案来自原文，最可靠），允许句号结尾的长选项
            if missing_ans_keys and _looks_like_option(txt, max_len=120, allow_period=True):
                key = missing_ans_keys.pop(0)
            elif gap_keys and _looks_like_option(txt, max_len=100):
                key = gap_keys.pop(0)
            elif next_ord <= ord("H") and _looks_like_option(txt, max_len=100):
                key = chr(next_ord)
                next_ord += 1
            if key is None:
                rest.append(txt)
                continue
            options.append({"key": key, "text": _strip_tail_note(txt)})
        orphan_pool = rest

    # 完全没有显式选项标签，但答案有字母且存在多条孤立文本：按顺序补 A/B/C...
    if not options and q.get("answer"):
        candidates = []
        for txt in orphan_pool:
            if _looks_like_option(txt, max_len=140, allow_period=True):
                candidates.append(txt)
        if candidates and len(candidates) >= 2:
            options = [{"key": chr(ord("A") + i), "text": txt} for i, txt in enumerate(candidates[:8])]
            assigned_texts = set(x["text"] for x in options)
            orphan_pool = [t for t in orphan_pool if t not in assigned_texts]

    # 剩余未匹配的孤立文本：注/知识点/编号附注存入 note，其余并入题干
    note_parts = []
    if orphan_pool:
        for txt in orphan_pool:
            if re.match(r"^(?:[（(]\d+[)）]|知识点[:：]|注[:：])", txt) or NOTE_LEAD_RE.match(txt):
                note_parts.append(txt)
            elif re.fullmatch(r"^[一二三四五六七八九十]+、.*", txt):
                note_parts.append(txt)
            else:
                q["question"] += " " + txt
        if note_parts:
            q["note"] = (q.get("note") or "") + ("\n" if q.get("note") else "") + "\n".join(note_parts)

    # 按 key 排序，保证 A/B/C/D 顺序
    options.sort(key=lambda o: o["key"])

    # 去括号内答案，生成 questionClean（用于展示干净题干）
    if inline_matched and q["question"]:
        q["questionClean"] = q["question"].replace(inline_matched, "（ ）")
    else:
        q["questionClean"] = q["question"]

    # 把解析出的选项写回题目
    q["options"] = options

    # 按答案/选项推断题型，避免被前一个判断题章节污染
    # 案例子题只有挂到案例组时才标为案例分析题；独立出现的 ①②③ 题目按答案推断
    if is_case_sub and case_group:
        q["type"] = "case"
        q["typeName"] = "案例分析题"
        q["caseId"] = case_group["id"]
    else:
        q["type"], q["typeName"] = infer_question_type(q)

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

    if kind in ("question", "unknown"):
        # 没有答案、没有选项、也没有括号答案的知识/背景段落不当作题
        joined = "\n".join(x["text"] for x in lines)
        # 注意：答案行/选项行可能在多行文本中间，必须用 MULTILINE
        has_answer_line = bool(re.search(r"^(?:正确答案|答案)\s*[:：]\s*(.+)$", joined, re.M))
        has_any_answer = bool(re.search(r"(?:正确答案|答案)\s*[:：]", joined))
        has_inline = bool(INLINE_ANSWER_RE.search(joined))
        has_option = bool(re.search(r"^[A-H][、.．,，]\s*(.*)$", joined, re.M))
        if not (has_answer_line or has_any_answer or has_inline or has_option):
            # 可能是案例父题：一个题号 + 一长段背景，后面跟（1）（2）…子题
            if is_case_parent_candidate(bucket):
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

    # 其他（未知）当成知识/材料
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

    def bucket_has_signal(bk):
        joined = "\n".join(x["text"] for x in bk["lines"])
        return bool(
            re.search(r"(?:正确答案|答案)\s*[:：]", joined)
            or INLINE_ANSWER_RE.search(joined)
            or re.search(r"^[A-H][、.．,，]\s*", joined, re.M)
        )

    def bucket_closed(bk):
        """桶是否已“完成”：有关闭信号，或末行以句末标点结束。"""
        if bucket_has_signal(bk):
            return True
        last = bk["lines"][-1]["text"].strip()
        return last.endswith(("。", "！", "？"))

    def make_case_group(lines_in):
        case_groups.append({
            "id": f"case_{len(case_groups)+1:03d}",
            "title": lines_in[0]["text"],
            "type": "case",
            "chapter": context.get("chapter") or "案例分析题",
            "materialText": "\n".join(x["text"] for x in lines_in),
            "sourceParagraphStart": lines_in[0]["src"],
            "sourceParagraphEnd": lines_in[-1]["src"],
            "subQuestionIds": [],
        })

    def is_option_line(text):
        return bool(OPTION_RE.match(text))

    for line in logical_lines:
        text = line["text"]

        # 当前 bucket 内出现的“一、…”很可能是选项续行，不能当章节标题切段
        if is_heading(line) and (bucket is None or any(k in text for k in TYPE_HEADING_KEYWORDS)):
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

        # “第1题:”/“第2题印刷资料”这类纯标题行：与后面的“背景资料:”合并成一个案例题组
        if CASE_TITLE_LINE_RE.match(text):
            flush()
            bucket = {"kind": "case_material", "lines": [line]}
            continue

        if is_case_material_start(line):
            # 上一行是“第1题:”标题行时合并，作为题组标题
            if bucket is not None and bucket.get("kind") == "case_material" and CASE_TITLE_LINE_RE.match(bucket["lines"][0]["text"]):
                bucket["lines"].append(line)
                continue
            flush()
            bucket = {"kind": "case_material", "lines": [line]}
            continue

        # “知识点:”/“注:”引导行：与题目/知识区隔开
        if NOTE_LEAD_RE.match(text):
            if bucket is not None and not bucket_closed(bucket):
                bucket["lines"].append(line)
            else:
                flush()
                bucket = {"kind": "unknown", "lines": [line]}
            continue

        # 纯答案行（如单独的 (A) / （√））：归属当前题，不开新题
        if line_pure_answer(text) and not is_option_line(text):
            if bucket is None:
                bucket = {"kind": "unknown", "lines": [line]}
            else:
                bucket["lines"].append(line)
            continue

        if is_question_start(line):
            # 知识区块标题（205、预备知识一…）：即使前面是列表桶也强制开新桶，
            # 避免把上一个知识主题的尾巴（如密闭空间焊接）并入新区块（预备知识四）
            if LIST_ITEM_RE.match(text) and not line_has_answer_signal(text) and KNOWLEDGE_TITLE_RE.match(text):
                flush()
                bucket = {"kind": "unknown", "lines": [line]}
                continue
            # 知识卡片里经常用 1、2、3 / ①②③ / (1)(2) 做列表项：没有答案/选项信号时归并。
            # 只有编号连续（2 跟在 1 后面）且当前是知识候选桶时才归并；
            # 题目桶（492、后接 493、背景资料）必须断开，否则案例背景会被吞进上一题。
            if LIST_ITEM_RE.match(text) and not line_has_answer_signal(text):
                cur_no = list_item_number(text)
                last_no = list_item_number(bucket["lines"][-1]["text"]) if bucket else None
                # 只有小编号(1~30, 知识列表)的连续编号才归并;139、140、141 等主题卡不合并
                continuous = (
                    cur_no is not None and last_no is not None
                    and cur_no == last_no + 1 and cur_no <= 30
                )
                if bucket is None:
                    bucket = {"kind": "unknown", "lines": [line]}
                elif bucket.get("kind") == "unknown":
                    if bucket_has_signal(bucket) or not continuous:
                        # 前面的未知桶其实是题目（带了选项/答案信号），或编号不连续
                        flush()
                        bucket = {"kind": "unknown", "lines": [line]}
                    else:
                        bucket["lines"].append(line)
                elif bucket.get("kind") == "question" and not bucket_has_signal(bucket):
                    # 无题问信号的知识候选桶：连续列表项归并，不连续则独立
                    if continuous:
                        bucket["lines"].append(line)
                    else:
                        flush()
                        bucket = {"kind": "unknown", "lines": [line]}
                else:
                    flush()
                    bucket = {"kind": "question", "lines": [line]}
                continue
            # 单行案例标题（62、xxx）后面跟 ①②…子题时，先建成案例组
            if (CASE_SUB_RE.match(text) or ASK_LEAD_RE.match(text)) and bucket is not None and is_single_line_case_parent(bucket):
                if ASK_LEAD_RE.match(text) or line_has_answer_signal(text):
                    make_case_group(bucket["lines"])
                    bucket = None
                else:
                    # 不是案例小题，而是知识卡片的编号列表项，归并到当前卡片
                    bucket["kind"] = "unknown"
                    bucket["lines"].append(line)
                    continue
            flush()
            bucket = {"kind": "question", "lines": [line]}
            continue

        # 带答案信号的完整行：当前桶已闭合 → 是下一道题（无题号判断/选择题）
        if (
            line_has_answer_signal(text)
            and not is_option_line(text)
            and not ANSWER_RE.match(text)
        ):
            if bucket is None:
                bucket = {"kind": "question", "lines": [line]}
                continue
            if bucket.get("kind") == "unknown" and bucket_closed(bucket):
                flush()
                bucket = {"kind": "question", "lines": [line]}
                continue
            if bucket.get("kind") == "question" and bucket_closed(bucket):
                flush()
                bucket = {"kind": "question", "lines": [line]}
                continue
            if bucket.get("kind") == "unknown" and not bucket_has_signal(bucket):
                # ① 列表项后跟答案行（如“① …”题干断开、答案在下一行）
                last = bucket["lines"][-1]["text"]
                if LIST_ITEM_RE.match(last) and not line_has_answer_signal(last):
                    item = bucket["lines"][-1]
                    bucket["lines"] = bucket["lines"][:-1]
                    flush()
                    bucket = {"kind": "question", "lines": [item, line]}
                    continue
            bucket["lines"].append(line)
            continue

        # 超短残片行（“补充题”等）：题目已闭合时剥离，避免粘在题干上。
        # 只剥离明确的已知残片，短选项文本（如“B.土体强度”“一般事故”）不能剥。
        if text in ("补充题", "第") and bucket is not None and bucket.get("kind") == "question" and bucket_has_signal(bucket):
            flush()
            bucket = {"kind": "unknown", "lines": [line]}
            continue

        # 非题目内容
        if bucket is None:
            bucket = {"kind": "unknown", "lines": [line]}
        else:
            bucket["lines"].append(line)

    flush()

    # ---- 案例子题挂载重建 ----
    # parse 过程中子题会挂在“最后创建的案例组”上，可能挂错（如知识区的 ①②③ 题）；
    # 按源文件顺序重新归属：案例组之后紧邻的（1）/①/1./问: 子题属于该案例，
    # 出现新的父题号（如 74、，顿号分隔）或知识卡片即结束当前案例。
    sub_pat = re.compile(r"^(?:[（(]\d+[)）]|[①②③④⑤⑥⑦⑧⑨⑩]|问[:：]|\d+[.．])")
    parent_pat = re.compile(r"^\d+[、]")
    items = []
    for g in case_groups:
        items.append((g["sourceParagraphStart"], 0, g))
    for q in questions:
        items.append((q["sourceParagraphStart"], 1, q))
    for k in knowledge_cards:
        items.append((k["sourceParagraphStart"], 2, k))
    items.sort(key=lambda x: (x[0], x[1]))
    current = None
    for _, _kind, obj in items:
        if isinstance(obj, dict) and "subQuestionIds" in obj and "materialText" in obj:
            current = obj
            obj["subQuestionIds"] = []
            continue
        if obj.get("type") == "knowledge":
            # 知识卡片打断了案例链（如 83、案例后接工伤赔偿知识再接①②③题）
            current = None
            continue
        first = obj["rawText"].split("\n")[0]
        if sub_pat.match(first):
            if current is not None:
                obj["caseId"] = current["id"]
                obj["type"] = "case"
                obj["typeName"] = "案例分析题"
                current["subQuestionIds"].append(obj["id"])
            else:
                obj.pop("caseId", None)
                obj["type"], obj["typeName"] = infer_question_type(obj)
        elif parent_pat.match(first):
            # 新父题号：当前案例结束
            current = None
            obj.pop("caseId", None)
            obj["type"], obj["typeName"] = infer_question_type(obj)

    # ---- 没有子题的“案例”实为知识条目时转为知识卡片 ----
    # “73、《职业病防治法》…”“78、《安全生产许可证条例》”“80、设计单位安全责任”这类
    # 题号+主题没有任何子题，归属于知识卡片；“83、湖南株洲高架桥坍塌”等同理。
    remain = []
    for g in case_groups:
        if not g["subQuestionIds"]:
            knowledge_cards.append({
                "type": "knowledge",
                "title": g["title"],
                "content": g["materialText"],
                "sourceParagraphStart": g["sourceParagraphStart"],
                "sourceParagraphEnd": g["sourceParagraphEnd"],
            })
            continue
        remain.append(g)
    case_groups[:] = remain

    # ---- 知识卡内容：行内还有“N、”列表项（原文一行塞多条）时拆成多行 ----
    for k in knowledge_cards:
        lines = []
        for ln in k["content"].split("\n"):
            parts = re.split(r"(?<!\d)(?=\d+[、])", ln)
            lines.extend([p.strip() for p in parts if p.strip()])
        if lines:
            k["content"] = "\n".join(lines)
            k["title"] = strip_question_prefix(lines[0]) if is_question_start({"text": lines[0]}) else lines[0]

    # ---- 相邻知识卡合并：编号连续（1、2、3…），或上一卡未完结且下一卡是
    # 小编号列表项时并入同一主题（如“155、安全生产管理”+“危险源辨识的步骤：”+列表）。
    # 规则：列表项编号只认 1~30（63、64、65、68、78、79、80 等主题卡不参与合并），
    # 已因“未完结”合并过的卡不再继续链式合并，避免把 157、158 等主题吞进来。
    knowledge_cards.sort(key=lambda k: k["sourceParagraphStart"])

    def last_item_no(content):
        for ln in reversed(content.split("\n")):
            n = list_item_number(ln)
            if n is not None:
                return n
        return None

    merged_k = []
    for k in knowledge_cards:
        if merged_k:
            prev = merged_k[-1]
            prev_lines = prev["content"].split("\n")
            cur_lines = k["content"].split("\n")
            prev_no = last_item_no(prev["content"])
            cur_no = list_item_number(cur_lines[0])
            prev_last = prev_lines[-1].strip()
            cur_is_list = cur_no is not None and cur_no <= 30 and len(cur_lines[0]) <= 60
            continuous = (
                prev_no is not None and cur_no is not None
                and cur_no == prev_no + 1 and cur_no <= 30
            )
            # “205、预备知识一…”这类题号式标题行即使以句号结尾，也应与其列表合并
            m = re.match(r"^(\d+)[、.．].{1,40}$", prev_last)
            is_title_line = bool(m and int(m.group(1)) > 30)
            open_merge = (
                cur_is_list
                and not prev.get("_merged_by_open")
                and (not prev_last.endswith(("。", "！", "？")) or is_title_line)
            )
            if continuous or open_merge:
                prev["content"] += "\n" + k["content"]
                prev["sourceParagraphEnd"] = k["sourceParagraphEnd"]
                prev["_merged_by_open"] = True
                continue
        merged_k.append(k)
    knowledge_cards[:] = merged_k

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
