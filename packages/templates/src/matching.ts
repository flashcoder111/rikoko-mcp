import type { Entity } from "../../contracts/src/index.js";
import type { LibraryTemplate } from "./starters.js";

// Retrieval hints, not a substitute for the calling Agent's creative judgment.
const intents: Record<string, RegExp> = {
  store: /咖啡|拿铁|门店|到店|餐厅|奶茶|烘焙|coffee|cafe|restaurant/i,
  product: /商品|产品|卖点|新品|上新|推广|product|launch/i,
  tutorial: /教程|步骤|教你|教学|指南|tutorial|how.to|steps/i,
  list: /清单|要点|注意事项|推荐|盘点|list|tips/i,
  event: /活动|邀请|展览|聚会|报名|event|invitation/i,
  brand: /品牌|理念|公司介绍|brand|company/i,
  software: /软件|应用|网站|功能|录屏|saas|\bapp\b|software/i,
  "before-after": /前后|对比|改造|收纳|改版|before|after/i,
  testimonial: /评价|反馈|口碑|客户说|testimonial|review/i,
};
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const generic = new Set([
  "视频",
  "短片",
  "素材",
  "图片",
  "照片",
  "模板",
  "画面",
  "商品",
  "产品",
  "品牌",
  "场景",
  "背景",
  "制作",
  "生成",
  "一个",
  "一条",
  "使用",
  "帮我",
  "video",
  "image",
  "photo",
  "template",
  "make",
  "create",
  "product",
]);
function terms(text: string) {
  return [
    ...new Set(
      Array.from(segmenter.segment(text.toLowerCase()))
        .filter((s) => s.isWordLike)
        .map((s) => s.segment)
        .filter((s) => s.length > 1 && !generic.has(s) && !/^\d+$/.test(s)),
    ),
  ];
}
export function avoidsTemplates(message: string) {
  return /(?:不要|不用|不使用|别用|不套用).{0,4}模板|(?:without|no|don't use)\s+(?:a\s+)?templates?/i.test(
    message,
  );
}
export function rankTemplates(message: string, templates: LibraryTemplate[]) {
  if (avoidsTemplates(message)) return [];
  const keywords = terms(message);
  return templates
    .map((template) => {
      const intentId = template.id.replace("rikoko-starter-", "");
      const intent = intents[intentId];
      const haystack = [
        template.title,
        template.category,
        template.description,
        ...(template.searchTerms ?? []),
      ]
        .join(" ")
        .toLowerCase();
      const matched = keywords.filter((word) => haystack.includes(word));
      // A concrete use case (e.g. coffee shop or software) outranks generic "product".
      const score =
        (intent?.test(message)
          ? ["product", "brand"].includes(intentId)
            ? 10
            : 20
          : 0) +
        matched.length * 2;
      return {
        template,
        score,
        reason: `按用途「${template.title}」与描述匹配`,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id),
    );
}
export function relevantAssets(message: string, assets: Entity[]) {
  const keywords = terms(message);
  return assets
    .filter(
      (a) =>
        ["image", "video", "audio"].includes(a.kind) &&
        (!a.expiresAt || new Date(a.expiresAt).getTime() > Date.now()),
    )
    .map((asset) => {
      const haystack = [asset.name, ...(asset.library?.tags ?? [])]
        .join(" ")
        .toLowerCase();
      // A category alone must not select an unrelated customer's product or brand.
      const matched = keywords.filter((word) => haystack.includes(word));
      return {
        asset,
        score: matched.length * 2 + (asset.library?.favorite ? 0.5 : 0),
        matched,
      };
    })
    .filter((item) => item.matched.length > 0)
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
    .slice(0, 12)
    .map((item) => item.asset);
}
