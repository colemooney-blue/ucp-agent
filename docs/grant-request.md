# Draft: request for `complete_checkout` permission

**Not sent.** Yours to review, edit, and send. Fill the bracketed fields.

## Where to send it, best first

1. **Your Shopify partner manager**, if Blueprint has one. Order webhook
   registration is explicitly routed this way and the completion grant sits at
   the same sensitivity tier — very likely the same door.
2. **Your Plus / merchant account team.** For a merchant-side org this usually
   beats cold partner support, because the relationship already exists.
3. **Universal Cart early access waitlist** on the agentic commerce docs. The one
   documented "request access" flow in this area; gets you a named contact.
4. **Shopify Help Center -> Chat with us -> log in -> select your Partner
   organization.** Documented path for catalog rate-limit increases, so it
   reaches a team that handles UCP access.

Ask for **order webhooks in the same conversation** — `orders/create`,
`orders/updated`, `orders/delete` registration is also not self-serve.

## Draft

> Subject: UCP agent — requesting `complete_checkout` permission and order webhook registration
>
> Hi [name],
>
> We're building a UCP commerce agent at [org] and have the flow working
> end to end through `create_checkout` / `update_checkout` to
> `ready_for_complete`. We'd like to discuss two things that aren't self-serve:
>
> 1. Granting our token permission to call `complete_checkout`.
> 2. Registering a delivery URL for `orders/create`, `orders/updated`, and
>    `orders/delete`.
>
> Current state:
>
> - **Agent profile:** https://cdn.jsdelivr.net/gh/colemooney-blue/ucp-agent@main/ucp-profile.json — declares
>   `dev.ucp.shopping.cart`, `.checkout`, `.catalog.search`, `.catalog.lookup`,
>   `.fulfillment`, `.buyer_consent` at version 2026-08-25.
> - **Auth:** Token tier via Dev Dashboard client credentials. Catalog search
>   verified working end to end under this profile.
> - **Merchant side:** we are already a UCP-enabled Shopify merchant
>   (blueprint.bryanjohnson.com, UCP 2026-08-25, advertising cart, checkout,
>   order, fulfillment, discount and catalog capabilities). We are asking as a
>   merchant who has implemented the buy side, not as an unknown third party.
> - **Payments:** Shop Pay `dev.shopify.shop_pay`, Path B identity-linked
>   tokens. Buyer authorizes their Shop Wallet to our platform; all token
>   exchange server-side over TLS 1.2+, no public-client involvement.
> - **Escalation:** every completion path branches to `continue_url` on
>   `requires_escalation` or any unrecoverable message. We treat escalation as a
>   normal outcome, not an error.
> - **Idempotency:** UUID `idempotency-key` on every `complete_checkout` and
>   `cancel_*` call; `Retry-After` honoured with exponential backoff and jitter.
> - **Attribution:** `utm_source` on checkout URLs so merchants can attribute
>   agent-influenced sales.
>
> Use case: [one or two sentences — what the agent does and for whom]
> Expected volume: [orders/month, and which merchants]
> Also requesting: a catalog rate-limit increase. Our token currently reports
> {"catalog":{"max":5,"period":1}}, which is thin for production traffic.
> Buyer consent and revocation: [how a buyer authorizes autonomous purchases,
> and how they turn it off]
>
> Happy to walk through the implementation or run a test transaction against a
> dev store. What's the right process from here?
>
> Thanks,
> [name], [role], [org]

## Why lead with working code

The docs confirm the grant exists but never describe how it's obtained, which
means a human decides. Showing tasks 1–3 already working, plus correct escalation
and idempotency handling, is a materially stronger position than a proposal.
Expect the first reply to be routing rather than a decision.
