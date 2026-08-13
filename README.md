# Cogent: chat in a Vallejo shelf

A chatbot that opens in a **Vallejo Shelf** when the member taps the chat launcher on the
Copart help center. No build step and no dependencies. Open `index.html` or run the dev server.

```bash
node dev-server.js
```

Then open <http://localhost:4321>.

## What's here

| Path | Purpose |
| --- | --- |
| `index.html` | Help center page, both launchers, the shelf, and the inlined icon sprite |
| `css/copart.css` | Host page chrome, header, hero, category cards, launcher |
| `css/chat-shelf.css` | The chat layer on top of Vallejo's Shelf |
| `js/chat.js` | Open/close, focus management, message flow, intent matching |
| `js/knowledge.js` | Control intents, escalation, lot status, retrieval aliases |
| `js/kb-data.js` | Generated. The knowledge base, parsed into entries |
| `js/retrieval.js` | Scores a message against the knowledge base |
| `js/page.js` | Drives the segmented control's sliding indicator |
| `tools/build-kb.js` | Builds `kb-data.js` from the knowledge base markdown |
| `vendor/` | Vallejo 1.2, `tokens.css`, `vallejo.css`, `icons.svg`, pulled from the demo |

## Entry points

Two controls open the same shelf, and their `aria-expanded` stays in sync:

- the **floating launcher**, bottom-right on every scroll position. It owns the unread pip
- **"Chat now"** in the Get support band, alongside "Create ticket"

Focus returns to whichever one was used. `openShelf(trigger)` takes the launcher explicitly
rather than reading `document.activeElement`, which is `<body>` whenever the button was
activated without first taking focus.

## Host page

The mock follows the live help center: a two-row header (blue utility bar with the inventory
search, then the black nav), a hero whose mode switch and keyword field read as one control,
six category cards, the Get support band, and the full footer. It is static: nothing is
wired up except the two chat entry points.

One deliberate difference: the live page sets headings and card titles in Title Case
("Most Popular Categories"). Vallejo mandates sentence case everywhere, so the mock uses it.

## Design system use

The shelf is Vallejo's own component, in its **Panel** form on desktop: right edge, 420px,
sticky header and footer, with `.shelf-body` as the only scroll region. `.shelf-scrolled` is
set from `chat.js` so the header and footer hairlines appear only once the conversation
overflows.

Below 600px it becomes a **bottom sheet**: anchored to the bottom edge, stopping at 88dvh so
the page still shows above the scrim, with the leading corners rounded to `--radius-2xl`. It
slides up from the edge the launcher sits on. Close is the only way out, with no handle and no
drag.

Chips, Textarea, Button, Avatar, and Icon Button are used as shipped. Everything else
resolves to a token: no raw hex outside the Copart brand marks in the page header.

Two deliberate departures, both commented at the point of use:

- **Message bubbles** have no Vallejo component, so they're built from tokens. Only the
  member's turns are enclosed, in `--surface-subtle`; Cogent's answers are bare text on the
  canvas, with no horizontal padding so they align with the header and composer.
- **Stacking**: Vallejo puts `--layer-scrim` (1400) above `--layer-drawer` (1300) because its
  sanctioned pattern nests the modal *inside* the scrim. A shelf is a sibling of the scrim,
  so it takes `--layer-modal` to sit above the dim.

## Empty state

Before the first message the body centres Vallejo's **Empty State**: icon, "Where should we
start?", and the starter chips, which are the reasons members phone Copart most. The surface
stays white throughout, so the shelf reads as one sheet from header to composer. There is no
opening greeting bubble: an unanswered greeting reads as a message that needs replying to,
which is not what a blank conversation is.

Timestamps show the time alone, with no "Cogent ·" / "You ·" prefix. Bubble shape and side
carry the speaker visually, but neither reaches a screen reader, so the name goes in as
visually hidden text inside the timestamp.

## Copy

All assistant copy follows the [Vallejo UX writing guide](https://vallejo-demo.vercel.app/ux-writing):
sentence case, active voice, second person, no hedging, no exclamation marks, en dash for
ranges, numerals for money and counts, 12-hour times with a timezone.

One deliberate override: Vallejo mandates the em dash to join clauses. This project uses none
at all, so those clauses are split or joined with a comma, colon, or full stop instead.

## Answering

Answers come from the knowledge base, not from hand-written copy. `tools/build-kb.js` parses
`knowledge-base.md` into `js/kb-data.js`, and `js/retrieval.js` scores the member's message
against it at runtime.

```bash
node tools/build-kb.js ~/Downloads/knowledge-base.md
```

**Parsing.** The source is written for retrieval: each `##` is a self-contained topic, and
FAQs inside it are a bold question line followed by its answer. One entry is one answerable
question, giving 189 FAQs plus 26 topic overviews. The build also strips what is written for
the people maintaining the document rather than for members: "Process purpose" and "Process
scope" blocks, the author byline, and the topic title echoed under its own heading.

**Formatting.** Chat is not a document, so the build fixes what the source does not care
about: run-together sentences are split, the recurring `Condition: / Meaning:` shape becomes
one bullet each, and answers are trimmed to whole blocks within a budget rather than cut
mid-sentence. Median answer is ~280 characters.

**Scoring.** TF-IDF across three fields, weighted `question` 6, `section` 3, `body` 1, because
where a word appears changes what it means. Two corrections matter:

| Factor | Why |
| --- | --- |
| Coverage | How much of the question an entry matches. Without it, "why was my payment rejected" landed on a bidding FAQ containing *reject* and nothing about payment |
| Kind | A specific FAQ outranks a topic overview: they asked a question, not for a briefing |

**Aliases** (`ALIASES` in `knowledge.js`) pin the phrasings members actually use to the entry
that answers them. "Why can't I bid" shares only the word *bid* with "How does bidding
eligibility work?", which is not enough for scoring to find it among the dozens of other
entries containing *bid*. Kept small and deliberate; everything else goes through retrieval on
its own merits.

The runners-up become follow-up chips, so a near-miss is one tap away. Questions longer than
46 characters do not become chips: Vallejo says rewrite rather than truncate, and these are
not ours to rewrite.

## Control intents

`INTENTS` in `knowledge.js` holds only what the knowledge base cannot answer, and is matched
before retrieval:

- `title-status` and `lot-status` — about one member's lot, not a general topic
- `human` — a flow, not a fact
- `greeting`, `thanks` — not questions

Everything topical was deleted from it when the knowledge base landed, so there is one source
for each answer and no second copy to drift.

## Linking

Cogent links to a page when the member needs to **check or do** something there, never as a
"read more" appendix to an answer it has already given. An article link under every answer
implies the answer was incomplete, which for most topics it isn't.

The case that earns a link is a status question about one specific vehicle: *where is my
title*, *where is my lot*. Cogent can't answer either without a lot number, so it asks for one
and points at the page that already holds the answer for every lot the member owns:

> Give me your lot number and I'll look up the title status.
> You can also check it yourself on **Payments & logistics**, which lists title status for
> every lot you own.

The `title-status` and `lot-status` intents sit above the general `title` and `shipping`
intents and lead on `phrases` (weight 6), so a possessive or status phrasing outscores the
general topic match (weight 4). "Where is my title" reaches the status intent; "when do I get
the title" still reaches the explainer.

A bare lot number sent in reply is matched before intent scoring, since digits alone score
nothing and would otherwise land in the generic miss.

Destinations live in `PAGES` in `knowledge.js` and are built by `pageLink()`, so no intent
carries a URL of its own. `href` is a placeholder route; swap it for the real member portal
URL in that one place. Links open in a new tab so the conversation survives the trip, with a
visually hidden "(opens in a new tab)" since the tab change is otherwise a surprise.

Links are blue and semibold, never underlined. The weight is what separates them from the
prose, so colour isn't carrying it alone.

### Lot status

Replying with a lot number returns a plain sentence:

> For lot #12345463 the title status is Awaiting from state, expected by Aug 20. **View details**

`TITLE_STATUSES` and `TRANSPORT_STATUSES` in `knowledge.js` hold the vocabulary from the
Payments & logistics design. Each entry is a label plus an optional `detail` written as a
sentence continuation, so the answer reads as one line rather than a table squeezed into a
chat bubble. "View details" links to the page in a new tab.

Which status shows depends on what was asked. `pendingLookup` records whether the member asked
about the title or the lot, so "where is my title" then a lot number returns the title line
alone. A number with no preceding question returns both.

The status is derived from a hash of the lot number rather than drawn at random, so asking
about the same lot twice gives the same answer, the way a real lookup would. Without that a
demo would contradict itself on a retry.

**The status is fabricated.** There is no backend and no lookup: the number selects an entry
from the vocabulary above. It demonstrates the shape of the answer, not a real one.

## Live agent handoff

Cogent routes to a person on two triggers:

- **The member asks.** The `human` intent is marked `escalate: true`, so it offers the handoff
  instead of answering. It catches "talk to a human", "customer support", "live agent",
  "connect me to someone", and similar.
- **Cogent misses twice in a row.** The first miss offers topics with an agent chip as an out;
  a second consecutive miss leads with the handoff. A matched answer resets the streak.

It always *offers* rather than connecting outright. A member who wanted the phone number
shouldn't land in a queue. From there:

The offer is a **Button pair** rather than chips. The choice commits the member to a wait, so
it carries primary/secondary hierarchy instead of reading as one more suggestion. The estimate
("Estimated wait: 1–2 min") ships with the offer, because choosing between waiting and reading
an article isn't a choice you can make without knowing what waiting costs.

| State | What happens |
| --- | --- |
| In hours | `queued` → queue panel with the wait and **Cancel request** → agent joins → header, avatar, and placeholder swap |
| Closed | Ticket and email links, plus the hours, and the chat stays with Cogent |
| `agent` | Cogent stays silent; replies come from the scripted agent, chips reduce to "End chat" |

The queue panel is cancellable and the composer stays live while queued. A wait you can't
leave is a trap, and someone waiting on an agent may still want Cogent to answer something
else meanwhile. Cancelling clears the join timer, so no agent arrives afterwards.

A matched pair of notes brackets the agent portion of the transcript: "Chat with live agent
Maya started" and "…ended". Scrollback then shows plainly where a person took over and left.

Voice escalation lives on the page, not in the shelf: the Get support band carries the number
with a copy control, and the closed-hours reply offers a ticket and email.

Availability comes from `ESCALATION.hours`, read in the support team's own timezone
(`America/Chicago`) so it can't drift with the member's clock, and re-checked at the moment
of connecting in case the shelf sat open. The same table drives the copy, so the routing and
the stated hours can never disagree.

The mode is persisted, so reloading mid-handoff doesn't strand agent turns under Cogent's
header. Status notes ("Maya joined the chat") sit outside the transcript, since they are not
turns in it.

**The agent side is scripted.** There is no backend, no queue, and no real person; replies
cycle through four canned lines.

## Accessibility

- The shelf is `role="dialog" aria-modal="true"`; the page behind it is `inert` while open.
- Focus moves into the shelf on open and returns to the launcher on close. Tab is trapped.
- Escape closes, as do Close and a click on the scrim.
- The transcript is a `role="log" aria-live="polite"` region, so new turns are announced.
- The typing indicator carries a visually hidden "Cogent is typing".
- `prefers-reduced-motion` drops the slide, the message entrance, and smooth scrolling, and
  slows the typing pulse.

## Notes

The transcript persists in `sessionStorage` for the tab's lifetime. Cogent is a local keyword
matcher with canned answers: there is no backend.

**The answer copy is not sourced from copart.com/help.** It was written from general auction
knowledge in the Vallejo voice, so the fee, deposit, and deadline figures are illustrative
rather than authoritative and need replacing with the real help centre content before this
goes in front of anyone.
