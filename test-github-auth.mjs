import { readFileSync } from "fs";
import { createSign, createPublicKey, createHash } from "crypto";
import { request } from "https";

const pemPath = process.argv[2];
const appId = process.argv[3];

if (!pemPath || !appId) {
  console.error("Usage: node test-github-auth.mjs <path-to-pem-file> <app-id>");
  process.exit(1);
}

const pem = readFileSync(pemPath, "utf8").replace(/\r\n/g, "\n").trim();

const pub = createPublicKey({ key: pem, format: "pem" });
const der = pub.export({ type: "spki", format: "der" });
const fingerprint = createHash("sha256").update(der).digest("base64");
console.log(`Fingerprint: SHA256:${fingerprint}`);

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const now = Math.floor(Date.now() / 1000);
const payload = { iat: now - 60, exp: now + 540, iss: parseInt(appId, 10) };
const header = { alg: "RS256", typ: "JWT" };
const data = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
const sig = createSign("RSA-SHA256").update(data).sign(pem);
const jwt = `${data}.${toBase64Url(sig)}`;

console.log(`App ID in JWT: ${payload.iss}`);
console.log("Making GET /app request...");

const options = {
  hostname: "api.github.com",
  path: "/app",
  method: "GET",
  headers: {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "test-github-auth",
  },
};

const req = request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    console.log(`Status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(body);
      if (res.statusCode === 200) {
        console.log(`Success! App name: ${parsed.name}, App ID: ${parsed.id}`);
      } else {
        console.log(`Error: ${JSON.stringify(parsed)}`);
      }
    } catch {
      console.log(`Raw response: ${body}`);
    }
  });
});
req.on("error", (e) => console.error(`Request error: ${e.message}`));
req.end();
