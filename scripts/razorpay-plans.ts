/**
 * Creates the six Razorpay plans (Creator, Studio, Agency × monthly, yearly) from the INR
 * prices in src/lib/plans.ts and prints the env lines to paste into .env.local.
 *
 *   npm run razorpay:plans
 *
 * Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys create test-mode plans).
 * Razorpay plans can't be edited or deleted, so change a price by creating a new plan.
 */
import { PLANS, PLAN_INFO } from "../src/lib/plans";

const key = process.env.RAZORPAY_KEY_ID;
const secret = process.env.RAZORPAY_KEY_SECRET;
if (!key || !secret) {
  console.error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET first (in .env.local).");
  process.exit(1);
}
const auth = Buffer.from(`${key}:${secret}`).toString("base64");

async function main() {
  const lines: string[] = [];
  for (const plan of PLANS) {
    if (plan === "free") continue;
    const info = PLAN_INFO[plan];
    for (const [interval, period, amount] of [
      ["MONTH", "monthly", info.monthly],
      ["YEAR", "yearly", info.yearly],
    ] as const) {
      const res = await fetch("https://api.razorpay.com/v1/plans", {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          period,
          interval: 1,
          item: {
            name: `Relay ${info.name} (${period})`,
            amount: amount * 100,
            currency: "INR",
            description: info.pitch,
          },
          notes: { relayPlan: plan },
        }),
      });
      const json = (await res.json()) as {
        id?: string;
        error?: { description?: string };
      };
      if (!res.ok || !json.id) {
        console.error(`${info.name} ${period}: ${json.error?.description ?? res.status}`);
        process.exit(1);
      }
      lines.push(`RAZORPAY_PLAN_${plan.toUpperCase()}_${interval}=${json.id}`);
      console.error(`Created ${info.name} ${period}: ₹${amount.toLocaleString("en-IN")} → ${json.id}`);
    }
  }
  console.log(`\n# Paste into .env.local\n${lines.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
