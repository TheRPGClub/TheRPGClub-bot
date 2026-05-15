import { readFileSync, writeFileSync } from "fs";
import { createPublicKey, createHash } from "crypto";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error("Usage: node set-github-key.mjs <path-to-pem-file>");
  process.exit(1);
}

const pem = readFileSync(pemPath, "utf8").replace(/\r\n/g, "\n").trim();

const pub = createPublicKey({ key: pem, format: "pem" });
const der = pub.export({ type: "spki", format: "der" });
const fingerprint = createHash("sha256").update(der).digest("base64");
console.log(`Key fingerprint: SHA256:${fingerprint}`);
console.log("Compare this to the fingerprint shown on your GitHub App settings page.");
console.log("");

const escaped = pem.replace(/\n/g, "\\n");
const envPath = ".env";
let env = readFileSync(envPath, "utf8");

if (/^GITHUB_APP_PRIVATE_KEY=.*/m.test(env)) {
  env = env.replace(/^GITHUB_APP_PRIVATE_KEY=.*/m, `GITHUB_APP_PRIVATE_KEY="${escaped}"`);
  console.log("Updated existing GITHUB_APP_PRIVATE_KEY in .env");
} else {
  env += `\nGITHUB_APP_PRIVATE_KEY="${escaped}"`;
  console.log("Added GITHUB_APP_PRIVATE_KEY to .env");
}

writeFileSync(envPath, env, "utf8");
console.log("Done. Restart the bot.");
