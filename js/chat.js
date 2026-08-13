/* ============================================================================
   Cogent: shelf behavior
   Open/close, focus management, message flow, and intent matching. Depends on
   window.COPART_KB (js/knowledge.js).
   ========================================================================== */

(function () {
  'use strict';

  const KB = window.COPART_KB;
  const LOOKUP = window.COPART_RETRIEVAL;

  /* Long knowledge base questions make unusable chips, and Vallejo says rewrite
     rather than truncate. These are not ours to rewrite, so the overlong ones
     simply do not become chips. */
  const CHIP_MAX = 46;

  /* Two entry points open the same shelf: the floating launcher, and "Chat now"
     in the Get support band. The floating one is primary: it owns the unread
     pip, and focus returns to whichever was actually used. */
  const launcher    = document.getElementById('chat-launcher');
  const launchers   = Array.prototype.slice.call(
    document.querySelectorAll('#chat-launcher, #chat-launcher-inline')
  );
  const shelf       = document.getElementById('chat-shelf');
  const scrim       = document.getElementById('chat-scrim');
  const closeBtn    = document.getElementById('chat-close');
  const endBtn      = document.getElementById('chat-end');
  const confirm     = document.getElementById('chat-confirm');
  const confirmCard = confirm.querySelector('.chat-confirm-card');
  const confirmNo   = document.getElementById('chat-confirm-cancel');
  const confirmYes  = document.getElementById('chat-confirm-end');
  const body        = document.getElementById('chat-body');
  const log         = document.getElementById('chat-log');
  const suggestions = document.getElementById('chat-suggestions');
  const empty       = document.getElementById('chat-empty');
  const emptyTitle  = document.getElementById('chat-empty-title');
  const emptyBody   = document.getElementById('chat-empty-body');
  const form        = document.getElementById('chat-form');
  const input       = document.getElementById('chat-input');
  const sendBtn     = document.getElementById('chat-send');
  const daystamp    = document.getElementById('chat-daystamp');
  const shelfTitle  = document.getElementById('chat-shelf-title');
  const subtitle    = document.getElementById('chat-subtitle');
  const avatar      = document.querySelector('.chat-avatar');

  const backdropRegions = [
    document.querySelector('.cp-header'),
    document.getElementById('main')
  ].filter(Boolean);

  /* The shelf's own three regions, inerted behind the end-chat confirmation. */
  const shelfPanes = Array.prototype.slice.call(
    shelf.querySelectorAll('.shelf-header, .shelf-body, .shelf-footer')
  );

  const STORAGE_KEY = 'copart-assistant-transcript';
  const MODE_KEY = 'copart-assistant-mode';
  const CHIPS_KEY = 'copart-assistant-chips';
  const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let isOpen = false;
  let lastFocused = null;
  let pendingReply = null;
  let queueHeartbeat = null;
  let confirmOpen = false;

  /* Modes: 'bot' is Cogent answering, 'queued' is waiting for an agent, and
     'agent' means a person is on the line. Escalation only ever moves bot -> queued -> agent,
     and ending the chat returns to bot. */
  let mode = 'bot';
  let missStreak = 0;
  let replyIndex = 0;

  /* Which status Cogent last asked for a lot number about, so the reply answers
     the question the member actually posed rather than dumping both. */
  let pendingLookup = null;

  /* Interval that advances the thinking label while a reply composes. */
  let thinkingTimer = null;

  /* Two forms. A non-modal popup on desktop, a modal sheet below 600px. The
     expanded Shelf panel is gone: see the note in chat-shelf.css. */

  /* The sheet is modal whatever the desktop form says. */
  const sheetForm = window.matchMedia('(max-width: 599px)');

  function isModal() {
    return sheetForm.matches;
  }

  /* --- Time ---------------------------------------------------------------- */

  /* 12-hour clock with a timezone, per the Vallejo writing guide. */
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  function stampNow() {
    return timeFormat.format(new Date());
  }

  function dayLabel() {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date());
  }

  /* --- Transcript state ---------------------------------------------------- */

  /* Each entry: { role: 'bot' | 'member' | 'agent', html, time }. The current
     chips are persisted alongside it, under CHIPS_KEY. */
  let transcript = [];

  function loadTranscript() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveTranscript() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(transcript));
    } catch (err) {
      /* Storage is a convenience: a full or blocked store must not break chat. */
    }
  }

  /* --- Rendering ----------------------------------------------------------- */

  function renderMessage(entry) {
    const li = document.createElement('li');
    li.className = 'chat-msg chat-msg-' + entry.role;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = entry.html;
    li.appendChild(bubble);

    if (Array.isArray(entry.links) && entry.links.length) {
      const list = document.createElement('ul');
      list.className = 'chat-links';
      entry.links.forEach(function (link) {
        const item = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.className = 'chat-link';
        anchor.href = link.href;
        anchor.textContent = link.label;
        item.appendChild(anchor);
        list.appendChild(item);
      });
      bubble.appendChild(list);
    }

    /* Only the time shows. Bubble shape and side carry the speaker visually, but
       neither reaches a screen reader, so the name goes in as hidden text. */
    const meta = document.createElement('p');
    meta.className = 'chat-meta';
    const who = document.createElement('span');
    who.className = 'sr-only';
    who.textContent = entry.role === 'member' ? 'You, '
      : entry.role === 'agent' ? KB.ESCALATION.agent.name + ', '
      : 'Cogent, ';
    meta.appendChild(who);
    meta.appendChild(document.createTextNode(entry.time));
    li.appendChild(meta);

    log.appendChild(li);
    return li;
  }

  function addMessage(role, html, links) {
    const entry = { role: role, html: html, time: stampNow(), links: links || null };
    transcript.push(entry);
    saveTranscript();
    renderMessage(entry);
    setEmpty(false);
    scrollToLatest();
  }

  /* The blank conversation sits on the gray canvas; the body flips to white the
     moment there is a transcript to read. */
  function setEmpty(isEmpty) {
    body.classList.toggle('is-empty', isEmpty);
    empty.hidden = !isEmpty;
    daystamp.hidden = isEmpty;
  }

  function showTyping() {
    const li = document.createElement('li');
    li.className = 'chat-msg chat-msg-bot chat-typing';
    li.id = 'chat-typing';
    li.innerHTML =
      '<div class="chat-bubble">' +
      '<span class="chat-typing-label">' + KB.THINKING[0] + '</span>' +
      '<span class="chat-typing-dot"></span>' +
      '<span class="chat-typing-dot"></span>' +
      '<span class="chat-typing-dot"></span>' +
      '</div>';
    li.setAttribute('role', 'status');
    log.appendChild(li);
    scrollToLatest();

    /* Walk the phases while the reply composes. A short answer lands on the
       first one and never advances, which is correct: it did not take longer. */
    const label = li.querySelector('.chat-typing-label');
    let phase = 0;
    window.clearInterval(thinkingTimer);
    thinkingTimer = window.setInterval(function () {
      phase += 1;
      if (phase >= KB.THINKING.length) {
        window.clearInterval(thinkingTimer);
        return;
      }
      label.textContent = KB.THINKING[phase];
    }, 450);
  }

  function hideTyping() {
    window.clearInterval(thinkingTimer);
    const el = document.getElementById('chat-typing');
    if (el) el.remove();
  }

  /* Two frames: the first lets the appended node lay out, the second scrolls
     against the settled height. Easing lives in CSS (scroll-behavior), because a
     scrollTo({behavior:'smooth'}) animation started while the typing indicator
     is being swapped out targets a height that no longer exists and stops short. */
  function scrollToLatest() {
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        body.scrollTop = body.scrollHeight;
        updateScrollState();
      });
    });
  }

  /* Vallejo's .shelf-scrolled boolean: reveals the hairline under the header
     and above the footer once the body has content to scroll. */
  function updateScrollState() {
    const overflows = body.scrollHeight - body.clientHeight > 1;
    shelf.classList.toggle('shelf-scrolled', overflows);
  }

  /* --- Suggestion chips ---------------------------------------------------- */

  /* Three at a time, whatever the source offers. Five starter prompts wrapped
     onto four rows in the 400px popup, which stops being a row of suggestions
     and starts being a menu the member has to read before they can type. Three
     fits two rows at the widest, and a suggestion the member has to scan past
     is not helping them ask their question.
     Capped here rather than at each source, so the greeting, the fallbacks and
     the knowledge base chips are all held to it without any of them having to
     remember. */
  const CHIP_LIMIT = 3;

  function setSuggestions(labels) {
    suggestions.textContent = '';
    suggestions.classList.remove('chat-actions');

    const shown = labels ? labels.slice(0, CHIP_LIMIT) : labels;

    /* Saved with the transcript. Reload used to re-derive these by matching the
       last bot turn against every intent body, which fails for any generated
       answer (a lot status is not a fixed string) and fell through to the
       fallback chips, putting the handoff under an answered question. */
    try {
      sessionStorage.setItem(CHIPS_KEY, JSON.stringify(shown || []));
    } catch (err) {
      /* Storage is a convenience: see saveTranscript. */
    }

    if (!shown || !shown.length) {
      suggestions.hidden = true;
      return;
    }

    shown.forEach(function (label) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = label;
      chip.addEventListener('click', function () {
        submitMessage(label, true);
      });
      suggestions.appendChild(chip);
    });

    suggestions.hidden = false;
  }

  /* --- Intent matching ----------------------------------------------------- */

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[’']/g, '’')
      .replace(/[^a-z0-9’\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const WEIGHT = { phrases: 6, strong: 4, terms: 2 };

  function scoreIntent(intent, text, tokens) {
    let score = 0;

    (intent.phrases || []).forEach(function (phrase) {
      if (text.indexOf(normalize(phrase)) !== -1) score += WEIGHT.phrases;
    });

    ['strong', 'terms'].forEach(function (tier) {
      (intent[tier] || []).forEach(function (term) {
        if (tokens.indexOf(normalize(term)) !== -1) score += WEIGHT[tier];
      });
    });

    return score;
  }

  function match(message) {
    const text = normalize(message);
    const tokens = text.split(' ');

    let best = null;
    let bestScore = 0;

    KB.INTENTS.forEach(function (intent) {
      const score = scoreIntent(intent, text, tokens);
      if (score > bestScore) {
        bestScore = score;
        best = intent;
      }
    });

    /* Two weak token hits are not an answer, fall back rather than guess. */
    return bestScore >= 2 ? best : null;
  }

  /* --- Conversation flow --------------------------------------------------- */

  /* Chips that do something rather than say something. Keyed by label, and only
     honoured when the click came from a chip, typing the same words is a
     message, and echoing it is what the member expects to see.
     "End chat" used to live here. It is a session control rather than a thing to
     say, and every other chip in that row is a sentence the member could utter,
     so it moved to the header. */
  function chipAction(label) {
    const E = KB.ESCALATION;
    if (label === E.offlineChips[0]) return keepAsking;
    return null;
  }

  function keepAsking() {
    mode = 'bot';
    missStreak = 0;
    setSuggestions(KB.GREETING.chips);
  }

  function submitMessage(raw, fromChip) {
    const message = String(raw || '').trim();
    if (!message) return;

    /* Typing past an unanswered offer is an answer to it: they chose neither.
       Not while queued, though: the composer stays live during the wait on
       purpose, and a question asked while waiting must not silently cancel the
       request the member is waiting on. Only the cancel button does that. */
    if (mode !== 'queued') clearEscalate();

    /* An action chip performs its action instead of posting as a turn, "End
       chat" is not something the member said. */
    const action = fromChip && chipAction(message);
    if (action) {
      setSuggestions(null);
      resetComposer();
      action();
      return;
    }

    addMessage('member', escapeToParagraph(message));
    setSuggestions(null);
    resetComposer();
    reply(message);
  }

  /* A short pause reads as considered rather than canned. */
  function thinkingDelay(message) {
    return reducedMotion.matches ? 0 : 420 + Math.min(message.length * 12, 480);
  }

  /* Runs a turn as `role` after a typing pause. */
  function respond(role, delay, build) {
    window.clearTimeout(pendingReply);
    showTyping();
    pendingReply = window.setTimeout(function () {
      hideTyping();
      build(role);
    }, delay);
  }

  function reply(message) {
    /* A person is on the line, Cogent stays out of the way. */
    if (mode === 'agent') {
      const line = KB.ESCALATION.replies[replyIndex % KB.ESCALATION.replies.length];
      replyIndex += 1;
      respond('agent', thinkingDelay(message), function (role) {
        addMessage(role, line);
      });
      return;
    }

    /* A bare lot number is an answer to Cogent's own question, so it is checked
       before intent matching. Digits alone score nothing against any intent and
       would otherwise land in the generic miss. */
    const lot = message.match(KB.LOT_NUMBER.pattern);
    if (lot) {
      missStreak = 0;
      const number = lot[1].replace(/[\s-]/g, '');
      const want = pendingLookup;
      pendingLookup = null;
      respond('bot', thinkingDelay(message), function (role) {
        addMessage(role, KB.LOT_NUMBER.reply(number, want));
        setSuggestions(KB.LOT_NUMBER.chips);
      });
      return;
    }

    const intent = match(message);

    /* Explicitly asked for a person, offer the handoff, don't answer. */
    if (intent && intent.escalate) {
      missStreak = 0;
      respond('bot', thinkingDelay(message), function () {
        offerAgent(null);
      });
      return;
    }

    if (intent) {
      missStreak = 0;
      pendingLookup = intent.id === 'title-status' ? 'title'
        : intent.id === 'lot-status' ? 'transport'
        : null;

      respond('bot', thinkingDelay(message), function (role) {
        addMessage(role, intent.body, intent.links);
        setSuggestions(intent.chips);
      });
      return;
    }

    /* Nothing in the control set, so ask the knowledge base. */
    const found = LOOKUP && LOOKUP.answer(message);
    if (found) {
      missStreak = 0;
      pendingLookup = null;
      respond('bot', thinkingDelay(message), function (role) {
        addMessage(role, found.entry.html);
        setSuggestions(found.related
          .map(function (e) { return e.question; })
          .filter(function (q) { return q.length <= CHIP_MAX; }));
      });
      return;
    }

    /* Missed. The first miss offers topics; a second in a row leads with the
       handoff rather than making the member ask for it. */
    missStreak += 1;
    const miss = missStreak >= 2 ? KB.FALLBACK_REPEAT : KB.FALLBACK;

    respond('bot', thinkingDelay(message), function (role) {
      if (miss.escalate) {
        offerAgent(miss.body);
      } else {
        addMessage(role, miss.body, miss.links);
        setSuggestions(miss.chips);
      }
    });
  }

  /* --- Live agent handoff --------------------------------------------------- */

  /* True inside member support hours, read in the support team's own timezone
     so it does not drift with the member's clock. */
  function agentAvailable() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: KB.ESCALATION.timeZone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false
    }).formatToParts(new Date());

    const dayNames = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayNames[parts.find(function (p) { return p.type === 'weekday'; }).value];
    const hour = Number(parts.find(function (p) { return p.type === 'hour'; }).value) % 24;

    const window_ = KB.ESCALATION.hours[day];
    return Boolean(window_) && hour >= window_[0] && hour < window_[1];
  }

  /* The offer: never connect without asking, so a member who only wanted the
     phone number is not dropped into a queue. The wait comes with the offer:
     a choice between waiting and reading an article isn't one you can make
     without knowing what waiting costs. */
  function offerAgent(body) {
    if (!agentAvailable()) {
      addMessage('bot', KB.ESCALATION.offline, KB.ESCALATION.offlineLinks);
      setSuggestions(KB.ESCALATION.offlineChips);
      return;
    }

    /* An explanation only when there is something to explain, which is the
       repeat-miss path. Asking for a person needs no reply saying an agent can
       help: the offer itself says that, and a sentence restating it just pushes
       the decision down the screen. */
    if (body) addMessage('bot', body);

    setSuggestions(null);
    renderOffer();
  }

  /* The decision, rendered in the transcript rather than as a turn: the offer,
     the wait and the two buttons, centred, with no timestamp. It is not
     something anyone said, so stamping it invites the member to read it as
     another message instead of as the choice it is.

     One element for both states. Deciding and waiting are the same card in the
     same three slots, and the card is retitled in place rather than removed and
     rebuilt, so the second state can be seen to be a continuation of the first.
     `role="status"` is set here, on an empty node, and the node is in the
     document before any of its content changes: a live region filled before it
     is attached is never announced. */
  function renderOffer() {
    clearEscalate();

    const block = document.createElement('li');
    block.className = 'chat-escalate';
    block.id = 'chat-escalate';
    block.setAttribute('role', 'status');
    log.appendChild(block);

    const title = document.createElement('p');
    title.className = 'chat-escalate-title';
    title.id = 'chat-escalate-title';
    title.textContent = KB.ESCALATION.offerTitle;

    const wait = document.createElement('p');
    wait.className = 'chat-escalate-wait';
    wait.id = 'chat-escalate-wait';
    wait.textContent = KB.ESCALATION.waitLabel;

    const row = document.createElement('div');
    row.className = 'chat-escalate-actions';
    row.id = 'chat-escalate-actions';

    KB.ESCALATION.offerActions.forEach(function (spec) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + spec.variant + ' btn-md';
      btn.type = 'button';
      btn.dataset.action = spec.action;
      btn.textContent = spec.label;
      btn.addEventListener('click', function () {
        if (spec.action === 'connect') connectAgent();
        else {
          clearEscalate();
          keepAsking();
        }
      });
      row.appendChild(btn);
    });

    block.appendChild(title);
    block.appendChild(wait);
    block.appendChild(row);
    setEmpty(false);
    scrollToLatest();
  }

  function clearEscalate() {
    const block = document.getElementById('chat-escalate');
    if (block) block.remove();
  }

  /* Height by measurement: read, mutate, read, animate the difference. The card
     is the same node throughout, so the only thing that has to be animated is
     the gap between what it was and what it became. */
  function morphEscalate(mutate) {
    const card = document.getElementById('chat-escalate');
    if (!card) {
      mutate();
      return;
    }
    if (reducedMotion.matches || !card.animate) {
      mutate();
      return;
    }

    const from = card.getBoundingClientRect().height;
    mutate();
    const to = card.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;

    card.classList.add('is-morphing');
    const anim = card.animate(
      [{ height: from + 'px' }, { height: to + 'px' }],
      { duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
    );
    anim.finished
      .then(function () { card.classList.remove('is-morphing'); })
      .catch(function () { card.classList.remove('is-morphing'); });
  }

  /* Collapse the card into the note that replaces it, rather than removing it
     and appending the note somewhere else. Both exits used to jump the
     transcript by the card's full height; on arrival that mattered most,
     because the note is the payoff for the wait, and a payoff that appears
     somewhere other than where you were looking is not one. */
  function collapseEscalate(done) {
    const card = document.getElementById('chat-escalate');
    if (!card) {
      done();
      return;
    }
    card.removeAttribute('id');
    if (reducedMotion.matches || !card.animate) {
      card.remove();
      done();
      return;
    }

    const height = card.getBoundingClientRect().height;
    card.classList.add('is-morphing');
    const anim = card.animate(
      [
        { height: height + 'px', opacity: 1, marginBottom: '0px' },
        { height: '0px', opacity: 0, marginBottom: 'calc(var(--space-4) * -1)' }
      ],
      { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)' }
    );
    const finish = function () {
      card.remove();
      done();
    };
    anim.finished.then(finish).catch(finish);
  }

  function connectAgent() {
    /* Re-check at the moment of connecting, the shelf may have sat open. */
    if (!agentAvailable()) {
      addMessage('bot', KB.ESCALATION.offline, KB.ESCALATION.offlineLinks);
      setSuggestions(KB.ESCALATION.offlineChips);
      return;
    }

    mode = 'queued';
    setSuggestions(null);
    showQueue();

    /* Reassurance once the wait stops feeling brief. Real threshold, so under
       the scripted 2.6s handoff below it never fires: lengthen that wait to see
       it. Kept even under reduced motion, because this one is information
       rather than decoration. */
    window.clearTimeout(queueHeartbeat);
    queueHeartbeat = window.setTimeout(function () {
      const line = document.getElementById('chat-escalate-wait');
      if (line) line.textContent = KB.ESCALATION.stillWaiting;
    }, 45000);

    const wait = reducedMotion.matches ? 400 : 2600;
    window.clearTimeout(pendingReply);
    pendingReply = window.setTimeout(function () {
      mode = 'agent';
      replyIndex = 0;
      setAgentChrome(true);
      /* The card collapses into the line that replaces it, so the receipt lands
         where the member was already looking. */
      window.clearTimeout(queueHeartbeat);
      collapseEscalate(function () {
        addNote(KB.ESCALATION.received(KB.ESCALATION.agent.name));
        addMessage('agent', KB.ESCALATION.greeting(KB.ESCALATION.agent.name));
      });
      /* The exit lives in the header now, so the chip row is free to keep
         suggesting things during the agent chat. */
      setSuggestions(null);
    }, wait);
  }

  /* Waiting is the same card, retitled. A wait you cannot leave is a trap, so it
     keeps a cancel, and the composer stays live, because a member waiting on a
     live agent may still want Cogent to answer something else in the meantime. */
  function showQueue() {
    const card = document.getElementById('chat-escalate');
    if (!card) return;

    const title = document.getElementById('chat-escalate-title');
    const row = document.getElementById('chat-escalate-actions');
    const taken = row.querySelector('[data-action="connect"]');

    /* Collapse the taken action's width instead of removing it outright: the row
       should close the gap rather than jump. */
    if (taken && taken.animate && !reducedMotion.matches) {
      const width = taken.getBoundingClientRect().width;
      taken.style.overflow = 'hidden';
      taken.animate(
        [
          { width: width + 'px', opacity: 1, paddingLeft: '16px', paddingRight: '16px' },
          { width: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px' }
        ],
        { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
      ).finished.then(function () { taken.remove(); }).catch(function () { taken.remove(); });
    } else if (taken) {
      taken.remove();
    }

    morphEscalate(function () {
      card.classList.add('is-waiting');
      title.textContent = '';
      const dots = document.createElement('span');
      dots.className = 'chat-escalate-dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.innerHTML = '<span></span><span></span><span></span>';
      title.appendChild(dots);
      title.appendChild(document.createTextNode(KB.ESCALATION.connecting));

      const decline = row.querySelector('[data-action="dismiss"]');
      if (decline) {
        decline.textContent = KB.ESCALATION.cancelLabel;
        /* Stays MD. It is the same button in the same card, so it keeps the same
           height, radius and type: a control that resizes mid-morph reads as a
           new control, which is the opposite of what one card in two states is
           for. Only the label and the width change. */
        decline.className = 'btn btn-secondary btn-md';
        decline.dataset.action = 'cancel';
        decline.replaceWith(decline.cloneNode(true));
        row.querySelector('[data-action="cancel"]').addEventListener('click', cancelQueue);
      }
    });

    scrollToLatest();
  }

  function cancelQueue() {
    window.clearTimeout(pendingReply);
    window.clearTimeout(queueHeartbeat);
    mode = 'bot';
    missStreak = 0;
    collapseEscalate(function () {
      addNote(KB.ESCALATION.cancelled);
    });
    setSuggestions(KB.GREETING.chips);
  }

  function endAgentChat() {
    window.clearTimeout(pendingReply);
    window.clearTimeout(queueHeartbeat);
    mode = 'bot';
    missStreak = 0;
    setAgentChrome(false);
    addNote(KB.ESCALATION.ended(KB.ESCALATION.agent.name));
    setSuggestions(KB.GREETING.chips);
  }

  /* The header identifies who you are talking to and how to leave, so both swap
     with the mode. "End chat" is a control rather than a thing to say, which is
     why it is here and not in the row of suggested questions. */
  function setAgentChrome(isAgent) {
    const agent = KB.ESCALATION.agent;
    try {
      sessionStorage.setItem(MODE_KEY, isAgent ? 'agent' : 'bot');
    } catch (err) {
      /* Storage is a convenience: see saveTranscript. */
    }
    shelfTitle.textContent = isAgent ? agent.name : KB.ASSISTANT.name;
    subtitle.textContent = isAgent ? agent.role : KB.ASSISTANT.subtitle;
    subtitle.classList.toggle('chat-subtitle-live', isAgent);
    endBtn.hidden = !isAgent;
    avatar.classList.toggle('chat-avatar-agent', isAgent);
    avatar.innerHTML = isAgent
      ? agent.initials
      : '<svg viewBox="0 0 24 24"><use href="#icon-chat"></use></svg>';
    input.placeholder = isAgent ? 'Message ' + agent.name : 'Ask a question';
  }

  /* Centred status line. Not a turn in the conversation, so it stays out of the
     transcript and its log.
     The pair that brackets the agent stretch uses this and nothing else: the
     opening line carries the handoff reassurance and the closing one ends the
     session, but they are the same kind of thing, so they take the same shape.
     No glyph on either. A tick on one half of a matched pair makes them read as
     two different objects, and the line already says what happened. */
  /* An <li> rather than a <p>: the transcript is an <ol>, and only list items
     are valid children of one. */
  function addNote(text) {
    const note = document.createElement('li');
    note.className = 'chat-note';
    note.textContent = text;
    log.appendChild(note);
    setEmpty(false);
    scrollToLatest();
  }


  function escapeToParagraph(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return '<p>' + div.innerHTML + '</p>';
  }

  /* --- Composer ------------------------------------------------------------ */

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  function resetComposer() {
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
  }

  input.addEventListener('input', function () {
    autoGrow();
    sendBtn.disabled = input.value.trim().length === 0;
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitMessage(input.value);
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitMessage(input.value);
  });

  /* --- Scroll hairlines ---------------------------------------------------- */

  body.addEventListener('scroll', updateScrollState, { passive: true });
  window.addEventListener('resize', updateScrollState);

  /* --- Focus management ---------------------------------------------------- */

  function focusableInShelf() {
    /* The confirmation owns focus while it is open: everything behind it is
       inert, so the trap has to run inside the card rather than the shelf. */
    const scope = confirmOpen ? confirmCard : shelf;
    return Array.prototype.filter.call(
      scope.querySelectorAll(FOCUSABLE),
      function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      }
    );
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    /* Only the modal forms trap. Tabbing out of a popup onto the page is
       correct: the page is still usable, so the tab order should reach it.
       The confirmation is modal in every form, so it always traps. */
    if (!isModal() && !confirmOpen) return;

    const items = focusableInShelf();
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      /* Escape answers the innermost question. Closing the whole shelf out from
         under an open confirmation would be a strange way to say "no". */
      if (confirmOpen) closeConfirm(true);
      else closeShelf();
      return;
    }
    trapFocus(event);
  }

  /* --- End-chat confirmation ------------------------------------------------
     The only control in the shelf whose result the member cannot undo by
     clicking again: the agent is gone once they leave. Everything else here is
     reversible, which is why nothing else asks. */

  function openConfirm() {
    if (confirmOpen) return;
    confirmOpen = true;
    confirm.hidden = false;
    /* Inert rather than hidden: the transcript stays readable behind the scrim,
       which is the point of dimming it instead of replacing it, but nothing
       behind can be clicked or reached by a screen reader. */
    shelfPanes.forEach(function (el) { el.inert = true; });
    /* Focus lands on the way out, not on the way through. */
    confirmNo.focus();
  }

  function closeConfirm(returnFocus) {
    if (!confirmOpen) return;
    confirmOpen = false;
    confirm.hidden = true;
    shelfPanes.forEach(function (el) { el.inert = false; });
    /* Back to the control that asked the question, unless the answer was yes:
       that button is about to be hidden, so focus would land nowhere. */
    if (returnFocus && !endBtn.hidden) endBtn.focus();
  }

  /* --- Form: popup or sheet -------------------------------------------------
     The mobile sheet is modal: it covers the page, so the page behind it is
     inert, scrolling is locked, and focus is trapped. The popup is none of those
     things. It floats over a page that stays usable, which is the whole point of
     a popup, and locking the page behind one would take away the thing it was
     chosen for. */

  function applyModality() {
    const modal = isModal();

    scrim.classList.toggle('is-modal', modal);
    shelf.setAttribute('aria-modal', String(modal));

    document.body.style.overflow = modal ? 'hidden' : '';
    backdropRegions.forEach(function (el) { el.inert = modal; });
  }

  function releaseModality() {
    document.body.style.overflow = '';
    backdropRegions.forEach(function (el) { el.inert = false; });
    scrim.classList.remove('is-modal');
  }

  /* Rotating a phone across the breakpoint changes whether the sheet is in
     play, and with it whether the page behind should be inert. */
  sheetForm.addEventListener('change', function () {
    if (isOpen) applyModality();
  });

  /* --- Open / close -------------------------------------------------------- */

  /* `trigger` is the launcher that was used, so focus returns to the control the
     member actually pressed. Reading document.activeElement instead is unreliable,
     because it is <body> whenever the button was activated without first taking
     focus. */
  function openShelf(trigger) {
    if (isOpen) return;
    isOpen = true;
    lastFocused = trigger || document.activeElement;

    scrim.hidden = false;
    shelf.hidden = false;
    shelf.classList.remove('is-closing');
    scrim.classList.remove('is-closing');

    launchers.forEach(function (el) { el.setAttribute('aria-expanded', 'true'); });
    launcher.removeAttribute('data-unread');

    applyModality();
    document.addEventListener('keydown', onKeydown);

    /* A blank conversation shows the empty state and its starter prompts. */
    if (!transcript.length) {
      setEmpty(true);
      setSuggestions(KB.GREETING.chips);
    }

    /* Move focus synchronously: deferring it to rAF loses the race against the
       browser's own focus handling for the click that opened the shelf.
       Desktop lands on the composer; touch lands on Close so the on-screen
       keyboard stays down until the member taps in. */
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    (coarse ? closeBtn : input).focus();

    scrollToLatest();
  }

  function closeShelf() {
    if (!isOpen) return;
    closeConfirm(false);
    isOpen = false;

    document.removeEventListener('keydown', onKeydown);
    launchers.forEach(function (el) { el.setAttribute('aria-expanded', 'false'); });
    releaseModality();

    const finish = function () {
      shelf.hidden = true;
      scrim.hidden = true;
      shelf.classList.remove('is-closing');
      scrim.classList.remove('is-closing');
    };

    if (reducedMotion.matches) {
      finish();
    } else {
      shelf.classList.add('is-closing');
      scrim.classList.add('is-closing');
      window.setTimeout(finish, 300);
    }

    /* Focus must land somewhere outside the shelf. It is about to be hidden, and
       leaving focus on a descendant drops it to <body>. */
    const target = (lastFocused && document.contains(lastFocused) && !shelf.contains(lastFocused))
      ? lastFocused
      : launcher;
    target.focus();
  }

  launchers.forEach(function (el) {
    el.addEventListener('click', function () {
      isOpen ? closeShelf() : openShelf(el);
    });
  });

  closeBtn.addEventListener('click', closeShelf);
  endBtn.addEventListener('click', openConfirm);
  confirmNo.addEventListener('click', function () { closeConfirm(true); });
  confirmYes.addEventListener('click', function () {
    closeConfirm(false);
    endAgentChat();
  });
  /* Clicking the dimmed transcript is a soft "no", the same as Escape. Clicks
     inside the card must not count, so this only fires on the scrim itself. */
  confirm.addEventListener('click', function (event) {
    if (event.target === confirm) closeConfirm(true);
  });
  scrim.addEventListener('click', closeShelf);

  /* Prototype: every link in the shelf is inert. They stay real anchors so they
     keep link semantics, keyboard focus, and the styling that marks them as
     destinations, but nothing navigates, because there is nowhere to navigate to
     yet. Delegated, so links inside answers rendered later are covered too. */
  shelf.addEventListener('click', function (event) {
    const link = event.target.closest('a[href]');
    if (link) event.preventDefault();
  });

  /* --- Boot ---------------------------------------------------------------- */

  daystamp.textContent = dayLabel();
  endBtn.textContent = KB.ESCALATION.endLabel;
  subtitle.textContent = KB.ASSISTANT.subtitle;
  emptyTitle.textContent = KB.GREETING.title;
  emptyBody.textContent = KB.GREETING.body;

  transcript = loadTranscript();
  transcript.forEach(renderMessage);
  setEmpty(transcript.length === 0);

  /* A reload mid-handoff must not leave agent turns under Cogent's header. */
  try {
    if (sessionStorage.getItem(MODE_KEY) === 'agent') {
      mode = 'agent';
      setAgentChrome(true);
    }
  } catch (err) {
    /* Storage unavailable: start as Cogent, which is the safe default. */
  }

  if (mode === 'agent') {
    setSuggestions(null);
  } else if (transcript.length) {
    let saved = [];
    try {
      saved = JSON.parse(sessionStorage.getItem(CHIPS_KEY)) || [];
    } catch (err) {
      saved = [];
    }
    setSuggestions(Array.isArray(saved) ? saved : []);
  } else {
    setSuggestions(KB.GREETING.chips);
    launcher.setAttribute('data-unread', 'true');
  }
})();
