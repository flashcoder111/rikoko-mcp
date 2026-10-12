import { openRuntime } from "../apps/server/src/runtime.js";
const [command, name, balance = "0"] = process.argv.slice(2);
if (command !== "create-account" || !name)
  throw new Error(
    'Usage: pnpm keys create-account "Name" [integer-balance-cents]. This sets an opening test/admin balance, not a payment.',
  );
const { db, service } = await openRuntime();
try {
  const account = await service.createAccount(name, Number(balance));
  console.log(JSON.stringify(account));
} finally {
  await db.close();
}
