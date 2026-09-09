/**
 * arcade/begScore.js — grading the Beggathon.
 *
 * One shot at up to 10% off the whole cart. The grader is deliberately mean: the old one
 * handed 6% to a plea with no reason in it, which made the game pointless. Most pleas
 * should come back with 1-3% and a line explaining exactly why.
 *
 * TWENTY-FIVE GATES run before anything is scored. Each one ends the run outright and
 * returns a reason plus a line of banter. They are ordered cheapest-first so a keyboard
 * mashing never reaches the expensive checks.
 *
 *   integrity   PASTED, DROPPED, SWIPED, NOT_TYPED, TOO_FEW_KEYS, MECHANICAL_TYPING,
 *               TOO_FAST, IMPOSSIBLE_WPM, RHYTHM_REPLAY
 *   shape       TOO_SHORT, TOO_LONG, TOO_FEW_WORDS, TOO_SLOW, NO_SENTENCE
 *   language    GIBBERISH, KEYBOARD_WALK, LOW_ENTROPY, CONSONANT_SOUP, NOT_ENGLISH
 *   substance   NO_ARGUMENT, WORD_SPAM, PHRASE_LOOP, ALL_CAPS, LINK_SPAM
 *   honesty     PROFANITY, SELF_REPEAT, ECHO
 *
 * Then four scored axes, weighted so an argument beats fast fingers, and curved so the
 * middle of the range is genuinely hard to reach:
 *   Grovel        (35%)  does it actually argue, about something in particular
 *   Originality   (30%)  fresh words, no clichés, unlike what others have written
 *   Legibility    (20%)  real words, spelled properly
 *   Haste         (15%)  how much of the minute was left
 */

const MIN_CHARS = 110;
const MAX_CHARS = 900;
const MIN_WORDS = 22;
const WINDOW_MS = 60000;
const MIN_PERCENT = 1;
const MAX_PERCENT = 10;
// Raw totals bunch up around 0.45-0.70, because spelling and legibility are near 1 for
// anybody writing English at all. So the raw score is stretched across that band before
// it is curved — otherwise every plea lands on the same four percent and the axes shown
// to the shopper explain a number that never moves.
const FLOOR = 0.30;           // below this is a 1%
const SPAN = 0.52;            // FLOOR + SPAN is the top of the scale
const CURVE = 1.5;            // and the last stretch still has to be earned

/** Enough common English to separate prose from mashing, and to check spelling. */
const COMMON = new Set(`the be to of and a in that have i it for not on with he as you do at this
but his by from they we say her she or an will my one all would there their what so up out if about
who get which go me when make can like time no just him know take people into year your good some
could them see other than then now look only come its over think also back after use two how our
work first well way even new want because any these give day most us is are was were been has had
did does am should must may might shall need dare ought am not don't cannot won't isn't it's that's
i'm i've you're we're they're there's here's let's didn't doesn't wouldn't couldn't shouldn't
buy bought buying price money cheap discount cost pay paid spend afford broke poor rich wallet cash
bottle bottles magnet magnets tote totes shirt shirts tee stamp stamps postage india indian tiger
everest railway railways aerial post postal philately collection design print printed steel
please deserve reason honest truth swear promise beg begging plead humble grateful thankful kindly
never always sometimes really very quite rather almost nearly enough more less much many few every
love hate want need wish hope dream fear worry care matter mean help save waste lose win earn keep
mother father sister brother friend daughter son wife husband dog cat house home rent bus train
job work boss office school student teacher nurse doctor driver shop street city town village
morning night today tomorrow yesterday week month year hour minute second birthday christmas gift
present anniversary wedding funeral holiday summer winter spring autumn rain sun cold warm
carry carried carrying broke broken cracked worn old new last first next final only same different
think thought remember forget forgot found lost gave given taken kept made makes making done
water drink bottle flask cup mug desk bag pocket hand hands eye eyes head heart soul mind
because since therefore however although though unless until while before after during between`
  .split(/\s+/).filter(Boolean));

const PROFANITY = new Set(`fuck fucks fucked fucking fuk fck shit shits shitty crap bullshit bitch
bitches bastard cunt dick cock prick wanker arse ass asshole arsehole bollocks bugger piss pissed
slut whore twat wank nigger faggot retard damn goddamn`.split(/\s+/).filter(Boolean));

const CLICHES = [
  "i deserve", "i really need", "please please", "i am broke", "i'm broke", "poor student",
  "starving", "pretty please", "give me", "i want it", "i need this", "just this once",
  "you won't regret", "trust me", "i promise", "best customer", "biggest fan", "love your",
  "make my day", "you will not regret", "pretty pretty", "as an ai", "i hope this finds you",
  "i am writing to", "kind regards", "first of all", "in conclusion", "furthermore",
  "i would be grateful", "it would mean the world", "from the bottom of my heart"
];

/** Rows and diagonals of a qwerty board. A run of these is a hand sliding, not writing. */
const WALKS = ["qwerty", "asdfgh", "zxcvbn", "ytrewq", "hgfdsa", "nbvcxz",
               "qazwsx", "edcrfv", "tgbyhn", "ujmik", "12345", "09876", "aaaa", "asdf", "jkl"];

const words = (t) => String(t).toLowerCase().match(/[a-z']+/g) || [];

/** Levenshtein distance, capped — used to forgive a typo but not a made-up word. */
function near(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...cur) > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Share of words that are real, and share that are real but misspelled. */
function legibility(w) {
  let known = 0, typo = 0;
  const dict = [...COMMON];
  for (const x of w) {
    if (COMMON.has(x)) { known += 1; continue; }
    if (x.length > 3 && dict.some((d) => Math.abs(d.length - x.length) <= 1 && near(x, d))) typo += 1;
  }
  return { known: known / w.length, typo: typo / w.length };
}

/** Shannon entropy per character. Real prose sits around 4; mashing and loops sit low. */
function entropy(text) {
  const t = text.toLowerCase().replace(/\s+/g, "");
  if (!t.length) return 0;
  const freq = {};
  for (const c of t) freq[c] = (freq[c] || 0) + 1;
  return -Object.values(freq).reduce((s, n) => {
    const p = n / t.length;
    return s + p * Math.log2(p);
  }, 0);
}

/** A fingerprint of the typing rhythm, so the same recorded run cannot be replayed. */
function rhythmPrint(gaps) {
  if (gaps.length < 12) return null;
  const bucket = gaps.map((g) => Math.min(9, Math.floor(g / 45))).join("");
  let h = 5381;
  for (const c of bucket) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return `${gaps.length}:${h.toString(36)}`;
}

/** Keystroke rhythm: a hand scatters, a script does not. */
function humanTyping(gaps) {
  if (gaps.length < 14) return { ok: false, reason: "TOO_FEW_KEYS" };
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  const cv = mean > 0 ? sd / mean : 0;
  if (cv < 0.34) return { ok: false, reason: "MECHANICAL_TYPING" };
  if (mean < 32) return { ok: false, reason: "TOO_FAST" };
  // Nobody types 100 identical gaps. A handful of exact repeats is normal; a third is not.
  const exact = new Map();
  for (const g of gaps) exact.set(g, (exact.get(g) || 0) + 1);
  if (Math.max(...exact.values()) / gaps.length > 0.34) return { ok: false, reason: "MECHANICAL_TYPING" };
  return { ok: true, cv, mean };
}

/** What the man says when he turns you down. Dry, not cruel. */
const BANTER = {
  PASTED:            "He watched you paste that. Somebody else's words, in your mouth, with your hand out.",
  DROPPED:           "You dragged a file at him. He is a man, not a printer.",
  SWIPED:            "Whole words arrived at once. Glide typing and dictation are not begging — he wants to watch you spell it.",
  NOT_TYPED:         "More text arrived than keys were pressed. He counted. He always counts.",
  TOO_FEW_KEYS:      "Fourteen keystrokes is not a plea, it is a cough.",
  MECHANICAL_TYPING: "Every keystroke the same distance apart. He has met metronomes with more soul.",
  TOO_FAST:          "Nobody types that fast and means it.",
  IMPOSSIBLE_WPM:    "That is a typing record, not an argument. He does not fund records.",
  RHYTHM_REPLAY:     "You have used those exact fingers, in that exact order, already.",
  TOO_SHORT:         "He has stood in the rain for longer than that took you.",
  TOO_LONG:          "That is a memoir. He asked for a reason.",
  TOO_FEW_WORDS:     "Fewer words than he has buttons on his coat.",
  TOO_SLOW:          "The minute went. So did he.",
  NO_SENTENCE:       "Not one full stop. He cannot tell where the asking ends and the wanting begins.",
  GIBBERISH:         "That is not a plea, that is a keyboard falling downstairs.",
  KEYBOARD_WALK:     "You slid your hand along the row. He saw the row.",
  LOW_ENTROPY:       "The same few letters, over and over. He can hear the loop from here.",
  CONSONANT_SOUP:    "No vowels worth speaking of. Try it out loud and see how you get on.",
  NOT_ENGLISH:       "He reads one language badly and that was not it.",
  NO_ARGUMENT:       "Wanting is not a reason. Everybody wants. He is asking why YOU.",
  WORD_SPAM:         "One word, again and again, as if repetition were rent.",
  PHRASE_LOOP:       "You said the same thing twice hoping it would count twice.",
  ALL_CAPS:          "Shouting. At a man with money. Bold strategy.",
  LINK_SPAM:         "A link. In a plea. He is not clicking that and neither is anyone else.",
  PROFANITY:         "You swore at the man you are asking for money. Nothing doing.",
  SELF_REPEAT:       "Word for word what you said last time. He has a memory and it is unkind.",
  ECHO:              "Somebody already begged him with those words. It did not work for them either."
};

/**
 * Grade one plea.
 *
 * @param {object} run   { text, gaps, durationMs, keystrokes, pasted, dropped }
 * @param {string[]} priorTexts  recent pleas from everybody, for the echo check
 * @param {object} history       { texts:string[], prints:string[] } this shopper's own past
 * @returns {{ok:true, percent:number, axes:object, verdict:string, print:string|null}
 *         | {ok:false, reason:string, message:string, gate:number}}
 */
function gradeBeg(run, priorTexts = [], history = {}) {
  let gate = 0;
  const fail = (reason) => ({ ok: false, reason, gate, message: BANTER[reason] || "No." });

  const text = String(run?.text || "").trim();
  const gaps = Array.isArray(run?.gaps) ? run.gaps.filter((g) => Number.isFinite(g) && g >= 0) : [];
  const duration = Number(run?.durationMs) || 0;
  const keystrokes = Number(run?.keystrokes) || 0;
  const lower = text.toLowerCase();
  const w = words(text);

  /* ── integrity ──────────────────────────────────────────────────────────── */
  gate = 1;  if (run?.pasted) return fail("PASTED");
  gate = 2;  if (run?.dropped) return fail("DROPPED");
  // Glide typing, autocomplete and dictation all deliver whole words with no keystrokes.
  // The arm does not move for them, so a swiper runs out of minute anyway — but they
  // deserve to be told why rather than left wondering.
  gate = 3;  if ((Number(run?.swipes) || 0) > 2) return fail("SWIPED");
  gate = 4;  if (text.length < MIN_CHARS) return fail("TOO_SHORT");
  gate = 5;  if (text.length > MAX_CHARS) return fail("TOO_LONG");
  gate = 6;  if (duration <= 0 || duration > WINDOW_MS + 2000) return fail("TOO_SLOW");
  gate = 7;  if (keystrokes < text.length * 0.95) return fail("NOT_TYPED");

  const human = humanTyping(gaps);
  gate = 8;  if (!human.ok) return fail(human.reason);

  const wpm = (text.length / 5) / (duration / 60000);
  gate = 9;  if (wpm > 145) return fail("IMPOSSIBLE_WPM");

  const print = rhythmPrint(gaps);
  gate = 10;  if (print && (history.prints || []).includes(print)) return fail("RHYTHM_REPLAY");

  /* ── shape ──────────────────────────────────────────────────────────────── */
  gate = 11; if (w.length < MIN_WORDS) return fail("TOO_FEW_WORDS");
  const sentences = (text.match(/[.!?]+/g) || []).length;
  gate = 12; if (sentences === 0) return fail("NO_SENTENCE");

  /* ── language ───────────────────────────────────────────────────────────── */
  gate = 13; if (WALKS.some((run_) => lower.includes(run_))) return fail("KEYBOARD_WALK");
  gate = 14; if (entropy(text) < 3.4) return fail("LOW_ENTROPY");

  const vowels = (lower.match(/[aeiou]/g) || []).length;
  const letters = (lower.match(/[a-z]/g) || []).length || 1;
  gate = 15; if (vowels / letters < 0.26) return fail("CONSONANT_SOUP");
  gate = 16; if (letters / Math.max(1, text.length) < 0.60) return fail("NOT_ENGLISH");

  // GIBBERISH is a test of whether the words are PRONOUNCEABLE, not whether they are in
  // our little dictionary. A four-hundred-word list does not know "signalman" or
  // "Darjeeling", and refusing an honest plea because it used a real word we had not
  // heard of is far worse than letting an inventive one through. The dictionary still
  // decides the legibility SCORE below; it just no longer decides who gets in.
  const wordlike = w.filter((x) =>
    /[aeiouy]/.test(x) && !/[^aeiouy']{5,}/.test(x) && x.length <= 20).length / w.length;
  gate = 17; if (wordlike < 0.75) return fail("GIBBERISH");

  const leg = legibility(w);

  /* ── substance ──────────────────────────────────────────────────────────── */
  const counts = new Map();
  for (const x of w) if (x.length > 2) counts.set(x, (counts.get(x) || 0) + 1);
  const topWord = counts.size ? Math.max(...counts.values()) / w.length : 0;
  gate = 18; if (topWord > 0.20) return fail("WORD_SPAM");

  const grams = new Map();
  for (let i = 0; i + 3 <= w.length; i++) {
    const g = w.slice(i, i + 3).join(" ");
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  gate = 19; if (grams.size && Math.max(...grams.values()) > 2) return fail("PHRASE_LOOP");

  const caps = (text.match(/[A-Z]/g) || []).length;
  gate = 20; if (letters > 40 && caps / letters > 0.55) return fail("ALL_CAPS");
  gate = 21; if (/https?:\/\/|www\.|\S+@\S+\.\w/.test(text)) return fail("LINK_SPAM");

  const reasons = (lower.match(/\b(because|since|so that|which is why|therefore|otherwise|given that|as i|after)\b/g) || []).length;
  const specifics = (lower.match(/\b(bottle|magnet|tote|shirt|stamp|postage|tiger|everest|railway|philately|kaayko)\b/g) || []).length;
  gate = 22; if (reasons === 0 && specifics === 0) return fail("NO_ARGUMENT");

  /* ── honesty ────────────────────────────────────────────────────────────── */
  gate = 23; if (w.some((x) => PROFANITY.has(x))) return fail("PROFANITY");
  gate = 24; if ((history.texts || []).some((t) => t.trim().toLowerCase() === lower)) return fail("SELF_REPEAT");

  // Only DISTINCTIVE words count. Everybody writing about this shop says "bottle",
  // "stamps" and "because"; sharing those is the subject, not the theft. Comparing all
  // words made two unrelated pleas about the same product look like copies.
  const distinct = (t) => new Set(words(t).filter((x) => x.length > 3 && !COMMON.has(x)));
  const mine = distinct(text);
  let echo = 0;
  for (const prior of priorTexts) {
    const theirs = distinct(prior);
    if (mine.size < 4 || theirs.size < 4) continue;
    let shared = 0;
    mine.forEach((x) => { if (theirs.has(x)) shared += 1; });
    echo = Math.max(echo, shared / mine.size);
  }
  gate = 25; if (echo > 0.75) return fail("ECHO");

  /* ── scoring, and it is not generous ────────────────────────────────────── */
  const haste = Math.max(0, Math.min(1, 1 - duration / WINDOW_MS));
  const legScore = Math.max(0, Math.min(1, leg.known + leg.typo * 0.4));

  const unique = new Set(w).size / w.length;
  const clicheHits = CLICHES.filter((c) => lower.includes(c)).length;
  const rare = w.filter((x) => !COMMON.has(x) && x.length > 4).length / w.length;
  const originality = Math.max(0, Math.min(1,
    unique * 0.45 + Math.min(rare, 0.3) * 1.2 - clicheHits * 0.22 - echo * 0.9));

  const numbers = (text.match(/\b\d+\b/g) || []).length;
  const grovel = Math.max(0, Math.min(1,
    Math.min(reasons, 3) * 0.16 +
    Math.min(specifics, 3) * 0.14 +
    Math.min(numbers, 2) * 0.05 +
    Math.min(sentences, 4) * 0.04 +
    (w.length >= 45 ? 0.16 : w.length / 280)));

  const total = grovel * 0.35 + originality * 0.30 + legScore * 0.20 + haste * 0.15;
  const scaled = Math.max(0, Math.min(1, (total - FLOOR) / SPAN));
  const curved = Math.pow(scaled, CURVE);
  const percent = Math.max(MIN_PERCENT, Math.min(MAX_PERCENT,
    Math.round(MIN_PERCENT + curved * (MAX_PERCENT - MIN_PERCENT))));

  const axes = {
    grovel: { score: +grovel.toFixed(2), weight: "35%",
      note: reasons ? `${reasons} actual reason${reasons > 1 ? "s" : ""} given` : "no reason given, only want" },
    originality: { score: +originality.toFixed(2), weight: "30%",
      note: clicheHits ? `${clicheHits} phrase${clicheHits > 1 ? "s" : ""} he has heard before` :
            echo > 0.5 ? "somebody else got here first" : "not heard before" },
    legibility: { score: +legScore.toFixed(2), weight: "20%",
      note: leg.typo > 0.08 ? "spelling went to pieces" : "spelled like a person who meant it" },
    haste: { score: +haste.toFixed(2), weight: "15%",
      note: `${(duration / 1000).toFixed(1)}s of the minute used` }
  };

  const verdict =
    percent >= 9 ? "He emptied a pocket. That has not happened before." :
    percent >= 7 ? "He was moved, and he is not easily moved." :
    percent >= 5 ? "He gave, but he looked at his watch." :
    percent >= 3 ? "He found a coin without looking down." :
                   "He gave you the smallest coin he had, to make you go away.";

  return { ok: true, percent, axes, verdict, print, words: w.length, seconds: +(duration / 1000).toFixed(1) };
}

module.exports = {
  gradeBeg, rhythmPrint,
  MIN_PERCENT, MAX_PERCENT, WINDOW_MS, MIN_CHARS, MIN_WORDS, PROFANITY, BANTER
};
