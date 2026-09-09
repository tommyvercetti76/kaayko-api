# The arcade, and what a win is worth

Two machines and one argument. Everything that decides money happens on the server.

## The machines

All three live on the product page, in one tab menu. Nothing is on the cart except the field
where a won code is typed in.

| Machine | How you play | Cleared at | Worth | Applies to |
|---|---|---|---|---|
| Franking Rush | Strike a lane while an envelope is inside the lit band | 12 franked, ≤8 missed, ≤8 misfired | 2% | magnets and bottles |
| Mail Run | Hold to climb, release to fall, thread the towers | 12 towers passed | 2% | magnets and bottles |
| The Beggathon | Type a plea in sixty seconds | Graded 3–10% | 3–10% | the whole cart, premium included |

Totes and t-shirts are premium. `GET /arcade/challenge` answers `playable: false, reason: "PREMIUM"` for
them, and the two machine tabs render disabled on those products. The Beggathon stays available on every
product, because it is the only route to a discount that touches a premium line.

### Franking Rush: the strike zone

An envelope can only be marked while it is between `ZONE_LO` (0.60) and `ZONE_HI` (0.88) in screen
widths — the lit band just before the head. A tap into a lane with nothing in the band is a **misfire**
and is counted; eight of them ends the run. That is what stops "hit all three lanes as fast as possible"
from being a winning strategy, which is what the game was before the band existed. A player whose timing
is within about a third of a second still clears it every time; a masher never does.

## Reward codes

Every code is a document in **`arcade_rewards`**, keyed by the code itself:

```
code            "KAY-XXXXX-XXXXX"      unambiguous alphabet, no O/0/I/1
percent         2 | 3..10
scope           "eligible" | "cart"    which lines the percentage applies to
game            "franking" | "mailrun" | "beg"
productId       the product the run was started from, or null
emailKey        sha256(email + ARCADE_SECRET), or null if none was given
meta            the seed and replay result, or the beg's axes
redeemed        false until an order consumes it
orderId         the PaymentIntent that consumed it
createdAt       server timestamp
expiresAt       createdAt + 1 hour
```

Nothing about a code is inferred later: the percentage, the scope and both timestamps are written
once, when it is minted, by `mintReward()` in `api/arcade/arcade.js`. That is the only function
that creates one.

### Expiry — one hour, claimed or not

`REWARD_TTL_MS = 60 * 60 * 1000`. A code dies one hour after it is minted whether or not anybody
used it. The window is short on purpose: this is a discount for the order you are in the middle of,
not a coupon to keep. It is enforced in `computeRewardDiscount()` (`api/arcade/rewards.js`), which
returns `EXPIRED` and a zero discount, and it is stated to the shopper in five places:

- the winning screen on a product page, counting down while it sits there
- the fine print under the machines, before the game is played
- the Beggathon's own rules, before the sixty seconds start
- the discount-code field in the cart, once a code is held
- the About page

### Single use

`redeemReward()` sets `redeemed: true` and stamps the `orderId`, and it is called only once the
PaymentIntent exists — an abandoned checkout cannot burn a code. A redeemed code returns
`ALREADY_REDEEMED` and takes nothing off.

### Who a code belongs to

If an email was given when the code was won, `emailKey` is stored (hashed, never the address) and a
different email cannot spend it: `WRONG_OWNER`. A code won without an email is bearer.

## What cannot be decided in the browser

Both machines run a fixed 1/60s timestep against a seeded RNG, so a run is completely determined by
`(seed, inputs)`. The client sends only its inputs — `{s, lane}` taps or `{s, down}` events, where `s`
is an integer **step index**, never a float time. The server replays them with the same rules file
(`api/arcade/gameRules.js`, generated from `kaayko/src/js/arcade/gameRules.js`) and decides the
outcome. Rounding a time to milliseconds instead of using step indices pushes events across step
boundaries and makes the two replays disagree, which is how this was first written and why it is
not written that way now.

The Beggathon is graded in `api/arcade/begScore.js`. It refuses, with no score, anything pasted,
too short, typed on a metronome, sworn, or mashed; then it scores four axes — the case made (35%),
whether it has been heard before (30%), whether it reads like a person (20%), and how much of the
minute was left (15%) — and reports every one of them back to the shopper, in words, with the
figure it produced.

## The Beggathon's gates

Twenty-four of them, in `begScore.js`, ordered cheapest first. Each ends the run with a
reason and a line of banter. Grouped: integrity (PASTED, DROPPED, NOT_TYPED, TOO_FEW_KEYS,
MECHANICAL_TYPING, TOO_FAST, IMPOSSIBLE_WPM, RHYTHM_REPLAY), shape (TOO_SHORT, TOO_LONG,
TOO_FEW_WORDS, TOO_SLOW, NO_SENTENCE), language (KEYBOARD_WALK, LOW_ENTROPY, CONSONANT_SOUP,
NOT_ENGLISH, GIBBERISH), substance (WORD_SPAM, PHRASE_LOOP, ALL_CAPS, LINK_SPAM, NO_ARGUMENT)
and honesty (PROFANITY, SELF_REPEAT, ECHO).

GIBBERISH tests whether words are **pronounceable**, not whether they are in our dictionary.
A four-hundred-word list does not know "signalman" or "Darjeeling", and refusing an honest
plea for using a real word we had not heard of is worse than letting an inventive one through.
The dictionary still sets the legibility *score*; it no longer decides who gets in.

Scoring is curved and deliberately mean: most accepted pleas land on 3-5%, and the top of
the range has to be earned. A plea with no reason and no specifics does not get a low
score, it is refused outright (NO_ARGUMENT).

## The ten penalty rules

They are numbered in `penalty.js` because they only work together; each plugs a leak the
one before it opens. Paste strike (+1% up to +5%), total lockout across all three games,
codes voided by a strike, atonement as the only way back, one win an hour, twelve attempts
an hour, no self-repeat, no echo, the surcharge charged visibly rather than silently, and
token rotation clearing discounts but never the monthly order cap.

## Limits

- 5 attempts per challenge, per machine; 12 graded attempts per hour per browser token
- 1 reward per hour per token, across all three games
- 2 orders per calendar month per email (`arcade_order_ledger`, counted against a hash)
- A game code and a patron price never stack: whichever is worth more is applied
- A discount can never take a charge below Stripe's 50-cent floor
- The paste surcharge is capped at +5% and always appears as its own cart line
