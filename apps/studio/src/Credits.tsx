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
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
const money = (value: unknown) =>
  numeric(value) ? `US$${(value / 100).toFixed(2)}` : "—";

export default function Credits({
  connected,
  onConnect,
  onRecharge,
}: {
  connected: boolean;
  onConnect: () => void;
  onRecharge?: () => void;
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
            setError(
              err instanceof Error ? err.message : "Could not load credits",
            );
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
    <main className="dashboard credits-page" aria-label="Credits & usage">
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">RIKOKO / MY CREDITS</span>
          <h1>Credits & usage</h1>
          <p>View the connected account balance and usage history.</p>
        </div>
        <div className="dashboard-actions">
          {onRecharge && <button onClick={onRecharge}>Add credits</button>}
          <button
            disabled={loading}
            onClick={() =>
              connected ? setRevision((n) => n + 1) : onConnect()
            }
          >
            <RefreshCw size={15} />
            {connected ? "Refresh balance" : "Connect workspace"}
          </button>
        </div>
      </div>
      {!connected && (
        <div className="dashboard-callout">
          <Coins size={22} />
          <p>Connect your workspace to view your balance and usage.</p>
        </div>
      )}
      {loading && <p role="status">Loading account balance…</p>}
      {error && (
        <div className="dashboard-error" role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>Retry</button>
        </div>
      )}
      {usage?.mode === "custom" && (
        <div className="dashboard-callout">
          <Coins size={22} />
          <div>
            <strong>Using your own model provider</strong>
            <p>
              Your provider manages its own balance and charges, which are not
              shown as rikoko credits.
            </p>
          </div>
        </div>
      )}
      {official && (
        <>
          {!hasCredits && (
            <p className="credits-note">
              This service returns a USD allowance, but no credit balance.
            </p>
          )}
          <section
            className="dashboard-stats credits-stats"
            aria-label="Account balance"
          >
            {[
              {
                label: hasCredits ? "Available credits" : "Available allowance",
                value: hasCredits
                  ? credits(usage.availableCredits)
                  : money(usage.availableCents),
                note: "Available for new model requests",
              },
              {
                label: hasCredits ? "Reserved credits" : "Reserved allowance",
                value: hasCredits
                  ? credits(usage.reservedCredits)
                  : money(usage.reservedCents),
                note: "Reserved for current tasks",
              },
              {
                label: hasCredits ? "Total credits" : "Total allowance",
                value: hasCredits
                  ? credits(usage.balanceCredits)
                  : money(usage.balanceCents),
                note: "Includes available and reserved amounts",
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
                <h2>Usage history</h2>
                <p>Settled charges and pending reservations.</p>
              </div>
            </div>
            {usage.charges?.length ? (
              <div className="credits-table-wrap">
                <table className="credits-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Time</th>
                      <th>Task status</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.charges.slice(0, limit).map((charge) => (
                      <tr key={charge.jobId}>
                        <td>{charge.model || "Media processing"}</td>
                        <td>
                          {new Date(charge.createdAt).toLocaleString("en-US")}
                        </td>
                        <td>{statusLabels[charge.status] ?? charge.status}</td>
                        <td>
                          {numeric(charge.chargedCredits)
                            ? `${credits(charge.chargedCredits)} credits`
                            : numeric(charge.chargedCents)
                              ? money(charge.chargedCents)
                              : charge.billingStatus ===
                                  "pending_reconciliation"
                                ? "Pending review"
                                : `Reserved ${money(charge.reservedCents)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="dashboard-empty">No usage records yet.</div>
            )}
            {(usage.charges?.length ?? 0) > limit && (
              <button
                className="dashboard-more"
                onClick={() => setLimit((n) => n + 30)}
              >
                Show more
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
