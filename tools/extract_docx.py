#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Word 文档提取正文段落，保留段落顺序。
输出 data/raw_paragraphs.json，供解析器使用。
"""
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}


def extract_paragraphs(docx_path: str) -> list[str]:
    """按 <w:p> 提取每个段落的 <w:t> 文本，去空段落。"""
    paragraphs: list[str] = []
    with zipfile.ZipFile(docx_path) as zf:
        names = zf.namelist()
        # 优先 word/document.xml，兼容老式 xml
        target = None
        for cand in ("word/document.xml", "word/document2.xml"):
            if cand in names:
                target = cand
                break
        if target is None:
            raise RuntimeError("未找到 word/document.xml")
        xml_bytes = zf.read(target)
        root = ET.fromstring(xml_bytes)
        body = root.find(".//w:body", NS)
        if body is None:
            body = root
        for p in body.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
            texts = p.findall(".//w:t", NS)
            text = "".join(t.text or "" for t in texts)
            # 段落内换行/制表符保留原样，但首尾空格去掉
            text = text.replace("\xa0", " ")
            text = re.sub(r"[ \t]+", " ", text).strip()
            if text:
                paragraphs.append(text)
    return paragraphs


def main() -> None:
    project = Path(__file__).resolve().parents[1]
    src = project / "交安复习题全部.docx"
    out_dir = project / "data"
    out_dir.mkdir(exist_ok=True)

    paragraphs = extract_paragraphs(str(src))
    out_file = out_dir / "raw_paragraphs.json"
    out_file.write_text(
        json.dumps(
            [{"index": i, "text": t} for i, t in enumerate(paragraphs)],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # 同时导出一份纯文本方便人工检查
    (out_dir / "raw_text.txt").write_text(
        "\n".join(f"{i}: {t}" for i, t in enumerate(paragraphs)),
        encoding="utf-8",
    )

    print(f"段落数: {len(paragraphs)}")
    print(f"已写出: {out_file}")
    print(f"已写出: {out_dir / 'raw_text.txt'}")


if __name__ == "__main__":
    main()
