# Cogent: working notes

Claude Code loads this file automatically in any session opened in this repo. It exists so a
fresh chat can continue without re-deriving decisions or re-breaking settled rules.

Read `README.md` for how the thing is built. This file is what you would otherwise have to be
told: the standing rules, the reasoning behind the non-obvious choices, and what is still fake.

---

## What this is

A chat assistant called **Cogent**, in a Vallejo Shelf, on a static mock of the Copart help
centre. No build step for the app, no framework, no backend.

```bash
node dev-server.js     # http://localhost:4321
```

Live: **https://chatbot-puce-sigma-84.vercel.app**

---

## Standing rules

These came from the designer during the build. They override defaults, including Vallejo in
two places. Do not quietly revert them.

| Rule | Notes |
| --- | --- |
| **No em dashes anywhere** | Overrides Vallejo, which mandates them for joining clauses. Use a comma, colon, or full stop. En dashes in ranges (`1–2 min`, `Aug 21–23`) are fine and required. |
| **Nothing is 13px** | Everything that was Footnote is 12px/16. The 0.13 tracking went with it: it exists to open up 13px. Includes a local override of Vallejo's `.avatar-sm`. |
| **Links: blue, semibold, never underlined** | Applies to chat and host page. |
| **Links are inert** | Prototype: real `<a href>` for semantics and focus, but `chat.js` swallows the click. No `target="_blank"`, and no "opens in a new tab" text, because neither would be true. |
| **No handoff chip on an answered question** | "Talk to a live agent" appears only where Cogent has *not* answered: first miss, second miss, or an explicit ask. Check all intents if you add one. |
| **One noun for the people: "live agent"** | Every control and status line in the escalation flow. "member support" is the *department*, in sentences only, never on a button. A name is the *person*, once there is one. The matcher at `knowledge.js` keeps its "agent" phrases: members type them, so Cogent recognises them and never echoes them. |
| **Nothing on the blue wash is under 14px or below `--text-secondary`** | `--interactive-selected-wash` costs contrast: gray-600 on it is 5.22:1 against 5.75:1 on white, where gray-700 is 7.82:1. The tertiary step is not available on top of the wash. |
| **At most 3 suggestion chips at once** | `CHIP_LIMIT` in `chat.js` caps every source, so the greeting, the fallbacks and the KB chips are all held to it. Five wrapped onto four rows in the popup and read as a menu rather than a nudge. |
| **"End chat" is a header control, not a chip** | The chip row is for things the member could *say*; ending a session is not one. It lives in `.shelf-header`, secondary at SM, shown in agent mode only. |
| **Timestamps show the time only** | No "Cogent ·" / "You ·" prefix. Speaker goes in as `sr-only` text, since bubble shape and side do not reach a screen reader. |
| **Sentence case** | Kept even though the live Copart page uses Title Case. Vallejo mandates it. |

---

## Shape of the thing

**Two forms.** Popup is the desktop default: a 400×720 card above the launcher, **non-modal**
(no scrim, page not `inert`, not `aria-modal`, Tab can leave). That is the point of a popup and
the reason it carries no scrim. Below 600px it is overridden by a **bottom sheet** at 88dvh,
which is modal, has no handle and no drag. `applyModality()` in `chat.js` keeps the two
consistent, and now does nothing but read the breakpoint.

There used to be a third, an **expanded** 420px full-height Shelf panel behind a header toggle.
It is gone. Expand asked the member to manage a window instead of asking their question, it was
the only control that changed nothing about the conversation, and it carried the most complexity
in the component: toggling it moved focus trapping, `aria-modal`, the scrim and page inertness
underneath someone who only wanted more room. Removing it also freed the 40px the header needed
for "End chat". If long knowledge base answers ever feel cramped in the 400×720 popup, shorten
the answer rather than bringing the panel back.

**The escalation card is one element in two states.** `.chat-escalate` holds title, wait, and
actions, and `showQueue()` retitles it **in place** rather than swapping one node for another,
so waiting reads as a continuation of deciding. `morphEscalate()` animates the height by
measurement; `collapseEscalate()` collapses it into the note that replaces it, so neither exit
jumps the transcript. The wait line never moves between the two states: it is the fixed point
the rest of the card turns around. The waiting signal is the **typing dots**, not Vallejo's
spinner, because a 700ms spinner is a sub-ten-second affordance and the member has already
learned those dots mean a reply is coming.

**Answers come from the knowledge base**, not hand-written copy. `tools/build-kb.js` parses the
markdown into `js/kb-data.js`; `js/retrieval.js` scores against it. `INTENTS` in
`knowledge.js` holds only what the KB cannot answer: lot status, escalation, greeting, thanks.
Everything topical was deleted from it deliberately, so there is one source per answer.

**Escalation** offers rather than connects, always. The offer and the queue share one card by a
single CSS rule so they cannot drift apart. The queue is cancellable, because a wait you cannot
leave is a trap.

---

## What is fake

Say so when it comes up. Do not let these be mistaken for working features.

- **Lot status** is derived from a hash of the lot number. No lookup exists. Same lot gives the
  same answer, which is deliberate: a demo that contradicts itself on a retry is worse than none.
- **Document status** is the hardcoded list from the Documents & forms design.
- **The live agent** is scripted. No backend, no queue, no person. Replies cycle through four lines.
- **Every link** goes nowhere, on purpose.
- **`PAGES` hrefs** are placeholder routes. Real member portal URLs swap in one place.

## Open

- **KB answers are in the source's voice**, not Vallejo's. They carry internal vocabulary
  ("Decision Manager", "Cyber source"). Rewriting 189 answers is a content pass for someone with
  authority over the material; it cannot be done safely by paraphrase.
- **`licensing-documents`** states what two of three documents block, and deliberately does not
  guess at the third. There is a TODO at the point of use. An earlier version claimed a blanket
  bidding block, which was wrong: an unsigned power of attorney only stops the title being mailed.
- **`cannot-bid`** carries the same risk, listing "ID and licensing documents approved" as one
  prerequisite. If the real rules are more granular, it needs the same treatment.

---

## Deploying, keeping the same URL

The production alias **https://chatbot-puce-sigma-84.vercel.app** belongs to the Vercel project
`chatbot` under `maitrichauhann-8070s-projects`.

`.vercel/project.json` is what ties this directory to that project. If it is missing, a deploy
creates a *new* project and a *new* URL. Link it once:

```bash
npx vercel link --yes --project chatbot
```

Then redeploy to the same URL with:

```bash
npx vercel deploy --prod --yes --archive=tgz
```

`--prod` is required. Without it Vercel produces a throwaway preview URL instead.

**The deployment is public.** The knowledge base is readable by anyone with the link. Its own
header calls it customer-facing, but it carries internal detail. If that is not wanted, turn on
Settings → Deployment Protection → Vercel Authentication.

`.vercelignore` keeps `.claude/`, `tools/`, `dev-server.js`, and `README.md` out of the deploy.

---

## Rebuilding the knowledge base

```bash
node tools/build-kb.js ~/Downloads/knowledge-base.md
```

The parser strips what is written for the people maintaining the document rather than for
members: "Process purpose" and "Process scope" blocks, the author byline, and the topic title
echoed under its own heading. If a new source drops those conventions, check the output for
leakage before shipping: `grep -i "purpose of this document" js/kb-data.js` should be empty.
