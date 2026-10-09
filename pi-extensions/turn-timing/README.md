# Turn timing

Source stays in this repository, committed alongside the Paseo plugin. Install globally with `pi install /absolute/path/to/tietiezhi`: Pi adds a local package reference to personal settings and loads the declared timing extension across projects, without copying source or granting project trust. Remote hosts need their own installation. Keep the checkout at its installed path. For a one-off run, use `pi --extension /absolute/path/to/tietiezhi/pi-extensions/turn-timing/index.ts`. The optional project `.pi/settings.json` reference is local/ignored and not required by the global installation.

Requires Pi's `before_provider_request`, `message_update`, `message_end`, `turn_end` hooks and `appendEntry`. Validated against the locally installed Pi 1.1.0 API. Custom providers must forward the request payload hook; otherwise TTFT intentionally remains unavailable. Personal/global installation does not require project trust. Only project-local declarations require it. New Pi sessions load the extension; existing sessions need Pi resource reload at an idle boundary. Reloading the Paseo plugin does not reload Pi. Do not restart the daemon or interrupt a running turn.

## Definition

TTFT is measured with `performance.now()` from the primary provider-request payload hook to the first nonempty normalized text/thinking/tool-arguments delta. Response creation, headers, starts, signatures, empty deltas and tool results do not count. It is client-observed latency to the first surfaced output, not hidden model reasoning time, a tokenizer-level timestamp, or an HTTP-header latency. Hook dispatch and normalization add small client overhead. A tool name without an argument delta does not count as a token. Repeated payload hooks before output keep the original start and count attempts, including retry delay within that assistant response. Agent-level retries that create a failed first assistant response do not substitute a later successful call's TTFT.

Each Pi model turn persists only a validated numeric timing and response identity in a `custom` session entry named `tietiezhi.response-timing`. No prompt, response body, delta, header, API key or separate visible timeline item is saved. Nothing is added to model context, and historical message content is not edited.

The Paseo footer reads only metadata exactly matching the first assistant response after the latest user message (timestamp, provider, API, model and responseId). Later calls are not averaged or substituted; duplicate, mismatched, failed/aborted, missing-start or unmeasured records show `—`. Session transitions reset the collector. Old performance records are not backfilled.

## Verification

`npm run typecheck` and `npm test` cover the extension, first-delta detection, immutable first timing, retries, errors, reset, metadata validation, exact matching and native JSONL-to-performance persistence. `tests/pi-timing-sdk.mjs` additionally validates actual Pi resource loading and hook dispatch without a model request (pass the installed Pi package directory as its argument). This is not a real provider request or production App verification. Confirm activation by finding `tietiezhi.response-timing` metadata after a subsequent genuine Pi turn; plugin `running` alone is insufficient.
