# Webhooks (server-initiated events)

Webhooks let your API notify consumers of events by POSTing to a URL they
register — the inversion of the normal request/response. Design them as a
first-class, reliable, secure interface, not an afterthought.

## Delivery contract

- POST a JSON event to the consumer's registered URL. Keep a stable, versioned
  **event schema**; consider the [CloudEvents](https://cloudevents.io)
  structure for interoperability.
- Include enough to act without a callback, but treat the webhook as a
  notification — let consumers fetch authoritative state via the REST API if
  they need more.

```json
{
  "id": "evt_01HF...",
  "type": "order.paid",
  "time": "2026-06-13T10:15:00Z",
  "data": { "orderId": "123", "total": 50.00 }
}
```

- A 2xx from the consumer means delivered. Any other response (or timeout)
  means failed → retry.

## Security — sign every payload

Unsigned webhooks are forgeable; a receiver can't trust the source or that the
body is intact.

```http
POST /hooks/orders HTTP/1.1
Webhook-Id: evt_01HF...
Webhook-Timestamp: 1749808500
Webhook-Signature: v1,5h3f...base64hmac
Content-Type: application/json
```

- Sign with an **HMAC** (e.g. SHA-256) over the timestamp + raw body using a
  per-subscription secret; the receiver recomputes and compares (constant-time).
- Include a **timestamp** in the signed material and reject old ones to stop
  replay; require HTTPS endpoints.
- This aligns with the Standard Webhooks convention; document your exact scheme
  so receivers can verify.

## Reliability — retries and idempotency

- **Retry** failed deliveries with exponential backoff and jitter over a
  bounded window (e.g. up to 24h), then dead-letter and alert.
- Because retries (and at-least-once delivery) mean duplicates, give every
  event a stable **`id`** and tell consumers to **dedupe** on it — make
  processing idempotent.
- Don't assume **ordering**; include `time` and/or a sequence so consumers can
  order or discard stale events. If order matters, say so and design for it.

## Consumer-side guidance (what to tell integrators)

- Verify the signature and timestamp before doing any work.
- Return 2xx fast; do the real work asynchronously (ack, then process) so you
  don't time out and trigger needless retries.
- Dedupe on event `id`; expect at-least-once delivery.

## Operational

- Let subscribers register/rotate endpoints and secrets, choose event types,
  and see delivery attempts/failures.
- Provide a replay or manual re-send for missed events.
- Protect your own senders: time out slow receivers, cap concurrency, and
  isolate a failing endpoint so it can't back up the queue.

For event-driven delivery *inside* Azure (Event Grid, Service Bus, Container
Apps jobs) → `azure-development`; this reference is the public webhook contract.
