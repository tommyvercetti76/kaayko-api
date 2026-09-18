#!/bin/sh
# Refuse to let a secret into git history. Shared by pre-commit and pre-push.
#
# Written 18 Sep 2026, after a live Anthropic API key sat in five local commits
# for three days and only GitHub's push protection caught it. GitHub caught it
# because sk-ant- has a recognisable shape; the same file also carried
# ADMIN_PASSPHRASE, ALUMNI_TOKEN_SECRET, KORTEX_ACCESS_PEPPER,
# KORTEX_GUEST_SESSION_SECRET, KORTEX_IP_SALT, KORTEX_LINK_SIGNING_SECRET,
# KORTEX_SYNC_KEY and WEATHER_API_KEY, none of which any scanner will ever
# recognise. Relying on the host to notice is not a control.
#
# Usage: scan.sh <mode> [range]
#   scan.sh staged            — the index (pre-commit)
#   scan.sh range A..B        — every blob added in a commit range (pre-push)
#
# To get a genuine false positive past this, put `secret-scan: allow` on the
# same line. There is deliberately no flag to switch the whole hook off.
set -eu
mode="$1"; range="${2:-}"
root=$(git rev-parse --show-toplevel)
bad=0

say() { printf '%s\n' "$*" >&2; }

# ── 1. Debug logs. The actual carrier, and never worth committing. ───────────
# The Firebase CLI writes its full API responses here, and the Cloud Functions
# list response embeds every deployed function's environmentVariables WITH THEIR
# VALUES. One `firebase deploy` dumps the entire production secret set to disk.
# In range mode this walks every commit individually rather than diffing the two
# endpoints. A file added in one commit and deleted in a later one does not
# appear in an endpoint diff at all — which is exactly how the 18 Sep 2026 leak
# hid — but git keeps its blob forever and a clone can read it. So: every blob
# introduced by any commit in the range, paired with the commit that has it.
pairs=""
case "$mode" in
  staged)
    for p in $(git diff --cached --name-only --diff-filter=ACMR); do
      pairs="$pairs :$p"
    done ;;
  range)
    for c in $(git rev-list "$range"); do
      for p in $(git diff-tree --no-commit-id --name-only --diff-filter=ACMR -r "$c"); do
        pairs="$pairs $c:$p"
      done
    done ;;
esac
paths=$(for pr in $pairs; do printf '%s\n' "${pr#*:}"; done | sort -u)
for p in $paths; do
  case "$p" in
    *-debug.log|*/-debug.log|firebase-debug.log|firestore-debug.log)
      say "BLOCKED  $p"
      say "         Emulator/CLI debug logs carry deployed env-var values in plaintext."
      bad=1 ;;
  esac
done

# ── 2. Content patterns. ─────────────────────────────────────────────────────
# The environmentVariables rule is the important one: it catches every custom
# secret at once without needing a pattern per secret. AIza… is deliberately
# absent — Firebase web API keys are public by design and ship in the frontend.
scan_text() {
  printf '%s' "$1" | grep -nE \
    -e 'sk-ant-(api|admin)[0-9]*-[A-Za-z0-9_-]{40,}' \
    -e '(sk|rk)_live_[0-9A-Za-z]{16,}' \
    -e 'whsec_[0-9A-Za-z]{16,}' \
    -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
    -e 'ya29\.[A-Za-z0-9_-]{30,}' \
    -e 'SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}' \
    -e 'ghp_[A-Za-z0-9]{30,}' \
    -e '"environmentVariables":[[:space:]]*\{"[A-Z]' \
    2>/dev/null | grep -v 'secret-scan: allow' || true
}

seen=""
for pr in $pairs; do
  rev="${pr%%:*}"; p="${pr#*:}"
  # Templates and fixtures are meant to hold placeholder-shaped strings.
  case "$p" in
    *.example|*.sample|*.template|*__tests__*|*__mocks__*|*.test.js|*.spec.js|.githooks/*) continue ;;
  esac
  content=$(git show "$rev:$p" 2>/dev/null || true)
  [ -n "$content" ] || continue
  hits=$(scan_text "$content")
  if [ -n "$hits" ]; then
    case " $seen " in *" $p "*) continue ;; esac
    seen="$seen $p"
    say "BLOCKED  $p$([ -n "$rev" ] && printf ' (in %s)' "$(git log -1 --format=%h "$rev" 2>/dev/null)")"
    printf '%s\n' "$hits" | sed 's/^/         line /' | cut -c1-120 >&2
    bad=1
  fi
done

if [ "$bad" -ne 0 ]; then
  say ""
  say "Nothing was committed or pushed. A secret in git history is permanent —"
  say "rewriting it later does not un-leak it, and every clone keeps a copy."
  say ""
  say "Remove the value, then rotate it. It must be assumed compromised the"
  say "moment it is written to a file, not the moment someone reads it."
  exit 1
fi
exit 0
