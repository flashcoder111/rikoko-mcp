# 导演知识架构：内容格式、导演工艺、模型写法

日期：2026-10-27。首次接入版本：0.1.54，首次线上资料补充版本：0.1.55。架构迁移和内容扩充分别记录；线上资料可以直接吸收，不新增实证效果声明。

## 职责与目录

```text
packages/guidance/
  content/
    index.md                 总索引
    formats/                 内容格式：整部作品如何组织
    craft/                   导演工艺：跨格式通用的制作方法
    models/                  模型写法：把决定表达给实际模型接口
    support/                 宿主、工具、执行规则、记忆说明
  src/catalog.ts             主题、分类、关系、来源、适用范围、旧名称映射
  src/reader.ts              读取、导航、版本与哈希校验
  src/director.ts            同一正文中的职责与阶段段落
  manifest.json              正文、路径与目录元数据的版本绑定
```

内容格式目前包含 UGC 广告、口播广告、商品广告、过程 B-roll。工艺保留现有文档，并补入口播表演、商品调度与材质表现。模型层包含编译器/参考交付说明，以及 Seedance 2.0 Mini、MiniMax H3/H3 Max 的来源化写作手册。手册区分官方规范、跨版本借鉴和原创示例，不称为 rikoko 实测手册。来源记录见 [第一批线上资料](../research/director-knowledge-sources-2026-10-27.md)。

每份正文只有一个规范路径。18 个旧 topic 继续可读，映射到新目录中的同一份文件。0.1.55 有 28 份规范文档（包含 4 个索引），与旧别名一起暴露为 46 个可请求 topic。增加主题仍需升级相应 MCP bridge 的工具 schema，不能把旧别名兼容误解为旧客户端自动支持新主题。

## 知识与执行

1. 宿主从 `overview` 获得导演职责，从 `knowledge` 获得三层目录；支持文档不混入内容格式。
2. `rikoko_guide` 保留 `topic`，新增可选 `selection={format,crafts,modelId,mode}`，返回相关正文、来源状态和阅读路径。MCP 文本与结构化输出都携带导航。
3. 可选 `plan.knowledge={format,crafts}` 保存宿主选择。格式可为空；不能用固定模板约束原创或简单编辑。
4. 阶段工具复用已有正文段落，同时返回 `readingPath.formats/craft/models`。格式关联工艺；实际模型与输入模式由镜头/生成准备/完成记录传入，不通过标题关键词猜测。
5. `generation_prepare` 冻结所选知识、导演方案和指南版本。恢复与云端镜像保留这些信息。旧准备记录维持原哈希及原输入，不重新购买或隐式重编。
6. 现有 director kits 继续参与 prompt 编译，并返回对应的格式、工艺和通用模型写法链接；当前配方保持 candidate、非模型专属，不改变措辞。

示例：

```json
{
  "topic": "knowledge",
  "selection": {
    "format": "formats/ugc-ads",
    "crafts": ["craft/image-direction"],
    "modelId": "实际配置中的模型 ID",
    "mode": "image_to_video"
  }
}
```

模型条目可通过 `scope.modelIds` 和 `scope.modes` 声明精确范围。限定输入模式但模式未知时不匹配；模型名称相近不代表兼容。没有对应模型条目时返回 `modelCoverage=general_only`；尚未选择模型时为 `not_selected`。这不触发模型切换，也不拦截创作。

## 来源与后续补充

每条目录记录包含标题、所属层、正文路径、关联主题、来源状态和可选模型范围。来源用 `title/url/note` 保留原作者、版本及适用边界。

- `existing_guidance`：迁移的已有方法，未新增实证声明。
- `structure_only`：索引和架构说明。
- `official_documentation`：官方模型或产品文档。
- `external_example`：外部创作者案例与经验。
- `rikoko_tested`：rikoko 自己的实测记录。

这些标记表示依据不同，不是必须依次晋级的流程。官方资料和优秀外部案例可以带来源直接纳入，不要求先付费建立基线或逐条复现。宿主推测、私有任务反馈和用户偏好仍按原记忆边界管理。

补充内容时：格式写作品结构并引用工艺；工艺写可迁移方法；特殊语法和模型经验写模型条目并声明范围。新增文件与目录登记后运行 `pnpm guides:manifest`，检查别名、引用、来源与作用域，再运行相关读取/路由/打包测试。正文和目录元数据共同影响 `guideVersion`。

本轮没有实现素材语义自动识别、线上爬取、向量检索、独立知识服务或自动经验发布；内容路由先支持宿主明确选择和已有阶段上下文。

## 仓库与发布

共享知识和读取逻辑只在 rikoko-mcp 维护。平台通过新的固定 vendor 包接入，校验安装包、已安装 manifest、分类目录与正文哈希。不复制源码到平台，也不引入兄弟仓库依赖。
