# 凯凯搜题助手

面向多个题库的移动端阅读与搜索工具，网页入口：https://kkisme.github.io/kaikai-search/ 。题库列表包含“交安复习题”和“公路试验-技能提升试题题库”。

交安复习题以 `交安复习题全部.大题层级修正版-20260907.docx` 为基础，当前共 2298 条。原有案例背景、题内说明和小题按文档顺序保留，搜索命中一个小题也展示完整案例。新增题的核对过程见 `交安题库新增核对-20260924.md`。

公路试验题库由 `公路-技能提升试题题库（核对修订版）.docx` 的 2256 道题与 2026 年四个季度去重后的 469 道补充题组成，共 2725 道，含单选 988 道、多选 551 道、判断 781 道、填空 405 道。页面展示原题解析和已有难度标记，两个题库分别搜索。

支持题干、选项、背景和备注搜索，多关键词共同匹配、全拼和首字母搜索；没有精确结果时尝试单字替换近似匹配。同题内所有文字关键词标黄，右下角显示题目进度，上下按钮按完整题目切换（一个案例计一题）；每次搜索或切换题型回到首条结果。拼音和近似匹配不伪造文字高亮。答案直接显示。页面将案例与综合合并为“案例题”，知识卡与案例资料合并为“知识卡”；使用紧凑题型标签，不展示原题号和章节来源。

首页以题库列表展示，点击进入搜索；搜索页顶部为返回按钮和题库名称，长名称省略显示，浏览器返回可切换页面。

## 本地运行与更新

```sh
python -m pip install python-docx pypinyin
python tools/build_reviewed_bank.py
python tools/import_20260924.py
python tools/build_road_skills_bank.py
python -m http.server 8000 --directory docs
```

打开 http://localhost:8000/ 。重建交安题库时先生成基础题，再运行新增题导入脚本，新增文档放在 `data/` 下。公路试验题库独立生成到 `docs/road-skills-bank.json`，默认读取项目根目录的核对修订版和 `data/road-skills-2026-supplement.json`。两个生成脚本均支持 `--source 文件路径`，生成的题库 JSON 包含来源及 SHA-256。

答案沿用核对文档及其中的补充来源、备注，不代表已完成全部法律时效审查。

## 验证与发布

```sh
node tools/test_reviewed_search.mjs
# 先启动本地 HTTP 服务，并安装 Playwright 和 Chromium
npm install --no-save playwright
npx playwright install chromium
node tools/test_reading_ui.mjs
```

UI 测试也支持环境变量 `PLAYWRIGHT_MODULE`（模块绝对路径）、`BROWSER_EXECUTABLE`（浏览器路径）、`TEST_BASE_URL`。

推送 main 分支的 docs 变更后，已有 GitHub Actions 自动构建 Android 调试 APK，在该次运行的 `kaikai-search-apk` artifact 中下载；旧 Release 的 APK 不会自动更新。网页支持首次联网加载后的离线使用。
