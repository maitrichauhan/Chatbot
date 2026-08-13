/* ============================================================================
   Cogent: knowledge base retrieval
   Scores the member's message against the entries in kb-data.js and returns the
   best answer, or null when nothing is a convincing match.

   TF-IDF over three fields, because where a word appears changes what it means.
   A message matching an entry's *question* is almost certainly asking that
   question; the same word buried in a long answer body is far weaker evidence,
   and long answers would otherwise win on volume alone.
   ========================================================================== */

window.COPART_RETRIEVAL = (function () {
  'use strict';

  const DATA = window.COPART_KB_DATA || [];

  /* Words that appear in nearly every question and so separate nothing. */
  const STOP = new Set(('a an and are as at be by can could do does for from get how i if in is it ' +
    'me my of on or our so than that the their them then there these they this toup us was what when ' +
    'where which who why will with would you your about any been has have had not no yes am we ' +
    /* Contractions of the above. Without these, "why can't I bid" matches every
       question containing "can't" on a word that carries no topic at all. */
    'cant dont wont didnt doesnt isnt arent wasnt havent hasnt wouldnt couldnt shouldnt ' +
    'im ive ill id youre thats whats heres theres lets').split(' '));

  const FIELD_WEIGHT = { question: 6, section: 3, body: 1 };

  /* Matching a specific FAQ beats matching a whole topic: the member asked a
     question, not for a briefing. */
  const KIND_WEIGHT = { faq: 1, overview: 0.72 };

  /* Below this, the best entry is not a real answer. Tuned so an off-topic
     message ("do you sell helicopters") falls through to the miss handling
     rather than returning whichever entry happened to share a word. */
  const THRESHOLD = 0.18;

  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t.length > 2 && !STOP.has(t); })
      .map(stem);
  }

  /* Crude suffix stripping, enough to tie "payments"/"payment" and
     "bidding"/"bid" together. A real stemmer is not worth the weight here. */
  function stem(word) {
    return word
      .replace(/(ies)$/, 'y')
      .replace(/(sses|shes|ches|xes)$/, '')
      .replace(/([^s])s$/, '$1')
      .replace(/(ing|ed)$/, '');
  }

  function stripTags(html) {
    return html.replace(/<[^>]+>/g, ' ');
  }

  /* --- Index ---------------------------------------------------------------
     Built once at load. 222 entries, so this is a few milliseconds and saves
     re-tokenizing every entry on every keystroke-free submit. */

  const docs = DATA.map(function (entry) {
    const fields = {
      question: tokenize(entry.question),
      section: tokenize(entry.section),
      body: tokenize(stripTags(entry.html))
    };

    /* Weighted term frequency, collapsed to one map per entry. */
    const tf = Object.create(null);
    Object.keys(fields).forEach(function (field) {
      const weight = FIELD_WEIGHT[field];
      fields[field].forEach(function (term) {
        tf[term] = (tf[term] || 0) + weight;
      });
    });

    let norm = 0;
    Object.keys(tf).forEach(function (t) { norm += tf[t] * tf[t]; });

    return {
      entry: entry,
      tf: tf,
      norm: Math.sqrt(norm) || 1,
      questionText: ' ' + entry.question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' '
    };
  });

  /* Document frequency, so common words across the corpus count for less. */
  const df = Object.create(null);
  docs.forEach(function (doc) {
    Object.keys(doc.tf).forEach(function (term) { df[term] = (df[term] || 0) + 1; });
  });

  function idf(term) {
    return Math.log(1 + docs.length / (1 + (df[term] || 0)));
  }

  /* --- Lookup --------------------------------------------------------------- */

  function search(message, limit) {
    const terms = tokenize(message);
    if (!terms.length) return [];

    const queryTf = Object.create(null);
    terms.forEach(function (t) { queryTf[t] = (queryTf[t] || 0) + 1; });

    let queryNorm = 0;
    Object.keys(queryTf).forEach(function (t) {
      const w = queryTf[t] * idf(t);
      queryNorm += w * w;
    });
    queryNorm = Math.sqrt(queryNorm) || 1;

    const plain = ' ' + String(message).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

    const scored = docs.map(function (doc) {
      let dot = 0;
      Object.keys(queryTf).forEach(function (t) {
        if (!doc.tf[t]) return;
        const w = idf(t);
        dot += (queryTf[t] * w) * (doc.tf[t] * w);
      });

      /* How much of what they asked this entry actually covers. Without it a
         single high-weight hit in a question wins outright: "why was my payment
         rejected" landed on a bidding FAQ containing "reject" and nothing about
         payment, beating the Payment Rejections topic that matched both terms. */
      let matched = 0;
      Object.keys(queryTf).forEach(function (t) { if (doc.tf[t]) matched += 1; });
      const coverage = matched / Object.keys(queryTf).length;

      let score = (dot / (queryNorm * doc.norm)) * KIND_WEIGHT[doc.entry.kind] * coverage;

      /* The member typed the question, or the question contains what they
         typed. Near-certain, and worth more than any amount of term overlap. */
      if (plain.length > 8 && doc.questionText.indexOf(plain.trim()) !== -1) score += 0.45;

      return { entry: doc.entry, score: score };
    });

    return scored
      .filter(function (r) { return r.score >= THRESHOLD; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit || 3);
  }

  /* An alias wins outright when it fires: it is a human deciding that this
     phrasing means that entry, which beats anything scoring can infer. */
  function aliased(message) {
    const aliases = (window.COPART_KB && window.COPART_KB.ALIASES) || [];
    const plain = String(message).toLowerCase().replace(/[’']/g, '\u2019')
      .replace(/[^a-z0-9\u2019\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain) return null;

    for (let i = 0; i < aliases.length; i += 1) {
      const hit = aliases[i].phrases.some(function (phrase) {
        return plain.indexOf(phrase) !== -1;
      });
      if (!hit) continue;
      const entry = DATA.find(function (e) { return e.id === aliases[i].entry; });
      if (entry) return entry;
    }
    return null;
  }

  function answer(message) {
    const pinned = aliased(message);
    if (pinned) {
      /* Still run search, so the follow-up chips stay relevant to what was asked. */
      const others = search(message, 3).filter(function (h) { return h.entry.id !== pinned.id; });
      return { entry: pinned, score: 1, related: others.slice(0, 2).map(function (h) { return h.entry; }) };
    }

    const hits = search(message, 3);
    if (!hits.length) return null;
    return {
      entry: hits[0].entry,
      score: hits[0].score,
      /* The runners-up become follow-up chips, so a near-miss is one tap away
         rather than something the member has to rephrase their way into. */
      related: hits.slice(1).map(function (h) { return h.entry; })
    };
  }

  return { search: search, answer: answer, size: docs.length };
})();
