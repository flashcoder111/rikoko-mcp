import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Image,
  Video,
  AudioLines,
  RefreshCw,
} from "lucide-react";
import type { ServiceInfo } from "../../../packages/core/src/service-info.js";
import { api, statusLabels } from "./api";
import "./billing.css";
type Usage = {
  mode: "official" | "custom";
  availableCents: number;
  reservedCents: number;
  balanceCents: number;
  charges?: {
    jobId: string;
    model: string;
    createdAt: string;
    status: string;
    chargedCents: number | null;
    reservedCents: number;
    billingStatus: string;
  }[];
};
export default function Plans({
  connected,
  onConnect,
}: {
  connected: boolean;
  onConnect: () => void;
}) {
  const [info, setInfo] = useState<ServiceInfo>();
  const [usage, setUsage] = useState<Usage>();
  const [catalogError, setCatalogError] = useState("");
  const [usageError, setUsageError] = useState("");
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setCatalogError("");
    setUsageError("");
    setUsage(undefined);
    const catalog = fetch("/service-info", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("套餐目录暂时无法读取。");
        return r.json() as Promise<ServiceInfo>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setInfo(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setCatalogError(e.message);
      });
    const account = connected
      ? api<Usage>("generation_usage")
          .then((data) => {
            if (!controller.signal.aborted) setUsage(data);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setUsageError(e.message);
          })
      : Promise.resolve();
    void Promise.all([catalog, account]).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [connected, revision]);
  const money = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
  return (
    <section className="plans-page" aria-label="官方综合套餐">
      <div className="plans-heading">
        <span className="eyebrow">rikoko API</span>
        <h1>一个套餐，连接你的创作。</h1>
        <p>
          图片、视频、配音与音乐，共用官方 API 额度。
          <br />
          素材生成后保存到本地，继续剪辑与导出。
        </p>
      </div>
      <div className="plan-capabilities">
        {(
          [
            [Image, "图片", "生成创作素材"],
            [Video, "视频", "把想法变成镜头"],
            [AudioLines, "音频", "为作品添加声音"],
          ] as const
        ).map(([Icon, title, text]) => (
          <div key={title}>
            <Icon size={22} />
            <strong>{title}</strong>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <div className="plan-account">
        <div>
          <strong>
            {usage?.mode === "custom" || info?.mode === "custom"
              ? "当前通过 config 使用自有服务"
              : "官方套餐用量"}
          </strong>
          {usage?.mode === "official" ? (
            <p>
              可用 {money(usage.availableCents)}{" "}
              <span>· 预留 {money(usage.reservedCents)}</span>
            </p>
          ) : (
            <p>
              {info?.mode === "custom"
                ? "模型费用由你配置的供应商账户承担。"
                : connected
                  ? "连接官方套餐后查看余额与用量。"
                  : "连接工作空间后查看套餐用量。"}
            </p>
          )}
        </div>
        <button
          disabled={loading}
          onClick={() => (connected ? refresh((n) => n + 1) : onConnect())}
        >
          {connected ? (
            <>
              <RefreshCw size={14} /> 刷新用量
            </>
          ) : (
            "连接工作空间"
          )}
        </button>
      </div>
      {usageError && (
        <p className="small-muted" role="status">
          {usageError}
        </p>
      )}
      {usage?.mode === "official" && (
        <section className="api-billing-history" aria-label="API 调用账单">
          <h2>最近 API 调用</h2>
          {usage.charges?.length ? (
            <ul>
              {usage.charges.map((charge) => (
                <li key={charge.jobId}>
                  <div>
                    <strong>{charge.model}</strong>
                    <small>
                      {new Date(charge.createdAt).toLocaleString()} ·{" "}
                      {statusLabels[charge.status] ?? charge.status}
                    </small>
                  </div>
                  <span>
                    {charge.chargedCents !== null
                      ? `已扣 ${money(charge.chargedCents)}`
                      : charge.billingStatus === "pending_reconciliation"
                        ? `待核对 · 预留 ${money(charge.reservedCents)}`
                        : `预留 ${money(charge.reservedCents)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无调用账单。生成后的用量和费用可在这里查看。</p>
          )}
        </section>
      )}
      {catalogError && <p role="alert">{catalogError}</p>}
      {loading && <p role="status">正在读取套餐信息…</p>}
      {!!info?.plans.length && (
        <div className="plan-grid">
          {info.plans.map((plan) => (
            <article className="plan-card" key={plan.id}>
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
              <div className="plan-price">
                {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: plan.currency,
                }).format(plan.priceMinor / 100)}
              </div>
              <span className="plan-allowance">
                包含 {money(plan.allowanceCents)} API 额度
              </span>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <a
                className="button-link primary"
                href={plan.purchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                购买套餐 <ArrowUpRight size={16} />
              </a>
            </article>
          ))}
        </div>
      )}
      {!loading && !catalogError && !info?.plans.length && (
        <div className="plan-empty">
          <h2>
            {info?.catalogStatus === "unavailable"
              ? "套餐目录暂时不可用"
              : "官方套餐暂未开放购买"}
          </h2>
          <p>
            {info?.catalogStatus === "unavailable"
              ? "请稍后刷新，已有任务仍可在创作页面查看。"
              : "套餐发布后，这里会显示售价、额度和购买入口。"}
          </p>
          <button onClick={() => refresh((n) => n + 1)}>刷新套餐</button>
        </div>
      )}
      <p className="plan-footnote">
        本地剪辑、渲染和模板更新免费。官方 API 按实际调用结算额度；
        自有模型服务由对应供应商计费。作品与已下载素材保存在本地。
      </p>
    </section>
  );
}
