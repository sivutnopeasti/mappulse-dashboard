// Encrypts PAT_TOKEN with a key derived from SALASANA and writes vault.json for the login page.
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const ITERATIONS = 600000;
const { PAT_TOKEN, SALASANA } = process.env;
if (!PAT_TOKEN || !SALASANA) {
  console.error("PAT_TOKEN and SALASANA secrets are required");
  process.exit(1);
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const baseKey = await crypto.subtle.importKey("raw", enc.encode(SALASANA), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
  baseKey,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"],
);
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(PAT_TOKEN.trim()));

writeFileSync(
  process.argv[2] || "vault.json",
  JSON.stringify({ v: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) }),
);
console.log("vault.json written");
