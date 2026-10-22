import { templateSchema, type Template } from "./schema.js";
import manifest from "./bundled/manifest.json";

export const starterAssets = manifest;
export type LibraryTemplate = Template & {
  sourceKind: "builtin" | "cloud" | "personal";
  upstream?: { id: string; version: number; source: string; hash: string };
  updateAvailable?: { id: string; version: number; sourceKind: string };
  parameterLabels?: Record<string, string>;
  sceneLabels?: Record<string, string>;
  coverAssetId?: string;
  preparation?: string;
  searchTerms?: string[];
  isNew?: boolean;
};
type StarterDefinition = {
  id: string;
  title: string;
  category: string;
  description: string;
  art: number;
  labels: string[];
  defaults: string[];
  scenes: string[];
  sceneArt?: string[];
  durations?: number[];
  preparation?: string;
  searchTerms?: string[];
  isNew?: boolean;
  captionBackground?: string;
  maxLength?: number;
  speech?: boolean;
};
const definitions: StarterDefinition[] = [
  {
    id: "product",
    speech: true,
    title: "商品卖点",
    category: "产品推广",
    description: "亮相 → 卖点 → 行动邀请。换入商品图，就能制作一条新品介绍。",
    art: 0,
    labels: ["商品名称", "核心卖点", "行动邀请"],
    defaults: ["让日常，轻一点", "一份用心，藏在细节里", "了解你的下一件好物"],
    scenes: ["商品亮相", "细节与卖点", "购买或了解入口"],
  },
  {
    id: "store",
    title: "门店上新",
    category: "门店经营",
    description: "用门店照片、招牌产品和到店信息，制作一条上新短片。",
    art: 1,
    labels: ["开场文案", "新品介绍", "到店邀请"],
    defaults: [
      "给今天，留一点慢时光",
      "新的一杯，等你来尝",
      "走进街角的好心情",
    ],
    scenes: ["门店氛围", "新品特写", "地址与到店邀请"],
  },
  {
    id: "tutorial",
    speech: true,
    title: "三步教程",
    category: "知识分享",
    description: "一个主题、三个步骤。适合操作指南、生活技巧和产品入门。",
    art: 2,
    labels: ["教程标题", "第一步", "第二步", "第三步"],
    defaults: [
      "把复杂的事，分成三步",
      "01 先准备好需要的材料",
      "02 跟着步骤完成操作",
      "03 检查结果，保存备用",
    ],
    scenes: ["主题封面", "准备材料", "操作过程", "完成效果"],
  },
  {
    id: "list",
    speech: true,
    title: "三点清单",
    category: "知识分享",
    description: "用清晰的分点结构表达观点、推荐和注意事项。",
    art: 3,
    labels: ["清单主题", "第一点", "第二点", "第三点"],
    defaults: [
      "开始之前，记住这三点",
      "01 先确定目标",
      "02 把注意力留给重点",
      "03 给自己一次复盘",
    ],
    scenes: ["主题开场", "第一项配图", "第二项配图", "第三项配图"],
  },
  {
    id: "event",
    title: "活动邀请",
    category: "活动宣传",
    description: "主题、亮点、时间地点依次呈现，适合聚会、展览和门店活动。",
    art: 4,
    labels: ["活动名称", "活动亮点", "时间地点"],
    defaults: [
      "这个周末，一起见面",
      "好朋友，好音乐，好时光",
      "填写时间与地点 · 期待你的到来",
    ],
    scenes: ["活动主题", "现场与亮点", "时间地点与报名"],
  },
  {
    id: "brand",
    title: "品牌介绍",
    category: "品牌故事",
    description: "从品牌理念到服务价值，用三段画面完成简洁介绍。",
    art: 5,
    labels: ["品牌名称与理念", "提供的价值", "结束语"],
    defaults: [
      "让每一个想法，被看见",
      "从细节出发，把事情做好",
      "和我们一起，开启下一步",
    ],
    scenes: ["品牌开场", "产品或服务", "品牌收尾"],
  },
  {
    id: "software",
    speech: true,
    title: "软件功能介绍",
    category: "产品推广",
    description:
      "从使用场景到功能演示，再邀请体验。适合介绍网站、App 和新功能。",
    art: 6,
    sceneArt: [
      "starter-software-overview",
      "starter-software-focus",
      "starter-software-ready",
    ],
    labels: ["产品与使用场景", "主要功能", "体验邀请"],
    defaults: [
      "把每天的工作，整理得更清楚",
      "任务、进度和资料，一处查看",
      "换上你的产品截图，介绍新功能",
    ],
    scenes: ["首页或产品总览", "核心功能截图或录屏", "完成效果与体验入口"],
    durations: [3500, 5000, 3500],
    preparation:
      "建议准备 2～3 张产品截图或录屏，分别展示总览、功能和完成效果。也可以先用示意画面试做。",
    searchTerms: ["SaaS", "App", "网站", "应用", "录屏", "功能演示"],
    captionBackground: "#253B71",
    maxLength: 48,
    isNew: true,
  },
  {
    id: "before-after",
    title: "前后变化",
    category: "效果展示",
    description:
      "先看原始状态，再展示改变，最后总结方法。适合收纳、改造和作品迭代。",
    art: 9,
    sceneArt: [
      "starter-change-before",
      "starter-change-after",
      "starter-change-summary",
    ],
    labels: ["原始状态", "改变之后", "方法或总结"],
    defaults: [
      "开始之前，东西总是散在各处",
      "按用途归位，找起来更方便",
      "从一个小角落，开始整理",
    ],
    scenes: ["改变前的照片或视频", "改变后的同角度画面", "细节对比或方法总结"],
    durations: [4000, 4000, 4000],
    preparation:
      "建议准备同一对象改变前、改变后的两张照片，再补一张细节图。示例画面仅演示收纳过程。",
    searchTerms: ["对比", "改造", "收纳", "改版", "before", "after"],
    captionBackground: "#70472E",
    maxLength: 48,
    isNew: true,
  },
  {
    id: "testimonial",
    speech: true,
    title: "用户评价",
    category: "品牌故事",
    description: "用一条真实反馈介绍使用体验，依次交代背景、评价和来源。",
    art: 12,
    sceneArt: [
      "starter-feedback-intro",
      "starter-feedback-quote",
      "starter-feedback-source",
    ],
    labels: ["评价背景", "真实评价内容", "评价来源或结束语"],
    defaults: [
      "每一条反馈，都值得认真听见",
      "在这里写入客户的真实评价",
      "填写评价来源，分享使用体验",
    ],
    scenes: ["产品或服务场景", "评价卡片或反馈截图", "评价来源与品牌收尾"],
    durations: [3500, 6000, 3500],
    preparation:
      "准备一条可公开展示的真实反馈和评价来源；配图可选产品照片或反馈截图。示例文字是待替换占位内容。",
    searchTerms: ["客户", "反馈", "口碑", "评价", "testimonial"],
    captionBackground: "#4D3D68",
    maxLength: 64,
    isNew: true,
  },
];
export const starterTemplates: LibraryTemplate[] = definitions.map((d) => {
  const sceneArtwork = d.defaults.map((_, i) => {
    const art = d.sceneArt
      ? starterAssets.find((asset) => asset.id === d.sceneArt?.[i])
      : starterAssets[d.art];
    if (!art) throw new Error(`Missing artwork for ${d.id}, scene ${i + 1}`);
    return art;
  });
  const art = sceneArtwork[0];
  const parameters = Object.fromEntries(
    d.defaults.map((value, i) => [
      `text${i + 1}`,
      { default: value, maxLength: d.maxLength ?? 100 },
    ]),
  );
  return {
    ...templateSchema.parse({
      schemaVersion: 1,
      id: `rikoko-starter-${d.id}`,
      version: 1,
      title: d.title,
      description: d.description,
      category: d.category,
      ...(d.speech ? { speech: { mode: "optional" } } : {}),
      parameters,
      assets: [
        ...new Map(sceneArtwork.map((asset) => [asset.id, asset])).values(),
      ].map((asset) => ({
        id: asset.id,
        name: asset.name,
        sha256: asset.sha256,
        bytes: asset.bytes,
        license: "rikoko-original / Apache-2.0",
      })),
      composition: {
        schemaVersion: 1,
        title: "{{text1}}",
        width: 720,
        height: 1280,
        language: "zh",
        captionStyle: {
          fontFamily: "noto-sans-sc",
          fontSize: 36,
          color: "#ffffff",
          background: d.captionBackground ?? "#183a36",
        },
        scenes: d.defaults.map((_, i) => ({
          id: `scene-${i + 1}`,
          durationMs: d.durations?.[i] ?? 3000,
          text: `{{text${i + 1}}}`,
          assetId: sceneArtwork[i].id,
          fit: "cover",
          volume: 0,
        })),
      },
    }),
    sourceKind: "builtin",
    coverAssetId: art.id,
    preparation: d.preparation,
    searchTerms: d.searchTerms,
    isNew: d.isNew,
    parameterLabels: Object.fromEntries(
      d.labels.map((label, i) => [`text${i + 1}`, label]),
    ),
    sceneLabels: Object.fromEntries(
      d.scenes.map((label, i) => [`scene-${i + 1}`, label]),
    ),
  };
});
