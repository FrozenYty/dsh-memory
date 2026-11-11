# 15. Recall is model-driven by default

Date: 2026-11-11

## Status

Accepted

## Context

Automatic recall injects an entry when a message matches it lexically. It was on by default from 0.1.0.

Measured on a real 29-entry notebook, in both directions at once:

| Query set | Result |
|---|---|
| On-topic questions, author-written (`test/qrels.json`) | 52/52, 0 false positives in 24 |
| New phrasings written from the situation | 6/18 |
| **Ordinary talk that shares vocabulary with the notebook** | **5/18 fired** |

The third row is the one that mattered. The 24 off-topic queries in `qrels.json` were written by the
same author as the triggers, and every one of them stayed silent; the hostile set — "证书考试过了",
"笔记本屏幕有点暗", "插件挺多的" — did not. A single Chinese word of two or more characters counts
two hits, a rule added so that `相机` could recall alone, and it lets `证书`, `笔记本`, `插件`, `配置`
and `索引` recall alone too.

Tuning the gate does not fix it. A threshold sweep:

```
score hits | recall | false positives
    4    2 |  6/18  |  5/18   <- current
    5    2 |  6/18  |  5/18
    6    2 |  2/18  |  1/18
    8    2 |  1/18  |  0/18
    4    3 |  1/18  |  0/18
```

There is no middle point. Correct recalls score 4–5, false positives score 4–5, and the cliff between
`score=5` and `score=6` costs four of six correct recalls to remove four of five false positives. The
scores cannot separate the two populations, because both are "one generic term plus one specific one".

Claude Code, read from its documentation, solves the same problem by not having it: `MEMORY.md` (first
200 lines or 25KB) is loaded every session, **topic files are never loaded at startup**, and the model
reads them with ordinary file tools when it decides to. There is no matcher, so there are no false
positives. Its index also carries one descriptive line per memory, which ours deliberately does not
([ADR 0002](02-filename-index-without-descriptions.md)).

## Decision

`recallEnabled` defaults to **false**. Automatic recall remains implemented and configurable; it is no
longer what happens unless asked for.

The index is what makes this safe rather than merely quiet. Its header already says:

> Each name is a trigger: if a name matches what you are about to do, read it with `memory_read`
> before acting. Do not guess an entry's content from its name.

So the recall path is `memory_read`, chosen by the model, against a list of every entry's name. That is
the same mechanism Claude Code uses, and it is available with no matcher at all.

## Consequences

- **A model that never reads the index recalls nothing.** The failure mode changes from "may inject
  something irrelevant" to "may not look". The first is visible in the transcript and costs tokens; the
  second is invisible and costs a repeated mistake. This is the accepted trade: silence is recoverable
  by reading, a wrong injection is not recoverable at all.
- **The index becomes the whole feature**, so its honesty and its budget matter more than before. Bare
  filenames are semantic (`usb-camera-arrival-facts`, `low-integrity-label-writes`), which is what the
  model has to judge by; [ADR 0002](02-filename-index-without-descriptions.md) already accepted that.
- **`memory_usage` becomes less meaningful as a quality signal.** It counts automatic publications, so
  a notebook used entirely through `memory_read` will show every entry as never used. The tool's
  description and the README must say so rather than implying dead entries.
- **The vocabulary still matters**, because it is what the model reads when it decides. Writing triggers
  in the words one complains in is now advice for the model's benefit, not the matcher's.
- Re-enable with `recallEnabled: true` per profile. Nothing else changes.
