# 成片模板与素材复用

> 流程已调整：本文记录此前的手动模板页面验收。当前以[Agent 自动使用模板与素材](agent-template-flow-2026-10-14.md)为准，用户直接描述需求，由 Agent 在后台选择。

日期：2026-10-14。范围：rikoko-mcp 本地运行时、MCP 与 Studio；不含官网或云平台发布。

本文件保留首批 6 个模板的历史验收结果。后续新增 3 套及当前验证状态见[模板逐步扩充](template-expansion-2026-10-14.md)。

## 交付

- 6 个本地模板：商品卖点、门店上新、三步教程、三点清单、活动邀请、品牌介绍。
- 6 张原创 PNG 插画与 6 个由真实本地渲染生成的示例 MP4。素材总量为首批内容，不能解释为已接入大型图库。
- 网页模板选择、成片示例、分镜预览、文案替换、镜头素材选择、复用清单、本地创建与渲染。
- 独立素材库、用途分类、标签搜索、收藏、重命名、对话附加和工作台画面替换。归纳数据按账户保存，不改动素材字节。
- MCP 先检查模板和素材再考虑生成；模板准备只导入缺少的现成素材，不购买生成。明确生成的原有入口继续保留。

## 网络参考与内容来源

只借鉴公开产品呈现的通用创作结构与流程，没有导入第三方模板源码、图片、视频或付费图库。

- [Canva 产品视频模板](https://www.canva.com/video-editor/templates/product/)：从用途选择，再替换商品内容。
- [Canva 说明视频模板](https://www.canva.com/video-editor/templates/explainer/)：教程、分步骤说明。
- [Adobe Express 视频广告](https://www.adobe.com/express/create/video/advertisement)：选择模板后加入自己的素材并编辑。
- [Hypit 结果复用](https://hypit.ai/quickstart/run/#reusing-results)：明确复用已经确认的生成产物，避免再次生成。

网络内容核对日期为 2026-10-14。以上为设计参考，不是质量或转化率证据。

插画由 `scripts/build-starter-art.py` 确定性绘制，不调用模型；使用项目自身许可。`packages/templates/src/bundled/manifest.json` 保存大小与 SHA256。示例用 `scripts/build-starter-previews.ts` 在独立零余额工作空间创建和渲染，未使用用户素材、供应商账户或正式数据库。

## 验证入口

- `pnpm exec vitest run tests/template-library.test.ts tests/cloud-contracts.test.ts tests/cloud-downloads.test.ts tests/cloud-boundaries.test.ts`
- `pnpm exec tsx scripts/build-starter-previews.ts`：真实生成全部示例；9 / 12 秒，720 × 1280。
- `pnpm exec tsx scripts/verify-template-library.ts`：独立本地 HTTP 服务和 Chrome，桌面 / 390px 移动端，截图与结果写入 `artifacts/template-library/`。
- `pnpm build` 和 `pnpm test`。

浏览器脚本默认使用本机 Chrome，可通过 `PLAYWRIGHT_CHANNEL` 指定其他已安装的 Playwright 浏览器通道。验收报告以实际脚本输出为准。

## 本次验证结果

- `pnpm build` 通过，包括 TypeScript 检查和两个前端构建。
- `pnpm test`：32 个测试文件、190 项测试全部通过。
- 浏览器验收通过：6 个模板可见，示例 MP4 可播放，替换画面后真实本地出片，分类与收藏刷新后保留，已有素材可附加到对话且不触发生成；390px 移动端无横向溢出，无浏览器错误。
- 6 个示例均经过真实本地渲染；本次验收付费生成请求为 0。
- `npm pack --dry-run --ignore-scripts --json` 确认运行时包包含全部 6 张 PNG、6 个 MP4 和素材清单；未发布包。
- `git diff --check` 通过。未提交、推送或部署，未修改用户正式工作空间数据。

本地证据：`artifacts/template-library/verification.json`、`tests.log`、`package-files.json` 及 `01` 至 `06` 的界面截图。

## 边界

内置素材是图形插画，不是人物、商品实拍或有声口播库。模板修改字幕会重新合成视频，不重新生成画面。预览成片是默认模板的预渲染示例；修改后的最终排版、声音和时长以新作品渲染结果为准。现有云模板无需更新协议即可继续使用，素材替换参数是本地实例化扩展。云模板发布、在线服务状态及真实付费生成不由本次验收证明。
