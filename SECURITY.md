# Security

Do not put real keys or private media in a public issue. A public security contact has not been configured; report privately to the deployment operator.

Tokens have high entropy and server-side SHA256 digests. Do not put account API keys in URLs. Share tokens are short-lived, revocable bearer permissions delivered through a fragment and exchanged via a header.

Server media imports resolve and pin public DNS addresses, reject private/special ranges and re-check each redirect. Uploads validate length, SHA256, file signature and ffprobe result. No user shell or FFmpeg expressions are accepted. Media tools still process untrusted binary data; the unprivileged container and external resource isolation require deployment validation before public service.

Paid requests are disabled by default. Ambiguous upstream acceptance is never automatically resubmitted. Claimed hard bounds are only as reliable as the operator-verified model profile; do not enable a model with an unbounded billing surface.

Not a completed security audit: rate limits, account/storage quotas, multi-node load, recovery under database outage, actual S3 policies and image supply chain still require operational review.
