# 凯凯搜题助手

交安复习题手机端搜题助手。题目数据来自 `交安复习题全部.docx`，答案已通过解析校验，与原文对齐。

## 手机直接用

- GitHub Pages：访问 `https://kkisme.github.io/kaikai-search/`
- 局域网：电脑运行 `python -m http.server 8000 --directory docs`，手机访问 `http://电脑IP:8000`
- 支持 PWA 添加到主屏幕，支持离线缓存。

## Android APK 下载

- 最新版 APK：  
  https://github.com/kkisme/kaikai-search/releases/download/v0.3.8/kaikai-search.apk
- 每次推送 `docs/` 后，GitHub Actions 会自动重新打包 APK。

## 功能

- 关键字搜索
- 拼音首字母搜索（如 `aqsc`）
- 全拼搜索（如 `anquan`）
- 模糊容错
- 题型/章节筛选
- 答案完整复制
- 案例背景（部分）

## 更新题库

```bash
# 1. 提取 docx 段落（需本机有 交安复习题全部.docx）
python tools/extract_docx.py
# 2. 解析题目
python tools/parse_questions.py
# 3. 生成 questions.json + search-index.json
python tools/build_search_index.py
# 4. 同步到 docs
# 复制 data/questions.json、data/search-index.json 到 docs/
```

## 说明

- `data/questions_raw.json` 包含全部解析结果；
- `parse_report.json` 是解析/答案对齐报告；
- `dist/` 是本地测试版，`docs/` 是 GitHub Pages 部署目录。
