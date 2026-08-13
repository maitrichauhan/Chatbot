/* ============================================================================
   Cogent: intents
   Every string here follows the Vallejo UX writing guide: sentence case, active
   voice, second person, no hedging, no exclamation marks, no em dashes, en dash
   for ranges, numerals for money, lots, and counts.
   ========================================================================== */

window.COPART_KB = (function () {
  'use strict';

  /* ---- Linked destinations ------------------------------------------------
     Cogent links to a page when the member needs to *do* or *check* something
     there, never as a "read more" appendix to an answer it already gave. The
     Payments & logistics page carries Title status and Transport status per
     lot, which is why the status intents point at it.
     Swap `href` for the real member portal route. It is referenced in one place
     so no intent carries a URL of its own. */
  const PAGES = {
    paymentsLogistics: {
      label: 'Payments &amp; logistics',
      href: '/payments-logistics'
    },
    documents: {
      label: 'Documents &amp; forms',
      href: '/account/documents-forms'
    }
  };

  /* Prototype: links are inert. They keep their href so they stay real links to
     keyboard and screen-reader users, and chat.js swallows the click. No
     target="_blank" and no "opens in a new tab", because neither would be true. */
  function pageLink(page) {
    return '<a href="' + page.href + '">' + page.label + '</a>';
  }

  /* ---- Retrieval aliases --------------------------------------------------
     How members phrase a question rarely matches how the knowledge base titles
     it. "Why can't I bid" shares only the word "bid" with "How does bidding
     eligibility work?", which is not enough for scoring to find it among the
     dozens of other entries containing "bid".

     Each alias pins a phrasing to the entry that actually answers it. Kept
     small and deliberate: it covers the questions members phone in about, and
     everything else goes through retrieval on its own merits. */
  const ALIASES = [
    { phrases: ['why can\u2019t i bid', 'why cant i bid', 'unable to bid', 'cannot bid',
                'can\u2019t place a bid', 'cant place a bid', 'bidding is blocked',
                'not allowed to bid', 'why am i blocked'],
      entry: 'bid-eligibility-revised-how-does-bidding-eligibility-work' },

    { phrases: ['why was my payment rejected', 'payment rejected', 'payment declined',
                'payment failed', 'card declined', 'card was declined',
                'my payment didn\u2019t go through', 'my payment didnt go through'],
      entry: 'payment-rejections-overview' },

    { phrases: ['how do i renew my membership', 'renew my membership', 'membership renewal',
                'cancel my membership', 'upgrade my membership', 'buy a membership',
                'how much is membership', 'membership cost'],
      entry: 'membership-type-fees-overview' }
  ];

  /* What the wait is spent on, advanced while Cogent composes. Phrased as the
     activity rather than "Cogent is thinking": the member knows who they are
     talking to, and the useful part is what is happening to their question. */
  const THINKING = ['Thinking', 'Fetching your account', 'Checking records'];

  /* The empty state, shown before the member's first message rather than as an
     opening turn: an unanswered greeting bubble reads as a message that needs
     replying to, which is not what a blank conversation is. */
  /* The starter prompts are the reasons members phone Copart most, so the empty
     state opens on what they were most likely about to ask. Each one is phrased
     to match its intent exactly, since tapping a chip sends the label verbatim. */
  const GREETING = {
    title: 'Where should we start?',
    body: 'Ask about your account, bidding, payments, titles, or transport.',
    chips: [
      'Why can’t I bid?',
      'Where is my title?',
      'Where is my lot?',
      'Why was my payment rejected?',
      'How do I renew my membership?'
    ]
  };

  /* Fallback when nothing scores above the match threshold. */
  /* First miss: offer the topics Cogent does cover, with the agent as an out. */
  const FALLBACK = {
    body:
      '<p>I don’t have an answer for that one. Pick a topic below, or ask ' +
      'about registration, bidding, fees, payment, titles, or pickup.</p>',
    chips: [
      'How do I register?',
      'What fees will I pay?',
      'When is payment due?',
      'Talk to a live agent'
    ]
  };

  /* Second miss in a row, stop suggesting topics and lead with the handoff.
     Two failures is enough evidence that the member wants something Cogent
     does not hold, and making them ask for a person is where support chat
     earns its bad reputation. */
  const FALLBACK_REPEAT = {
    body:
      '<p>That’s still outside what I can answer.</p>',
    escalate: true,
    chips: []
  };

  /* ---- Live agent handoff -------------------------------------------------
     Member support hours are Monday–Friday, 6:00 AM–8:00 PM CT and Saturday,
     8:00 AM–5:00 PM CT. `hours` drives the availability check in chat.js, so
     the routing and the copy can never disagree. Sunday is absent = closed. */
  /* Who is speaking, and the one caveat that comes with them. The AI notice
     lives in the header subtitle rather than under the composer: it belongs
     next to the name it qualifies, not at the far end of the panel, and it
     swaps cleanly for the agent's role the moment a person takes over. One slot,
     one job, always answering "who am I talking to". */
  const ASSISTANT = {
    name: 'Cogent',
    subtitle: 'Cogent is AI and can make mistakes.'
  };

  const ESCALATION = {
    agent: { name: 'Maya', initials: 'M', team: 'Member support', role: 'Live agent' },

    timeZone: 'America/Chicago',
    hours: { 1: [6, 20], 2: [6, 20], 3: [6, 20], 4: [6, 20], 5: [6, 20], 6: [8, 17] },
    hoursLabel: 'Monday–Friday, 6:00 AM–8:00 PM CT and Saturday, 8:00 AM–5:00 PM CT',

    /* One noun for the people, and it is "live agent". The escalation matcher
       below already listens for "live agent", "talk to an agent" and "speak to
       an agent", because those are the phrases members actually type: the flow
       was recognising the member's word and then answering in a different one.
       Three nouns, three jobs, no overlap. "live agent" is the role and goes on
       every control and status line here. "member support" is the department and
       appears in sentences only, never on a button. The name is the person, and
       takes over once there is one. */

    /* Stating the wait up front is what makes the choice a real one. Nobody can
       decide between waiting and reading an article without knowing the cost.
       It stays on its own line in both states rather than moving onto the
       button: a number that moves is a number you have to find again. */
    waitLabel: 'Estimated wait: 1–2 min',

    /* The offer. Shown when the member asks for a person, or after a repeat miss.
       Buttons rather than chips: this is a commitment with a cost, not one more
       suggestion, and the pair carries the primary/secondary hierarchy that says
       which way we'd lean. The card states its own subject now, so the offer is
       no longer carried entirely by a button label. */
    offerTitle: 'Talk to a live agent',
    offerActions: [
      { label: 'Wait for live agent', action: 'connect', variant: 'btn-primary' },
      /* Was "Cancel", which cancelled nothing: the handler keeps asking Cogent.
         Beside "Wait for live agent" it read as leaving the conversation. */
      { label: 'Keep asking Cogent', action: 'dismiss', variant: 'btn-secondary' }
    ],

    connecting: 'Connecting you to a live agent',

    /* A heartbeat, not a progress bar. The wait is an estimate, so a bar that
       fills to the end and keeps waiting is a broken promise, which is worse
       than no promise. The wait line updates instead: same 14/20 line, same
       height, nothing reflows, and it claims nothing about progress. */
    stillWaiting: 'Still in the queue, thanks for waiting',
    cancelLabel: 'Cancel request',
    cancelled: 'Request cancelled',

    /* Reassurance the member's typing was not wasted, said by the product rather
       than claimed by the person they just met. It replaces the middle of the
       greeting, which is why the greeting below is one line shorter.

       It is also the opening bracket of the agent stretch, so there is no
       separate "started" note: this line already says a person joined, and a
       second centred line under it saying the same thing was just noise. Its
       closing half is `ended` below, matched on the name. */
    received: function (name) {
      return name + ' has joined and has received all the information you sent.';
    },

    greeting: function (name) {
      return '<p>Hi, I’m ' + name + ' from member support. What can I help you sort out?</p>';
    },

    /* Closed: routing has to send them somewhere that still works. */
    offline:
      '<p>Member support is closed right now. We’re open ' +
      'Monday–Friday, 6:00 AM–8:00 PM CT and Saturday, 8:00 AM–5:00 PM CT.</p>' +
      '<p>Raise a ticket and member support will reply when we open.</p>',
    offlineChips: ['Keep asking Cogent'],
    offlineLinks: [
      { label: 'Create a support ticket', href: '#main' },
      { label: 'Email member support', href: '#main' }
    ],

    /* No backend: the agent side is scripted. Replies cycle so a demo
       conversation does not repeat the same line twice in a row. */
    replies: [
      '<p>Thanks. Let me pull that up on your account.</p>',
      '<p>Understood. Can you give me the lot number so I can check the record?</p>',
      '<p>I’ve made a note of that. Give me a moment while I check with the yard.</p>',
      '<p>That one I can sort out for you. I’ll follow up by email once it’s done.</p>'
    ],

    /* The label on the header control. Not a chip: ending a chat is something
       you do to the session, not something you say to the person. */
    ended: function (name) { return 'Chat with ' + name + ' ended'; },
    endLabel: 'End chat'
  };

  /* Each intent scores against the member's message:
       phrases (6): a whole question stem, so near-unambiguous
       strong  (4): a token that identifies THIS intent and no other
       terms   (2): a token that is merely related to it
     The strong tier exists because topic nouns are shared across intents while
     intent verbs are not: "can I cancel a bid" carries both "cancel" and "bid",
     and without the split the two intents tie and array order decides. */
  /* ---- Control intents ----------------------------------------------------
     What the knowledge base cannot answer. Account status is about one member's
     lot, escalation is a flow rather than a fact, and the social turns are not
     questions. Everything topical is retrieved from the knowledge base instead,
     so there is one source for it and no second copy to drift.
     Matched before retrieval; see match() in chat.js. */
  const INTENTS = [
    {
      id: 'title-status',
      phrases: ['where is my title', 'wheres my title', 'where\u2019s my title',
                'my title status', 'title status', 'status of my title',
                'havent received my title', 'have not received my title',
                'when will my title arrive', 'track my title'],
      body:
        '<p>Give me your lot number and I\u2019ll look up the title status.</p>' +
        '<p>You can also check it yourself on ' + pageLink(PAGES.paymentsLogistics) +
        ', which lists title status for every lot you own.</p>',
      chips: ['When do I get the title?']
    },

    {
      id: 'lot-status',
      phrases: ['where is my lot', 'where is my vehicle', 'where is my car',
                'wheres my car', 'where\u2019s my car', 'my transport status',
                'transport status', 'delivery status', 'track my vehicle',
                'track my delivery', 'when will my vehicle arrive',
                'when will my car be delivered', 'has my car shipped'],
      body:
        '<p>Give me your lot number and I\u2019ll look up where it is.</p>' +
        '<p>You can also check it yourself on ' + pageLink(PAGES.paymentsLogistics) +
        ', which lists transport status and gate pass for every lot you own.</p>',
      chips: ['When can I pick up?', 'Can Copart ship it?']
    },

    {
      id: 'human',
      phrases: ['talk to a person', 'speak to someone', 'customer service', 'contact support',
                'real person', 'live agent', 'live chat', 'phone number', 'talk to an agent',
                'speak to an agent', 'connect me to', 'human being'],
      strong: ['agent', 'representative', 'support', 'phone', 'human', 'someone'],
      terms: ['rep', 'call', 'email', 'person', 'operator', 'advisor'],
      /* Handled by the escalation flow in chat.js, which renders the offer
         block directly. Asking for a person needs no reply restating that a
         person is available. */
      escalate: true,
      body: '',
      chips: []
    },

    {
      id: 'thanks',
      phrases: ['thank you', 'thanks', 'that helps', 'got it', 'appreciate it'],
      strong: ['thanks'],
      terms: ['thankyou', 'cheers', 'perfect'],
      body: '<p>Glad that helped. Ask any time. I’m here whenever you need a hand.</p>',
      chips: ['How does bidding work?', 'What fees will I pay?']
    },

    {
      id: 'greeting',
      phrases: ['hello', 'hi there', 'good morning', 'good afternoon', 'hey there'],
      strong: ['hello'],
      terms: ['hi', 'hey', 'yo'],
      body: '<p>Hi. Ask me about registration, bidding, fees, payment, titles, or pickup.</p>',
      chips: ['How do I register?', 'How does bidding work?', 'When is payment due?']
    }
  ];

  /* ---- Lot status ---------------------------------------------------------
     Title statuses and their explanations come from the Title status verbiage
     doc, which is the source of truth for both the displayed name and the info
     tooltip. `when` is the date the row carries; `note` is the tooltip, lightly
     rewritten into Vallejo's voice (active, "we" for Copart, "you" for the
     member) without changing what it says.

     Transport statuses still come from the Payments & logistics design, since
     the verbiage doc covers titles only. */
  const TITLE_STATUSES = [
    { label: 'Awaiting from seller',
      note: 'We\u2019re waiting for the title document from the seller. Processing takes 30 days from the sale date.' },
    { label: 'Awaiting from state',
      note: 'We\u2019re waiting for the title document from the state. Processing takes 30 days from the sale date.' },
    { label: 'Mail or pickup ready',
      note: 'We\u2019ve processed the title and it is ready to be mailed or collected.' },
    { label: 'Pickup ready',
      note: 'We\u2019ve processed the title and it is ready to collect.' },
    { label: 'Mail ordered', when: 'Aug 20',
      note: 'We\u2019ve processed the title and started the mailing process.' },
    { label: 'In transit to member', when: 'arriving Aug 21\u201323',
      note: 'We\u2019ve mailed the title and it is on its way to you.' },
    { label: 'Delivered to member', when: 'Aug 20',
      note: 'We\u2019ve delivered the title to you.' },
    { label: 'In transit to lender', when: 'arriving Aug 21\u201323',
      note: 'We\u2019ve mailed the title to your lender, since the lot is financed.' },
    { label: 'Delivered to lender', when: 'Aug 20',
      note: 'We\u2019ve delivered the title to your lender, since the lot is financed.' },
    { label: 'Picked up by member', when: 'Aug 20',
      note: 'You or an authorized representative collected the title from the sale yard.' },
    { label: 'Picked up by transporter', when: 'Aug 20',
      note: 'Your transporter collected the title from the sale yard.' },
    { label: 'Archived',
      note: 'The title was not collected within 30 days of the sale date. Contact us to request pickup.' },
    { label: 'Bill of sale only',
      note: 'This lot is not title-eligible, so it sells on a bill of sale.' }
  ];

  const TRANSPORT_STATUSES = [
    { label: 'Take action', when: 'delivery costs $100.34, or collect it yourself' },
    { label: 'Self pickup scheduled', when: 'for Sep 28, 2:00 PM CT' },
    { label: 'Self pickup complete', when: 'Sep 10' },
    { label: 'Transporter emailed', when: 'yet to be scheduled' },
    { label: 'Transporter scheduled', when: 'for Sep 8, 2:00 PM CT' },
    { label: 'Transporter arrived', when: 'Sep 6, 2:00 PM CT' },
    { label: 'Transporter complete', when: 'Sep 6' },
    { label: 'Delivery hold', when: 'awaiting payment' },
    { label: 'Delivery ordered' },
    { label: 'Delivery carrier assigned', when: 'arriving Aug 21\u201323' },
    { label: 'Delivery in transit', when: 'arriving Aug 21\u201323' },
    { label: 'Delivered', when: 'Aug 1' },
    { label: 'Unavailable', when: 'pickup from an offsite location' }
  ];

  /* Derived from the lot number rather than drawn at random, so asking about the
     same lot twice gives the same answer, the way a real lookup would. */
  function pickStatus(list, lot, salt) {
    let hash = 0;
    for (let i = 0; i < lot.length; i += 1) {
      hash = (hash * 31 + lot.charCodeAt(i)) >>> 0;
    }
    return list[(hash + salt) % list.length];
  }

  /* The status name is bold. Unmarked it dissolves into the sentence, and "the
     title status is Mail ordered, Aug 20" is a sentence you have to read twice
     to find the answer in. The explanation follows as its own line so the
     status itself stays scannable. */
  function statusLine(lot, term, status) {
    const link = '<a href="' + PAGES.paymentsLogistics.href + '">View details' +
      '<span class="sr-only"> for lot ' + lot + '</span></a>';

    const head = 'For lot #' + lot + ' the ' + term + ' is <strong>' + status.label +
      '</strong>' + (status.when ? ', ' + status.when : '') + '.';

    return status.note
      ? '<p>' + head + '</p><p>' + status.note + ' ' + link + '</p>'
      : '<p>' + head + ' ' + link + '</p>';
  }

  /* A bare lot number, sent in reply to "give me your lot number". `want` is
     whichever status the member originally asked about, so the answer addresses
     the question they actually posed; with no context, both are given. */
  const LOT_NUMBER = {
    pattern: /^[#\s]*(\d[\d\s-]{5,11}\d)[#\s]*$/,
    reply: function (lot, want) {
      return (want !== 'transport' ? statusLine(lot, 'title status', pickStatus(TITLE_STATUSES, lot, 0)) : '') +
             (want !== 'title' ? statusLine(lot, 'transport status', pickStatus(TRANSPORT_STATUSES, lot, 7)) : '');
    },
    chips: []
  };

  return { ALIASES, ASSISTANT, THINKING, GREETING, FALLBACK, FALLBACK_REPEAT, ESCALATION, LOT_NUMBER, INTENTS };
})();
