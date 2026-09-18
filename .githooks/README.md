# .githooks

`core.hooksPath` is local config, so it does **not** survive a clone. After
cloning this repo, run:

    git config core.hooksPath .githooks

Without that line these hooks are inert and nothing warns you.

## What they do

- `pre-commit` — scans the index.
- `pre-push` — scans **every commit being pushed**, walking them one at a time.
  Not an endpoint diff: a file added in one commit and deleted in a later one
  does not show up in a diff between the two ends, which is exactly how a live
  API key hid in five commits for three days on 18 Sep 2026. Git keeps the blob
  either way, and a clone can read it.
- `scan.sh` — the rules, shared by both.

## The rule that matters most

    "environmentVariables":{"[A-Z]

The Firebase CLI logs its full API responses, and the Cloud Functions list
response embeds every deployed function's environment variables **with their
values**. One `firebase deploy` writes the entire production secret set to
`firebase-debug.log`.

GitHub's push protection caught the Anthropic key in that file because
`sk-ant-` has a recognisable shape. The same file also held `ADMIN_PASSPHRASE`,
`ALUMNI_TOKEN_SECRET`, `KORTEX_ACCESS_PEPPER`, `KORTEX_GUEST_SESSION_SECRET`,
`KORTEX_IP_SALT`, `KORTEX_LINK_SIGNING_SECRET`, `KORTEX_SYNC_KEY` and
`WEATHER_API_KEY` — none of which any scanner will ever recognise, because they
are just random strings. Matching the *dump shape* catches all of them at once
and needs no rule per secret.

`AIza…` is deliberately **not** matched: Firebase web API keys are public by
design and ship in the frontend.

## Getting a false positive through

Put `secret-scan: allow` on the same line. There is deliberately no flag to
disable the hook wholesale.
