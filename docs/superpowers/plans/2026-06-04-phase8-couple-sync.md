# Phase 8 (Plan's "Phase 4"): Per-item sharing + zero-knowledge couple sync

> Status: DESIGN ONLY (no code). This is the concrete design for the couple-sharing /
> partner-connection feature. It realizes **Phase 4** of the approved plan
> (`~/.claude/plans/can-you-help-me-snug-lovelace.md`). The filename uses "phase8" only as the
> doc ordinal in this folder; the feature is the plan's Phase 4 ("Per-item sharing + couple sync").
>
> Personal project. Fully separate from any employer systems or data. No money movement; read-only.

## 0. Recap of the model (load-bearing constraints)

From the approved plan and the existing code:

- **Local-first.** Each partner runs their own instance with their own SQLCipher DB
  (`packages/core/src/store.ts`, AES-256, key from a master passphrase held in the OS keychain via
  `packages/core/src/vault.ts`). Bank credentials never leave the machine.
- **Per-item opt-in.** `Account`, `Goal` (and per-transaction `Transaction`) each carry a
  `shareable` flag (`packages/core/src/types.ts`). Default is `false` / private.
- **Zero-knowledge couple view.** Neither partner sees the other's raw/private data — only what
  each flags as shareable, **aggregated**. Raw private transactions must never serialize out.
- **Occasional relay** stores **only** end-to-end-encrypted blobs and computes nothing. Each app
  uploads its own encrypted summary, downloads both, decrypts and merges **locally**.
- **Org/security constraints honored:** AES-256 only, at rest and via the existing GCM helpers;
  TLS 1.2+ in transit; no hardcoded secrets/keys (the pairing secret is user-supplied / device-held
  in the keychain, never in source); permissive-licensed deps only (no GPL).

What already exists that we reuse, not reinvent:

- **Crypto** — `packages/core/src/crypto.ts`: `deriveKey(passphrase, salt)` (scrypt N=2^17, r=8,
  p=1, 32-byte/AES-256 output), `encrypt(plaintext, key) -> {iv, tag, ciphertext}` (AES-256-GCM,
  96-bit random nonce), `decrypt(blob, key)` (throws on auth-tag mismatch). The whole sync layer is
  built on these three functions plus `randomBytes`.
- **Keychain** — `vault.ts` `KeyringVault` / `SecretVault` interface for device-held secrets.
- **Analytics** — `packages/core/src/analytics.ts`: `buildDashboard(...)`, `PeriodSummary`,
  `summarize()`, `reconstructNetWorthSeries()`. The merged couple view consumes the **same** model
  shape so the existing dashboard renderer can be reused with two data sources.
- **Dashboard** — `packages/ingestion/web/dashboard.html`: header `seg` with
  `data-view-btn="me|partner|couple"`, currently `data-disabled="true"`; a hidden `#privacy` banner
  ("Couple view adds only what you each chose to share…"); i18n `T` map with `v_partner`,
  `v_couple`, `privacy`, `partner_disabled` keys already present. This feature makes those live.

---

## 1. Partner connection / pairing

### Requirement
Two non-expert people, on two machines, with **no central account system**, must end up holding the
**same 32-byte shared secret** (`S_pair`) and the **same pairing id** (`pairingId`), over a channel
an attacker may observe. From `S_pair` we derive all sync keys. It must support **re-pairing** and
**revocation**, and survive one partner being non-technical.

### Options considered

| Option | How two people link | Pros | Cons |
|---|---|---|---|
| **A. Shared passphrase + scrypt** | Both type the same agreed phrase ("blue-otter-37-pancake"). Each runs `deriveKey(phrase, sharedSalt)`. | Dead simple; reuses `crypto.ts` `deriveKey` verbatim; no extra deps; works offline / out-of-band (say it on the phone). | Security == passphrase entropy. A weak phrase is offline-brute-forceable by anyone who grabs a blob from the relay. Salt must be shared too. No forward secrecy. |
| **B. Pairing code + PAKE (SPAKE2 / OPAQUE)** | Short code shown on device A, typed into device B; a PAKE handshake over the relay turns the low-entropy code into a strong mutual key, resisting offline guessing. | Strongest: a short human code yields a strong key; the relay/network learns nothing useful even if it MITMs the handshake (online-guess-limited). | Needs a vetted PAKE lib + an interactive online handshake through the relay (more relay surface, more moving parts); SPAKE2 libs in JS are thinner/less audited; over-engineered for a 2-person, in-home, one-time setup. |
| **C. QR / raw key exchange** | Device A generates a random 32-byte `S_pair`, shows it as a QR (or X25519 public-key exchange); device B scans it. | High-entropy key with **zero** user-typed secret; QR scan is friendly on phones; can ride the existing PWA. | Needs both devices physically together (fine for a couple) OR a real key-exchange (X25519) to do it remotely; a static QR is a long-lived secret that must be transferred safely (screenshot leakage). |

### Recommendation: **C (QR transfer of a random key) as the primary path, with A (shared passphrase + scrypt) as the no-camera fallback. Defer B (PAKE).**

Rationale:

- The threat that actually matters here is a **curious/compromised relay doing offline brute force
  on a low-entropy secret** (see §5). Option A is only as strong as the phrase a tired couple picks
  at 11pm — that is the weak link. Option C sidesteps it entirely: the secret is a full 256-bit
  random value, not human-memorable, so **there is nothing to brute-force**.
- Option C is also the friendliest for the intended setup: both partners are usually in the same
  home, and the app is already a phone-viewable PWA, so "show QR on laptop, scan with the other
  phone/laptop" is a natural one-time action.
- Option B (PAKE) is the academically strongest answer to "short code over a hostile channel," but
  it requires an interactive handshake **through the relay**, which contradicts the goal of keeping
  the relay a dumb blob store that "computes nothing." It also pulls in a less-audited JS PAKE
  dependency. For a 2-person tool with an out-of-band channel available, it is over-engineering.
  We keep it as a documented future upgrade if remote pairing without a shared physical moment
  becomes a real need.

**Concretely:**

1. **Initiator (device A)** generates `S_pair = randomBytes(32)` and
   `pairingId = randomBytes(16)` (hex). It renders both as a single QR payload:
   `kesef-pair:v1:<pairingId_hex>:<S_pair_base64url>` (also shown as text for manual copy).
2. **Joiner (device B)** scans the QR (or pastes the text). Both devices now hold identical
   `pairingId` + `S_pair`.
3. Each device stores `S_pair` in the **OS keychain** via `KeyringVault`
   (`service='kesef'`, `account='couple:S_pair:<pairingId>'`) — **never** on disk in plaintext,
   never in source. `pairingId` (non-secret) and a local label for the partner go in a small
   `couple_pairing` row in the SQLCipher store.
4. **Fallback A (no camera / remote):** a "Use a shared phrase instead" option. Device A generates
   and displays `pairingId` + a `sharedSalt = randomBytes(16)` (both non-secret) and instructs both
   partners to enter the **same agreed passphrase**. Each device computes
   `S_pair = deriveKey(passphrase + ':' + pairingId, sharedSalt)` using the **existing**
   `crypto.ts` `deriveKey` (scrypt N=2^17 already makes offline guessing expensive). UI must warn:
   "choose a long, unguessable phrase — anyone who guesses it can read your shared summary." This
   reuses code we already have and ship; it is the graceful degradation, not the default.

> Note: we deliberately do **not** invent a key-exchange protocol. Path C transfers a random key
> out-of-band; path A derives one from a shared secret with the audited scrypt we already use.

### Re-pairing
Re-pairing = generate a **new** `pairingId` + new `S_pair` and repeat the flow. Old keychain entry
and old relay objects are abandoned. Because keys are namespaced by `pairingId`, old and new never
collide. Re-pair whenever a device is lost, a phrase may have leaked, or a partner wants a clean
slate.

### Revocation
There are no server accounts to revoke, so revocation is **local and cryptographic**:

- **Either partner "disconnects":** delete the keychain `S_pair` entry and the `couple_pairing`
  row, set `coupleEnabled=false`, and stop uploading. The other partner can no longer get fresh
  data from you, and your app stops fetching theirs.
- **Tell the relay to forget the blobs:** a partner who holds `S_pair` proves control by signing a
  `DELETE` (HMAC over `pairingId` + timestamp, key = `K_auth`, see §4) so the relay can purge both
  objects. The relay can also auto-expire objects with a TTL (e.g. 30 days) so a dead pairing leaves
  no residue.
- **Forward effect:** revocation does **not** retroactively unshare already-merged data the partner
  has on their own device (that is inherent to any sharing — once they've seen a number, they've
  seen it). It only stops future syncs. Re-pair with a fresh key to rotate.

---

## 2. What gets shared — the "shareable summary"

### Principle
The summary is built **from the local store**, includes **only** items whose effective `shareable`
is `true`, and is **aggregated** so that raw private detail never appears. Specifically:

- **Accounts** — only `account.shareable === true`. We share **balance/value + type + a label**,
  not the statement. We do **not** ship the account's transaction list.
- **Goals** — only `goal.shareable === true`. Share name, target, current, target date.
- **Category totals** — computed **only** from transactions that are effectively shareable
  (`tx.shareable === true`, OR `tx.shareable == null` AND its account is `shareable`). Output is
  **per-category sums for a small set of fixed periods**, never line items. This mirrors
  `analytics.summarize()` but restricted to the shareable subset.
- **Net-worth contribution** — sum of shareable account balances, optionally split into the same
  liquid / investment / retirement / liability buckets the dashboard already uses (`Account.type`).
- **Raw transactions: NEVER.** There is no field in the payload that carries a transaction
  description, merchant, date, or per-transaction amount. The builder physically does not read them
  into the output object. (This is the single most important invariant; §7 adds a test that fails
  the build if any raw field leaks.)

### Effective-shareable rule (matches existing types)
```
txShareable(tx, account) =
  tx.shareable === true                       -> shared
  tx.shareable === false                       -> private (explicit per-tx opt-out wins)
  tx.shareable == null && account.shareable     -> shared (inherits account default)
  tx.shareable == null && !account.shareable    -> private
```
This is exactly the precedence the store already encodes (`Transaction.shareable` "overrides
account default when set"). A private account never contributes to category totals even if an
individual tx was flagged — an account marked private is fully private.

### Payload shape (versioned; this is the plaintext **before** encryption)
```jsonc
{
  "schema": "kesef.couple.summary/v1",
  "pairingId": "9f1c…",            // binds payload to this pairing (also AAD; see §4)
  "author": "A",                    // stable per-device role label, NOT a real identity
  "generatedAt": "2026-06-04",      // ISO date; coarse on purpose (no timestamps)
  "currency": "ILS",

  "netWorth": {
    "total": 184200,                // sum of shareable account balances only
    "byBucket": {                   // optional; derived from Account.type
      "liquid": 42200,
      "investment": 96000,
      "retirement": 46000,          // pension / gemel / keren — long-term
      "liability": 0
    }
  },

  "accounts": [                     // only shareable === true
    { "type": "bank",       "label": "Joint-ish checking", "balance": 42200, "asOf": "2026-06-01" },
    { "type": "investment", "label": "IBI portfolio",       "balance": 96000, "asOf": "2026-05-31" }
    // NOTE: no id that maps to the private DB, no transactions, no components unless flagged
  ],

  "spending": {                     // category TOTALS only — never line items
    "thisMonth": { "spent": 7300, "byCategory": [ {"category":"groceries","amount":2600},
                                                  {"category":"dining","amount":1400} ] },
    "last30":    { "spent": 7100, "byCategory": [ … ] },
    "last90":    { "spent": 20800, "byCategory": [ … ] },
    "year":      { "spent": 81000, "byCategory": [ … ] }
  },

  "goals": [                        // only shareable === true
    { "name": "Apartment down payment", "targetAmount": 600000, "currentAmount": 215000,
      "targetDate": "2028-01-01" },
    { "name": "Trip to Japan",          "targetAmount": 40000,  "currentAmount": 12500 }
  ]
}
```
Labels are user-entered display strings the owner chose to expose (the owner controls how much a
label reveals). `asOf` carries a date for "freshness" UX but no finer time. There is no list of
descriptions, merchants, counterparties, or individual amounts anywhere in the schema.

### Builder API (new, in `core`)
```ts
// packages/core/src/couple.ts
export interface CoupleSummary { /* the shape above */ }

export function buildShareableSummary(
  accounts: Account[], transactions: Transaction[], snapshots: BalanceSnapshot[],
  goals: Goal[], now: string, opts?: { author?: 'A' | 'B'; pairingId: string;
    overrides?: Map<string,string>; merchantRules?: Map<string,string> }
): CoupleSummary;
```
It filters first (drop everything non-shareable), then aggregates by **reusing the same category /
period logic** as `analytics.summarize()` on the filtered set, so couple numbers reconcile with the
owner's own dashboard for the shared subset.

---

## 3. Zero-knowledge couple sync — relay protocol

### Shape
The relay is a **dumb, append/overwrite blob store keyed by `pairingId` + author slot**. It holds
**ciphertext only**, never a key, never plaintext, and runs no finance logic. Each app:

1. builds its `CoupleSummary` (§2),
2. serializes to JSON, encrypts with the shared key (§4) → `{iv, tag, ciphertext}`,
3. `PUT`s it to its own slot,
4. `GET`s both slots, decrypts both, and merges locally (§6).

Two slots per pairing: `A` and `B` (the role each device picked at pairing time). An app only ever
writes its own slot.

### Minimal API (HTTPS, TLS 1.2+ enforced)
All bodies are JSON; the `blob` field is the base64 GCM output from `crypto.ts`.

```
PUT  /v1/blob/:pairingId/:slot      # slot ∈ {A,B}; upload your encrypted summary
  headers: Authorization: KESEF-HMAC <ts>:<base64 hmac>     # see §4 (proves you hold S_pair)
  body:    { "schema":"kesef.couple.blob/v1", "seq": 42, "blob": { "iv":"…","tag":"…","ciphertext":"…" } }
  -> 200 { "ok": true, "seq": 42 }
  -> 401 if HMAC invalid; 409 if seq <= stored seq (replay/stale, see §4)

GET  /v1/blob/:pairingId            # fetch BOTH slots
  headers: Authorization: KESEF-HMAC <ts>:<base64 hmac>
  -> 200 { "A": { "seq": 42, "blob": {…}, "updatedAt": "…" } | null,
           "B": { "seq": 17, "blob": {…}, "updatedAt": "…" } | null }

DELETE /v1/blob/:pairingId          # revocation / forget; HMAC-authenticated
  -> 200 { "ok": true }

GET  /v1/health                     # liveness only; no data
```

Properties the relay MUST hold:
- **Stores ciphertext verbatim.** It never parses `blob`; to it, the summary is opaque bytes.
- **No accounts, no email, no PII.** `pairingId` is a random opaque handle; `slot` is `A`/`B`.
- **Authn is HMAC, not login.** It verifies the request HMAC against `K_auth` derived from `S_pair`
  (the relay is given the ability to *verify*? — **no**: see §4; the relay verifies a per-pairing
  HMAC only because we give it a **separate verification value**, OR we skip server-side auth and
  rely on `pairingId` being an unguessable bearer secret. Decision below.)
- **TTL + size cap.** Objects auto-expire (e.g. 30 days idle) and are size-capped (e.g. 64 KiB) to
  bound abuse and limit metadata retention.

**Auth decision (kept simple, zero-knowledge-preserving):** the relay must **not** learn `S_pair`.
We give the relay a *verification key* `K_relay = HKDF(S_pair, "kesef/relay-auth/v1")` only if we
want it to reject unauthorized writers — but sharing `K_relay` with the relay lets a malicious relay
forge writes. Two clean choices:

- **(Default, recommended) Capability-URL model:** treat `pairingId` itself as a 128-bit unguessable
  **bearer capability**. Anyone who knows it can read/write that pairing's (encrypted) slots; since
  blobs are useless without `S_pair`, an attacker who guesses a `pairingId` learns nothing. No
  secret is shared with the relay at all. Writes are still **integrity-bound** to the holder of
  `S_pair` because the GCM tag + AAD (§4) means a forged blob won't decrypt for the partner. This is
  the simplest and most clearly zero-knowledge option; the only thing an attacker with a guessed
  `pairingId` can do is overwrite a slot with garbage (a DoS), which `seq` + the partner's
  decrypt-failure detection surfaces, and which re-pairing fixes.
- **(Optional hardening) MAC-gated writes:** include `K_relay` (a value derived from `S_pair` but
  **not** `S_pair` itself, and distinct from the data key) so the relay can drop writes lacking a
  valid MAC, cutting the DoS surface. The relay can verify but, lacking the data key `K_data`, still
  cannot read or forge a blob the partner will accept. Use this only if relay-side spam is observed.

We ship the **capability-URL** default; `pairingId` is high-entropy and the data is E2E-encrypted,
so server-side auth is a spam/DoS control, not a confidentiality control. Confidentiality and
integrity live entirely in the client crypto.

### Hosting
The zero-knowledge design makes location low-risk (the relay sees only ciphertext + sizes + timing):
- **A tiny VPS** (e.g. a 5$/mo instance) running the relay container behind TLS (Caddy/Let's
  Encrypt auto-HTTPS, TLS 1.2+), OR
- **One partner's machine** exposed over the home network / a tunnel (Tailscale, or Caddy with a
  dynamic-DNS hostname). Same code, same API.
The relay is a **new package** `packages/couple-relay` (Fastify, matching the existing local server
stack), Dockerized, stateless except for a small store (SQLite or even flat files keyed by
`pairingId/slot`). No finance dependency — it can be built and audited in isolation.

---

## 4. Crypto specifics

Everything below builds on `packages/core/src/crypto.ts` (AES-256-GCM, scrypt) — **no new crypto
primitives, no hardcoded keys**.

### Key hierarchy (all derived from `S_pair`, the only secret)
`S_pair` (32 random bytes, from QR; or scrypt of the shared phrase) lives only in the OS keychain.
We never use it directly; we derive purpose-separated subkeys with **HKDF-SHA-256** (Node
`crypto.hkdfSync`, no new dependency) so a single key never serves two roles:

```
K_data   = HKDF-SHA256(S_pair, salt="", info="kesef/couple/data/v1",  L=32)   // AES-256-GCM data key
K_auth   = HKDF-SHA256(S_pair, salt="", info="kesef/couple/auth/v1",  L=32)   // (optional) request HMAC key
K_relay  = HKDF-SHA256(S_pair, salt="", info="kesef/couple/relay/v1", L=32)   // (optional) MAC-gated writes
```
Distinct `info` strings guarantee domain separation. Only `K_data` is used for the blobs. `K_auth`
is for the client→relay request HMAC (`Authorization: KESEF-HMAC <ts>:<hmac>` where
`hmac = HMAC-SHA256(K_auth, "<method>\n<path>\n<ts>\n<sha256(body)>")`) and is **never** sent to the
relay in the default capability-URL model; it is only used if MAC-gated writes are enabled (then the
relay is given `K_relay`, never `K_data`/`K_auth`/`S_pair`).

> If we adopt the shared-phrase fallback (Option A), `S_pair = deriveKey(phrase + ':' + pairingId,
> sharedSalt)` from the **existing** `crypto.ts` scrypt (N=2^17), then the same HKDF tree applies.

### Per-blob encryption
Use `crypto.ts` `encrypt(JSON.stringify(summary), K_data)` directly:
- **Nonce:** a fresh `randomBytes(12)` **per encryption** (already what `encrypt()` does). A new
  nonce is generated on **every** `PUT`, including re-uploads of an updated summary, so the
  (key, nonce) pair is never reused — the critical GCM safety condition. With 96-bit random nonces
  and the tiny volume here (a couple syncing occasionally), reuse probability is negligible.
- **Confidentiality + integrity:** AES-256-GCM gives both. The 128-bit auth tag means any
  bit-flip, truncation, or forged ciphertext makes `decrypt()` **throw** (it already does on
  tag mismatch). A partner therefore can't be fed tampered numbers without the app noticing.

### Associated data (AAD) — bind context, prevent slot/pairing confusion
We extend the blob to authenticate non-secret context so a blob can't be **moved** between slots or
pairings and still verify. Concretely, the encrypt/decrypt for couple blobs uses GCM AAD =
`utf8("kesef.couple.blob/v1|" + pairingId + "|" + slot + "|" + seq)`:
- prevents a relay from swapping partner A's blob into slot B (the AAD wouldn't match on decrypt),
- prevents cross-pairing replay (different `pairingId` ⇒ AAD mismatch ⇒ throw),
- binds the monotonically increasing `seq` so an old blob can't masquerade as new.

> Implementation note: `crypto.ts`'s current `encrypt/decrypt` don't take an AAD argument. Add an
> **optional** `aad?: Buffer` parameter (`cipher.setAAD(aad)` / `decipher.setAAD(aad)`) — a small,
> backward-compatible extension to the existing helpers, not a new module. When omitted, behavior is
> identical to today.

### Replay protection (defense in depth)
GCM stops tampering but not **replay** of a previously-valid blob (a relay could serve yesterday's
ciphertext). Two layers:
1. **Monotonic `seq`** per slot. Each device increments `seq` on every `PUT`; the value is inside
   the AAD (authenticated) and also stored alongside the blob. The relay **rejects** a `PUT` whose
   `seq <= stored seq` (409). On `GET`, the client records the highest `seq` it has accepted per
   slot and **refuses to regress** — a served-stale blob with an old `seq` is ignored.
2. **`generatedAt` freshness**, surfaced in UX ("partner's data as of …"), so a frozen-but-valid
   blob is at least *visible* as stale rather than silently trusted as current. (Coarse date only,
   to limit timing metadata — see §5.)

### No hardcoded secrets / transport
- The only secret (`S_pair`) is generated at runtime (QR) or user-supplied (phrase) and stored in
  the OS keychain. **Nothing secret is committed to source or config.** `info`/`schema`/AAD strings
  are public constants, not secrets.
- All relay traffic is **HTTPS, TLS 1.2+** (Caddy/Let's Encrypt or a TLS-terminating tunnel). The
  client refuses plain `http://` relay URLs except an explicit `localhost` dev override.

---

## 5. Threat model

Adversaries: **(a) a curious or fully malicious relay operator**, **(b) a passive/active network
attacker** between a device and the relay.

### What they CANNOT learn
- **Plaintext finances.** Blobs are AES-256-GCM under `K_data`, derived from `S_pair`, which the
  relay never holds. A curious/compromised relay sees only opaque ciphertext. No balances,
  categories, goals, labels, or counts are recoverable.
- **The shared key.** `S_pair` never leaves the two devices' keychains; only `K_data`/`K_auth`/
  `K_relay` are derived from it, and none of those (except optionally `K_relay`, which can't decrypt)
  is ever sent to the relay.
- **Forge accepted data.** Without `K_data` an attacker cannot produce ciphertext that decrypts to
  attacker-chosen numbers; GCM + AAD make any forgery throw on the partner's `decrypt()`. They can
  corrupt a slot (garbage), but cannot make the partner *believe* a chosen false balance.
- **Network attacker (TLS).** With TLS 1.2+ and cert validation, a passive eavesdropper sees only
  encrypted transport; an active MITM without a valid cert is rejected. Even if TLS were stripped,
  the payload is still E2E-encrypted, so the network attacker is in the same position as the relay.

### What they CAN learn (and mitigations)
- **Existence + cadence of a pairing.** The relay knows "some `pairingId` has slots A and B that get
  updated sometimes." It does **not** know who the people are (`pairingId` is random, no email/PII).
  *Mitigation:* opaque ids; no identity fields; optional TTL so dormant pairings disappear.
- **Metadata: blob sizes and update timing.** Ciphertext length roughly tracks plaintext length
  (more shared accounts/goals ⇒ bigger blob), and `PUT` timing reveals when each partner synced.
  Sizes could weakly hint "partner shares a lot vs a little"; timing could hint activity patterns.
  *Mitigations:* (1) **pad** the plaintext to fixed-size buckets (e.g. round JSON to the next
  1 KiB with a `"pad"` filler field) so size leaks bucket, not exact count; (2) keep `generatedAt`
  **coarse (date only)** and avoid second-level timestamps in the payload; (3) sync **on demand /
  batched**, not continuously, so cadence is uninformative; (4) since hosting can be one partner's
  own machine, the operator-metadata concern can be eliminated entirely by self-hosting.
- **Denial of service.** A relay (or someone who guessed a `pairingId`) can delete/overwrite slots
  or go offline. *Impact:* you lose the **shared** view until re-sync/re-pair — **never** your own
  data (local-first; the relay holds nothing you can't regenerate). *Mitigations:* `seq` rejects
  stale overwrites; optional MAC-gated writes (§4) blunt third-party spam; re-pairing issues fresh
  keys and a fresh `pairingId`.

### Impact if the relay is fully compromised
Worst case the attacker gets: the set of ciphertext blobs, their sizes, and update times for some
random `pairingId`s. They get **no plaintext and no keys**. They can **delete** blobs (DoS) or serve
**stale** ones (caught by `seq`/freshness) or **garbage** (caught by GCM auth). They cannot read or
convincingly forge finances. This is the entire point of the zero-knowledge design: **trust in the
relay is not required for confidentiality or integrity** — only for availability, and even that is
recoverable and can be self-hosted away.

### Residual / out-of-scope
- **A compromised endpoint device** (malware on a partner's laptop) defeats everything — it holds
  the real DB and `S_pair`. Out of scope for the relay design; mitigated by the existing local
  hardening (encrypted store, keychain).
- **Social trust.** Anything a partner flags `shareable` is, by design, visible to the other
  partner forever once merged; revocation is forward-only (§1).

---

## 6. Couple-view UX

### The live view
When **both** an `S_pair` exists (paired) and at least one partner's blob has been fetched, the
`partner`/`couple` segment buttons in `dashboard.html` (`data-view-btn`) become enabled and the
`#privacy` banner (already in the markup, currently `hidden`) is shown. The renderer already builds
its UI from a `DashboardModel`; the couple view assembles a **merged model** from two
`CoupleSummary` objects + the local one:

- **Combined net worth** — `me.netWorth + partner.netWorth` (shareable subset). The hero number and
  sparkline get a "couple" mode; where both have history we sum the series, where only one does we
  show that one labeled. Per §2 we can also render the **byBucket** split (liquid / investment /
  **retirement = long-term** / liability), which directly feeds the existing "day-to-day vs
  long-term" framing from Phase 5.
- **Day-to-day vs long-term across both partners** — spending category totals are summed per
  category and per period (`thisMonth/last30/last90/year`) from both summaries; long-term
  (retirement) balances are shown separately from spendable cash, so the couple sees "what we spend"
  vs "what we're building," combined.
- **Shared goals** — the union of each partner's shareable goals, each tagged with whose it is (or
  "shared" if both flagged a same-named goal); progress bars reuse the existing goals card. A couple
  goal like "apartment down payment" shows combined `currentAmount / targetAmount`.
- **Three view modes** via the existing segment:
  - **Me** — today's behavior, unchanged (full personal detail).
  - **Partner** — *only* what the partner chose to share (their summary), clearly read-only and
    labeled "shared by your partner." Never any raw transactions (the schema has none).
  - **Couple** — the merged aggregate above.
- **Privacy reassurance** — the `#privacy` banner ("Couple view adds only what you each chose to
  share. Personal stuff stays private.") is shown in Partner/Couple modes; `T.privacy` already has
  he/en copy.

### Toggling per-item sharing
Sharing is per item and already modeled (`shareable` on `Account`/`Goal`/`Transaction`):
- **Accounts & Goals:** a small **share toggle** (the existing `toggle-pill` style) on each account
  card and goal card — "Share with partner." Flipping it calls a local `127.0.0.1` endpoint that
  flips `account.shareable` / `goal.shareable` in the store. Default OFF.
- **Transactions / categories:** because the summary shares **category totals**, not line items, the
  practical control is at the **account** level (share this account's spending or not). A
  per-transaction opt-out (`tx.shareable=false`) remains available for "this account is shared but
  hide this one purchase from the totals," honoring the existing override precedence (§2).
- **Visibility of effect:** a tiny "X items shared" indicator + a preview ("this is what your
  partner will see") built from `buildShareableSummary` **before** anything is uploaded, so the user
  confirms exactly what leaves the device. Nothing syncs automatically on toggle; sync is an
  explicit action (reuses the existing Sync button affordance, or a dedicated "Sync with partner").

### Making the disabled toggle live (concrete wiring)
In `dashboard.html`:
1. Remove `data-disabled="true"` from the `partner`/`couple` buttons **only when paired**; until
   then keep the current disabled tooltip (`T.partner_disabled`, "Arrives with couple-sync").
2. Extend the `data-view-btn` click handler (currently only `me` is wired) to switch the active
   model: `me` → local `DashboardModel`; `partner` → model built from partner summary; `couple` →
   merged model. Re-run `render()` with the chosen model.
3. Unhide `#privacy` in partner/couple modes.
4. Add an i18n "Sync with partner" action + a "shared by your partner · as of <date>" freshness
   label (drives the §4 staleness UX).

No change to the personal "Me" experience.

---

## 7. Phased implementation plan (small, shippable, mapped to the monorepo)

Each step is independently testable and leaves the app working. Order is chosen so the **privacy
invariant is provable before any network code exists**.

### P8-T1 — Core: shareable-summary builder (no network)
- **Where:** new `packages/core/src/couple.ts`; export from `core/src/index.ts`.
- **What:** `buildShareableSummary(...)` (§2) + the effective-shareable rule; reuse
  `analytics.summarize()` for category/period math on the filtered set.
- **Verify (the load-bearing test):** unit tests that (a) a private account/goal/tx **never** appears
  in output; (b) flipping `shareable` includes exactly that item; (c) **no raw field leaks** —
  assert the serialized summary contains no transaction `description`/`merchant`/`id` and no
  per-transaction amount (golden-shape test that fails CI if the schema grows a leak); (d) couple
  category totals reconcile with the owner's dashboard totals for the shared subset.

### P8-T2 — Core: crypto helpers extension + key tree
- **Where:** extend `packages/core/src/crypto.ts` (optional `aad` param on `encrypt`/`decrypt`);
  add `deriveCoupleKeys(S_pair)` (HKDF tree, §4) and `seal/openCoupleBlob(summary, K_data, {pairingId,
  slot, seq})`.
- **What:** purpose-separated subkeys; per-blob random nonce (already in `encrypt`); AAD binding
  pairingId/slot/seq.
- **Verify:** round-trip encrypt→decrypt; **tamper** a byte ⇒ decrypt throws; **wrong AAD**
  (swapped slot / pairingId / seq) ⇒ throws; wrong key ⇒ throws; nonce differs across two encrypts of
  identical input. Confirm `aad`-omitted path is byte-identical to today (no regression).

### P8-T3 — Relay service (new package, ciphertext-only)
- **Where:** new `packages/couple-relay` (Fastify, Dockerized; SQLite or flat files keyed by
  `pairingId/slot`). Permissive deps only.
- **What:** `PUT/GET/DELETE /v1/blob/...` + `/v1/health` (§3); `seq` monotonic rejection; size cap;
  TTL; HTTPS via Caddy/Let's Encrypt (or a tunnel) — TLS 1.2+. Capability-URL auth (default);
  optional MAC-gate behind a flag.
- **Verify:** integration test asserting the **stored object is ciphertext** (no plaintext field is
  ever parseable; `blob` is opaque); `seq<=stored` ⇒ 409; oversized ⇒ rejected; TTL purges; `GET`
  returns both slots; relay has **zero** finance imports. Inspect a stored blob by hand and confirm
  it's unreadable (mirrors the plan's Phase-4 verification: "the blob on the relay is ciphertext").

### P8-T4 — Pairing + key custody
- **Where:** `packages/ingestion` CLI (`npm run couple ...`) + a small dashboard pairing screen;
  keychain via `vault.ts`.
- **What:** QR generation/scan (primary) + shared-phrase fallback (Option A via existing scrypt);
  store `S_pair` in keychain (`couple:S_pair:<pairingId>`), `pairingId`+label in a `couple_pairing`
  store row; re-pair and disconnect/revoke flows (§1).
- **Verify:** two local instances derive the **same** `S_pair` from the same QR/phrase; `S_pair`
  is in the keychain and **not** on disk in plaintext; disconnect removes the key and stops uploads;
  re-pair yields a fresh, non-colliding `pairingId`.

### P8-T5 — Sync client (glue T1–T4)
- **Where:** `packages/ingestion` (e.g. `couple-sync.ts`) + a `127.0.0.1` server route the dashboard
  calls; reuse `core` builder + crypto.
- **What:** build summary → seal with `K_data` (+AAD) → `PUT` own slot (incrementing `seq`) → `GET`
  both → open/verify → hand both summaries to the merge step. Refuse stale `seq`; surface decrypt
  failures as "couldn't read partner's data" rather than crashing.
- **Verify:** end-to-end with two instances + the T3 relay: partner's shared items appear; **private
  items never appear**; tampered/garbage blob is reported, not trusted; stale (`seq`-regressed) blob
  is ignored; works against both a localhost relay and a TLS relay.

### P8-T6 — Couple-view UI (make the toggle live)
- **Where:** `packages/ingestion/web/dashboard.html` (+ its render module).
- **What:** enable `partner`/`couple` `data-view-btn`s when paired; merged model (combined net worth,
  day-to-day vs long-term, shared goals); per-item **share toggles** on account/goal cards; a
  "what your partner will see" preview built from `buildShareableSummary` **before** upload; unhide
  `#privacy`; he/en strings + "as of <date>" freshness; RTL-safe.
- **Verify:** via preview tools (`preview_start` + screenshots, per the plan's verification habit):
  (a) only flagged items show in Partner/Couple; (b) private items absent; (c) toggling a card flips
  `shareable` and the preview updates; (d) numbers reconcile; (e) desktop + phone widths; (f) Me
  view unchanged; (g) he/en + RTL render correctly.

### Sequencing & dependencies
T1 and T2 are independent and can land first (pure `core`, fully unit-tested — the privacy invariant
is proven here, before any byte hits a network). T3 is independent of T1/T2 (it never sees
plaintext). T4 depends on T2 (key custody uses the key tree). T5 depends on T1–T4. T6 depends on T5.
Ship T1–T3 behind no flag (inert until paired); gate the live couple view (T6) behind "paired &&
blob fetched" so the dashboard's "Me" experience is untouched until the user opts in.

---

## Appendix: constraint checklist
- **AES-256 only**, at rest (SQLCipher) and for blobs (GCM via `crypto.ts`). ✔
- **TLS 1.2+** for all relay transport; plain http only for explicit localhost dev. ✔
- **No hardcoded secrets/keys** — only secret is `S_pair`, runtime-generated/user-supplied, kept in
  the OS keychain; all `info`/AAD/schema strings are public constants. ✔
- **Permissive deps** — Fastify (MIT), Node built-in `crypto` (HKDF/GCM/scrypt), a QR lib (pick an
  MIT/Apache one, e.g. `qrcode` MIT); **no GPL**. ✔
- **Zero-knowledge relay** — stores ciphertext only, computes nothing, can self-host. ✔
- **Per-item opt-in** — built on the existing `shareable` flags; default private. ✔
