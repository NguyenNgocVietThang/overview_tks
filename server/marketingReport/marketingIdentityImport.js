'use strict';

const { createHash } = require('node:crypto');
const { PAGE_IDS } = require('./marketingRepository');

// The recovery file is built privately from the authoritative full Pancake exports (it holds message IDs and row
// references only). This module validates its structure and writes it; it never edits or merges history rows.
const WORKBOOK_ID = '1cAOmY4WC2tIE0-OMwvy43PTR9dNK72k2d4DUDrB2swk';
const RESOLUTIONS = Object.freeze(['unique', 'verified-notation', 'equivalent']);

function invalid(rowReferences = []) {
  return Object.assign(new Error('Pancake identity input is invalid; inspect the recovery file structure.'), { code: 'INVALID_MARKETING_IMPORT', rowReferences });
}

function prepareIdentityImport(data) {
  if (!data || !Array.isArray(data.links) || !Array.isArray(data.baselineMessages) || !Array.isArray(data.unresolved)) throw invalid();
  const seenLinks = new Set(), pairsByRow = new Map(), messages = new Map();
  const resolutions = Object.fromEntries(RESOLUTIONS.map(name => [name, 0]));
  for (const link of data.links) {
    if (!PAGE_IDS.includes(link.pageId) || !RESOLUTIONS.includes(link.resolution) || !link.messageId || !link.tab || !Number.isInteger(link.rowNumber)) throw invalid([`${link.tab}!${link.rowNumber}`]);
    const key = `${link.tab}!${link.rowNumber}\u0000${link.messageId}`;
    if (seenLinks.has(key)) throw invalid([`${link.tab}!${link.rowNumber}`]);
    seenLinks.add(key);
    resolutions[link.resolution]++;
    const rowKey = `${link.tab}!${link.rowNumber}`;
    pairsByRow.set(rowKey, [...(pairsByRow.get(rowKey) || []), link]);
    messages.set(`${link.pageId}\u0000${link.messageId}`, link.pageId);
  }
  // A row may point to several messages only as an explicit equivalence group; otherwise it has exactly one.
  for (const [rowKey, rowLinks] of pairsByRow) {
    if (rowLinks.length > 1 && !rowLinks.every(link => link.resolution === 'equivalent' && link.groupKey)) throw invalid([rowKey]);
  }
  for (const message of data.baselineMessages) {
    if (!PAGE_IDS.includes(message.pageId) || !message.messageId || messages.has(`${message.pageId}\u0000${message.messageId}`)) throw invalid();
  }
  const baselineKeys = new Set(data.baselineMessages.map(message => `${message.pageId}\u0000${message.messageId}`));
  if (baselineKeys.size !== data.baselineMessages.length) throw invalid();
  const contentHash = createHash('sha256').update(JSON.stringify({ links: data.links, baseline: data.baselineMessages })).digest('hex');
  return {
    batchKey: `pancake-identity-v1:${data.capturedDate}:${contentHash}`,
    workbookId: WORKBOOK_ID,
    links: data.links,
    baselineMessages: data.baselineMessages,
    summary: {
      capturedDate: data.capturedDate,
      historyRowsLinked: pairsByRow.size,
      links: data.links.length,
      resolutions,
      distinctMessages: messages.size,
      baselineMessages: data.baselineMessages.length,
      unresolved: data.unresolved.map(({ ref, pageId, reason }) => ({ ref, pageId, reason }))
    }
  };
}

async function applyIdentityImport(prepared, repository, actor) {
  return repository.importIdentities({ batchKey: prepared.batchKey, workbookId: prepared.workbookId, links: prepared.links, baselineMessages: prepared.baselineMessages }, actor);
}

module.exports = { WORKBOOK_ID, prepareIdentityImport, applyIdentityImport };
