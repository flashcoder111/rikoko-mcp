import React, { useEffect, useState } from "react";
import { Coins, RefreshCw } from "lucide-react";
import { api, statusLabels } from "./api";

export type CreditUsage = {
  mode: "official" | "custom";
  availableCredits?: number | null;
  reservedCredits?: number | null;
  balanceCredits?: number | null;
  availableCents?: number;
  reservedCents?: number;
  balanceCents?: number;
  charges?: {
    jobId: string;
    model: string;
    createdAt: string;
    status: string;
    chargedCredits?: number | null;
    chargedCents?: number | null;
    reservedCents?: number;
    billingStatus: string;
  }[];
};
const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const credits = (value: unknown) =>
  numeric(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : "—";
const money = (value: unknown) =>
  numeric(value) ? `US$${(value / 100).toFixed(2)}` : "—";

export default function Credits({
  connected,
  onConnect,
}: {
  connected: boolean;
  onConnect: () => void;
}) {
  const [usage, setUsage] = useState<CreditUsage>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [limit, setLimit] = useState(30);
  useEffect(() => {
    let active = true;
    setUsage(undefined);
    setError("");
    setLoading(connected);
    if (connected)
      void api<CreditUsage>("generation_usage")
        .then((value) => {
          if (active) setUsage(value);
        })
        .catch((err) => {
          if (active)
            setError(err instanceof Error ? err.message : "积分暂时无法读取");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [connected, revision]);
  const official = usage?.mode === "official";
  const hasCredits = official && numeric(usage.availableCredits);
  return (
    <main className="dashboard credits-page" aria-label="积分与用量">
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">RIKOKO / MY CREDITS</span>
          <h1>积分与用量</h1>
          <p>查看当前连接账户的余额和调用记录。</p>
        </div>
        <button
          disabled={loading}
          onClick={() => (connected ? setRevision((n) => n + 1) : onConnect())}
        >
          <RefreshCw size={15} />
          {connected ? "刷新余额" : "连接工作空间"}
        </button>
      </div>
      {!connected && (
        <div className="dashboard-callout">
          <Coins size={22} />
          <p>连接工作空间后查看自己的积分与用量。</p>
        </div>
      )}
      {loading && <p role="status">正在读取账户余额…</p>}
      {error && (
        <div className="dashboard-error" role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>重试</button>
        </div>
      )}
      {usage?.mode === "custom" && (
        <div className="dashboard-callout">
          <Coins size={22} />
          <div>
            <strong>当前使用自有模型服务</strong>
            <p>余额与费用由对应供应商管理，这里不显示为 rikoko 官方积分。</p>
          </div>
        </div>
      )}
      {official && (
        <>
          {!hasCredits && (
            <p className="credits-note">
              当前服务仅返回美元额度，尚未提供积分余额。
            </p>
          )}
          <section
            className="dashboard-stats credits-stats"
            aria-label="账户余额"
          >
            {[
              {
                label: hasCredits ? "可用积分" : "可用额度",
                value: hasCredits
                  ? credits(usage.availableCredits)
                  : money(usage.availableCents),
                note: "可用于新的模型调用",
              },
              {
                label: hasCredits ? "预留积分" : "预留额度",
                value: hasCredits
                  ? credits(usage.reservedCredits)
                  : money(usage.reservedCents),
                note: "当前任务暂时占用的余额",
              },
              {
                label: hasCredits ? "账户总积分" : "账户总额度",
                value: hasCredits
                  ? credits(usage.balanceCredits)
                  : money(usage.balanceCents),
                note: "包含可用与预留部分",
              },
            ].map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.note}</small>
              </div>
            ))}
          </section>
          <section className="dashboard-panel">
            <div className="dashboard-section-heading">
              <div>
                <h2>调用记录</h2>
                <p>已结算费用与仍在预留中的调用。</p>
              </div>
            </div>
            {usage.charges?.length ? (
              <div className="credits-table-wrap">
                <table className="credits-table">
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>时间</th>
                      <th>任务状态</th>
                      <th>费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.charges.slice(0, limit).map((charge) => (
                      <tr key={charge.jobId}>
                        <td>{charge.model || "媒体处理"}</td>
                        <td>
                          {new Date(charge.createdAt).toLocaleString("zh-CN")}
                        </td>
                        <td>{statusLabels[charge.status] ?? charge.status}</td>
                        <td>
                          {numeric(charge.chargedCredits)
                            ? `${credits(charge.chargedCredits)} 积分`
                            : numeric(charge.chargedCents)
                              ? money(charge.chargedCents)
                              : charge.billingStatus ===
                                  "pending_reconciliation"
                                ? "待核对"
                                : `预留 ${money(charge.reservedCents)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="dashboard-empty">暂无调用记录。</div>
            )}
            {(usage.charges?.length ?? 0) > limit && (
              <button
                className="dashboard-more"
                onClick={() => setLimit((n) => n + 30)}
              >
                查看更多记录
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
