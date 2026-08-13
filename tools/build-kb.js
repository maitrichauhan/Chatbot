/* ============================================================================
   Build js/kb-data.js from the knowledge base markdown.

     node tools/build-kb.js ~/Downloads/knowledge-base.md

   The source is written for retrieval: every `##` is a self-contained topic,
   and FAQs inside it are a bold question line followed by its answer. This
   splits on exactly that, so one entry is one answerable question.

   Parsing here rather than in the browser keeps the shipped file free of a
   markdown parser, and keeps the scoring index the only work done at load.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const SOURCE = process.argv[2];
const OUT = path.join(__dirname, '..', 'js', 'kb-data.js');

if (!SOURCE) {
  console.error('usage: node tools/build-kb.js <knowledge-base.md>');
  process.exit(1);
}

const md = fs.readFileSync(SOURCE, 'utf8');

/* Sections that describe the document rather than answer anything. */
const SKIP = new Set(['About This Document', 'Table of Contents']);

/* Subheads whose bodies ARE the answer. The label itself is dropped. */
const CONTENT_HEAD = /^(Process Flow|Exceptions to Process Flow)\s*:?\s*$/i;

/* Subheads that describe the document to the people who maintain it. Both the
   label and everything under it are dropped: "The purpose of this document is
   to provide a list of possible rejections" is not an answer to anything a
   member asked. */
const INTERNAL_HEAD = /^(Process Scope|Process Purpose|Purpose|Scope)\s*:?\s*$/i;

const STRUCTURAL = new RegExp(CONTENT_HEAD.source + '|' + INTERNAL_HEAD.source, 'i');

/* The same self-description also appears as a bare paragraph under the topic
   title, with no subhead to catch it. Matched by shape instead. */
const BOILERPLATE = /^(the purpose of this (document|process|sop)\b|the scope (includes|covers|of this)\b|this (document|process|sop) (covers|includes|provides|outlines)\b|the scope includes\b)/i;

/* Document metadata left over from the internal wiki: the author's name, and a
   repeat of the topic title, both sitting as bare lines under the heading. */
const AUTHORS = new Set(['aaron trent']);

function isMetadata(line, sectionTitle) {
  const t = line.trim().toLowerCase().replace(/\s+/g, ' ');
  if (AUTHORS.has(t)) return true;
  /* The title echoed back, with or without a trailing dash or colon. */
  return t.replace(/[\s:\u2013-]+$/, '') === sectionTitle.toLowerCase().replace(/[\s:\u2013-]+$/, '');
}

/* Drop internal blocks: from an internal subhead until the next subhead. */
function stripInternal(lines, sectionTitle) {
  const out = [];
  let skipping = false;
  lines.forEach(function (raw) {
    const line = raw.trim().replace(/^#+\s*/, '');
    const isHead = /^#{2,}\s/.test(raw.trim()) || CONTENT_HEAD.test(line) || INTERNAL_HEAD.test(line);
    if (isHead) skipping = INTERNAL_HEAD.test(line);
    if (skipping) return;
    if (BOILERPLATE.test(line)) return;
    if (line && isMetadata(line, sectionTitle)) return;
    out.push(raw);
  });
  return out;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Inline markdown that actually appears in the source: bold, and nothing else
   worth honouring. Links are rare and point at internal tools. */
function inline(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* The source runs sentences together where a line break was lost:
   "What is Duplicate title?A duplicate title is...". Split them so the question
   and its answer are not one unreadable run. */
function splitRunOns(line) {
  return line.replace(/([?.])([A-Z])/g, '$1\n$2').split('\n');
}

/* A recurring shape in the source: a condition on one line ending in a colon,
   then "Meaning: ..." on the next. That is a definition list, and reads far
   better as one bullet than as two orphan paragraphs. */
function pairMeanings(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const next = (lines[i + 1] || '').trim();
    const meaning = next.match(/^Meaning\s*:\s*(.+)$/i);
    if (meaning && line && /:$/.test(line)) {
      out.push('- **' + line.replace(/:$/, '') + '**: ' + meaning[1]);
      i += 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

/* Chat is not a document. Keep whole blocks up to a budget rather than cutting
   mid-sentence, so what is shown is always complete as far as it goes. */
const BUDGET = 620;

function trimToBudget(blocks) {
  const out = [];
  let used = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const plain = blocks[i].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (out.length && used + plain.length > BUDGET) break;
    out.push(blocks[i]);
    used += plain.length;
  }
  return out;
}

/* Loose prose with dash bullets. Runs of bullets become one list; everything
   else becomes a paragraph. */
function toHtml(lines) {
  const out = [];
  let bullets = [];

  const flush = function () {
    if (bullets.length) {
      out.push('<ul>' + bullets.map(function (b) { return '<li>' + inline(b) + '</li>'; }).join('') + '</ul>');
      bullets = [];
    }
  };

  pairMeanings(lines).forEach(function (raw) {
    const line = raw.trim();
    if (!line) { flush(); return; }
    if (STRUCTURAL.test(line.replace(/^#+\s*/, ''))) { flush(); return; }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]); return; }

    flush();
    splitRunOns(line.replace(/^#+\s*/, '')).forEach(function (part) {
      if (part.trim()) out.push('<p>' + inline(part.trim()) + '</p>');
    });
  });

  flush();
  return trimToBudget(out).join('');
}

function toText(lines) {
  return lines
    .map(function (l) { return l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim(); })
    .filter(function (l) { return l && !STRUCTURAL.test(l); })
    .join(' ');
}

/* --- Split into sections, then into FAQs ---------------------------------- */

const entries = [];
const sectionBlocks = md.split(/^## /m).slice(1);

sectionBlocks.forEach(function (block) {
  const nl = block.indexOf('\n');
  const title = block.slice(0, nl).trim();
  if (SKIP.has(title)) return;

  const body = block.slice(nl + 1).split('\n')
    .filter(function (l) { return l.trim() !== '---'; });

  /* A bold line on its own is a question; everything until the next one is its
     answer. Anything before the first question is the topic overview. */
  const chunks = [];
  let current = { question: null, lines: [] };

  body.forEach(function (line) {
    const q = line.trim().match(/^\*\*(.+?)\*\*$/);
    if (q) {
      chunks.push(current);
      current = { question: q[1].trim(), lines: [] };
      return;
    }
    current.lines.push(line);
  });
  chunks.push(current);

  chunks.forEach(function (chunk) {
    const lines = stripInternal(chunk.lines, title);
    const html = toHtml(lines);
    const text = toText(lines);
    if (!text) return;

    entries.push({
      id: (title + '-' + (chunk.question || 'overview'))
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80),
      section: title,
      question: chunk.question || title,
      /* Overviews answer "tell me about X"; FAQs answer a specific question.
         Kept apart so a specific match can outrank a topic match. */
      kind: chunk.question ? 'faq' : 'overview',
      html: html
      /* No `text` field: it would duplicate `html` almost word for word and
         nearly double the payload. retrieval.js strips the tags at load. */
    });
  });
});

/* --- Emit ------------------------------------------------------------------ */

const banner = '/* ============================================================================\n' +
  '   Generated by tools/build-kb.js. Do not edit by hand.\n' +
  '   Source: ' + path.basename(SOURCE) + '\n' +
  '   ' + entries.length + ' entries across ' +
  new Set(entries.map(function (e) { return e.section; })).size + ' topics.\n' +
  '   ========================================================================== */\n\n';

fs.writeFileSync(OUT, banner + 'window.COPART_KB_DATA = ' + JSON.stringify(entries) + ';\n');

const faqs = entries.filter(function (e) { return e.kind === 'faq'; }).length;
console.log('wrote ' + path.relative(process.cwd(), OUT));
console.log('  ' + entries.length + ' entries (' + faqs + ' FAQs, ' + (entries.length - faqs) + ' overviews)');
console.log('  ' + Math.round(fs.statSync(OUT).size / 1024) + ' KB');
