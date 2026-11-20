import { spawn } from "node:child_process";

const needsDatabase = process.env.IMRC_PO_STORAGE !== "shopify";
const command = needsDatabase ? "npm run setup && npm run start" : "npm run start";
const child = spawn(command, { shell: true, stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 1));
