# 凯凯搜题助手

交安复习题阅读与搜索，网页入口：https://kkisme.github.io/kaikai-search/

当前题库直接来自 `交安复习题全部.大题层级修正版-20260907.docx` 的明确大题、小题标记，共 1206 个独立条目，包括 30 个案例、10 个综合题、23 个知识卡和 3 个案例资料。背景、题内说明和小题按文档顺序保留；搜索命中一个小题也展示完整案例。原题号可能在不同章节重复，内部使用唯一 ID 区分。

支持题干、选项、背景和备注搜索，多关键词共同匹配、全拼和首字母搜索；没有精确结果时尝试单字替换近似匹配。文字关键词高亮，右下角上下按钮依次定位；每次搜索或切换题型回到首条结果。拼音和近似匹配不伪造文字高亮。参考答案可展开收起，题干中的原有答案标记仍保留。

## 本地运行与更新

```sh
python -m pip install python-docx pypinyin
python tools/build_reviewed_bank.py
python -m http.server 8000 --directory docs
```

打开 http://localhost:8000/ 。更新时可通过 `--source 文件路径` 指定下一版核对文档。生成的 `docs/question-bank.json` 包含文档名称和 SHA-256，方便追溯；源文件备份不参与写入。旧解析工具和旧 JSON 不再被页面读取。

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
