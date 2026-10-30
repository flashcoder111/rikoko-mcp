import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";

// The official pricing page is the source of truth until checkout is available.
const previewPacks = [
  { credits: 2000, price: 15 },
  { credits: 5000, price: 35 },
  { credits: 10000, price: 65 },
  { credits: 20000, price: 130 },
];
const previewPlans = [
  {
    name: "Starter",
    credits: 1800,
    monthly: 9.9,
    annualMonthly: 9.9,
    annualTotal: 118.8,
  },
  {
    name: "Pro",
    credits: 10000,
    monthly: 49.9,
    annualMonthly: 39.9,
    annualTotal: 478.8,
  },
  {
    name: "Ultra",
    credits: 27000,
    monthly: 129.9,
    annualMonthly: 99.9,
    annualTotal: 1198.8,
  },
];
const dollars = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export default function Recharge({ onCredits }: { onCredits: () => void }) {
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  return (
    <main className="recharge-page" aria-label="Add credits">
      <h1>Plans & credits</h1>
      <div className="recharge-heading">
        <div>
          <h2>Subscription plans</h2>
          <p>Credits are provided monthly, including with annual billing.</p>
        </div>
        <button onClick={onCredits}>View balance and usage</button>
      </div>
      <p className="recharge-status" role="status">
        Pricing preview — purchasing is not open yet. Plan and pack details and
        availability are subject to the official pricing page.
      </p>
      <div className="recharge-period" role="group" aria-label="Billing period">
        <button
          aria-pressed={period === "monthly"}
          onClick={() => setPeriod("monthly")}
        >
          Monthly
        </button>
        <button
          aria-pressed={period === "annual"}
          onClick={() => setPeriod("annual")}
        >
          Yearly
        </button>
      </div>
      <div className="recharge-plans">
        {previewPlans.map((plan) => (
          <section
            className="recharge-plan"
            key={plan.name}
            aria-label={`${plan.name} plan`}
          >
            <h3>{plan.name}</h3>
            <p className="recharge-price">
              $
              {(period === "annual"
                ? plan.annualMonthly
                : plan.monthly
              ).toFixed(2)}{" "}
              <span>/ month</span>
            </p>
            <p className="recharge-plan-billing">
              {period === "annual"
                ? `Billed yearly: $${dollars(plan.annualTotal)}`
                : "Billed monthly"}
            </p>
            <p className="recharge-plan-credits">
              <strong>{plan.credits.toLocaleString("en-US")}</strong> credits /
              month
            </p>
            <button disabled>Coming soon</button>
          </section>
        ))}
      </div>
      <div className="recharge-pack-heading">
        <h2>One-time credit packs</h2>
        <p>Add credits without a subscription.</p>
      </div>
      <div className="recharge-packs">
        {previewPacks.map(({ credits, price }) => (
          <section
            className="recharge-pack"
            key={credits}
            aria-label={`${credits.toLocaleString("en-US")} credits`}
          >
            <span className="recharge-eyebrow">ONE-TIME PACK</span>
            <h3>
              {credits.toLocaleString("en-US")} <span>credits</span>
            </h3>
            <p className="recharge-price">
              ${price.toFixed(2)} <span>USD</span>
            </p>
            <p className="recharge-pack-note">One-time purchase</p>
            <button disabled>Coming soon</button>
          </section>
        ))}
      </div>
      <a
        className="recharge-official-link"
        href="https://rikoko.ai/commercial/pricing/"
        target="_blank"
        rel="noopener noreferrer"
      >
        View official pricing <ArrowUpRight size={15} />
      </a>
    </main>
  );
}
