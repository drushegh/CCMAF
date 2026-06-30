# Input/Output Handling, Secrets and Cryptography

## Input handling

- Validate at the trust boundary: type, length, range, format —
  **allow-lists** (what is permitted) not deny-lists (what is known
  bad). Validation is a quality gate, not the injection defence —
  parameterisation/encoding is.
- Canonicalise before checking: path traversal (`../`, URL-encoded
  variants, UNC), unicode normalisation, double decoding.
- File uploads: validate type by content (magic bytes) not extension;
  size limits; store outside the web root with generated names;
  process in a sandbox (image/PDF parsers are exploit surface).
- Deserialisation: never deserialise untrusted data with permissive
  formats (`pickle`, `BinaryFormatter`, Java native, `yaml.load`
  without SafeLoader). JSON + schema validation; if you must,
  allow-list types.
- XML: external entities OFF (`defusedxml` in Python; secure parser
  settings elsewhere) — XXE and billion-laughs.

## Injection defence by sink

| Sink | Rule |
|------|------|
| SQL/NoSQL | Parameterised queries/ORM parameters ALWAYS; never string-build queries, including ORDER BY/identifiers (allow-list those) |
| OS commands | Don't shell out if an API exists; else argument arrays (`subprocess.run([...])`), never `os.system`/string concat; no user input in shell strings |
| LDAP/XPath/regex | Escape per context; bound regex against ReDoS |
| Templates | No user input into template SOURCE (SSTI); only into rendered variables |
| LLM prompts | Treat retrieved/user content as data: delimit, never grant it tool authority; output of an LLM is untrusted input to downstream sinks |

## Output encoding (XSS)

Encode at output time for the exact context: HTML body, attribute,
JavaScript, URL — each differs. Framework auto-escaping (React JSX,
Razor, Angular) is the default defence: the review targets are the
escape hatches — `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML`/
`insertAdjacentHTML` assignment, `document.write`, `v-html`,
`Html.Raw`, `bypassSecurityTrust*`. Untrusted HTML must go through a
maintained sanitiser (DOMPurify) with a tight config. Add CSP as
defence-in-depth, not as the fix.

## Known-dangerous patterns (instant review flags)

`eval()` / `new Function(str)` / dynamic `import()` of user data;
`os.system` / shell-string concat; `pickle.load` / `yaml.load` /
`torch.load(weights_only=False)` on untrusted data; innerHTML-family
sinks above; stdlib XML parsing of untrusted XML; TLS verification
disabled (`verify=False`, `rejectUnauthorized: false`,
`InsecureSkipVerify`); `crypto.createCipher` (removed Node 22, weak
KDF) — use `createCipheriv`; ECB mode anywhere; MD5/SHA-1 for
security; `Math.random()`/non-CSPRNG for tokens; hardcoded
credentials/keys; SSRF — user-influenced URLs fetched server-side
without allow-listing (block link-local/metadata endpoints).

## Secrets hygiene

1. Source of truth: Key Vault/Secrets Manager; **managed identity
   over any stored credential** wherever the platform allows.
2. Never in: source, config committed to repos, build logs, error
   messages, client bundles, LLM prompts/transcripts, tickets.
3. Pre-commit + CI secret scanning (gitleaks/GitHub secret scanning);
   a committed secret is rotated immediately — git history is
   forever.
4. Per-environment secrets, least scope, expiry where supported;
   audit access.
5. `.env` files: local-dev convenience only, gitignored, never the
   production mechanism.

## Cryptography rules (use, don't invent)

- **At rest**: AES-256-GCM (authenticated); platform/KMS-managed keys
  with rotation; envelope encryption for data keys.
- **In transit**: TLS 1.2+ (prefer 1.3), verification always on,
  HSTS on web; mTLS or token audience checks service-to-service.
- **Passwords**: Argon2id (or bcrypt/scrypt) with per-user salt —
  never reversible encryption, never fast hashes.
- **Tokens/IDs**: CSPRNG (`secrets`, `crypto.randomBytes`/`randomUUID`);
  signed tokens validated fully (alg allow-list — reject `none`,
  audience, issuer, expiry; JWKS rotation handled).
- **Signatures/integrity**: HMAC-SHA-256 for shared-secret integrity
  (constant-time compare); asymmetric (Ed25519/ECDSA) for provenance.
- Key management is the actual problem: storage (HSM/KMS), rotation,
  separation per purpose/environment, and who can read it.
- Don't compose primitives yourself; use the platform's high-level
  APIs (libsodium-style sealed boxes, DPAPI/Key Vault, JCA/CNG).

Per-language idiom details live in each language skill's security
reference; this file is the cross-cutting law.
