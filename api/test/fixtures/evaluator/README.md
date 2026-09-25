# Evaluator fixtures

`*.request.json` is a canonical evaluation request. `*.canonical.json` holds the
canonical answers every adapter must produce for it. `<provider>/*.response.json`
is that provider's HTTP response (`status`, `headers`, `body`), replayed through an
injected `fetch` in `evaluator.contract.test.ts`.

The `vercel-gateway` responses were written by hand from the wire schema of
`@ai-sdk/gateway@4.0.89`: `POST {baseURL}/evaluation-model` returning
`{ answers, usage?, warnings?, providerMetadata? }`.

The `typesafe` responses were written by hand from the API reference
(docs.typesafe.ai/api) and the types of `@typesafe-ai/sdk@0.6.0`:
`POST {baseURL}/v1/systemone` with `{ state, model, questions }` (yes/no questions
are `type: "noul"`), returning `{ model, answers, usage: { input_tokens,
output_tokens } }` and the request id in `x-typesafe-request-id`. Answers carry a
native `confidence` (and `legend` on scores) that the adapter discards; a noul
answer is `{ type: "noul", noul: P(yes) }`. `support-triage.errors.json` holds one
response per `EvaluatorError` code: error bodies use `{ detail }` (a string, or a
list of `{ loc, msg, type }` for validation errors), the shapes the SDK parses.
The exact error messages are guesses — the too-large (422) and unknown-model (400)
cases are matched by message, so check them against real responses.

Re-record from the real providers with `bun run fixtures:record` (needs
`AI_GATEWAY_API_KEY` and/or `TYPESAFE_API_KEY`; each key set records that
provider into `<provider>/recorded/`) whenever `ai`, `@ai-sdk/gateway` or
`@typesafe-ai/sdk` are upgraded. The contract suite replays whatever is recorded.
