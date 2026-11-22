// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Event kinds used by Synalla. FINAL as of 22 Nov 2026: test/kinds.test.js fails if any number changes.
// Regular kinds (1000-9999, stored by relays): 8436-8446 here, 8447 for the bridge's D2D envelope; the bridge's
// replaceable binding is 19469 (synalla-home packages/synalla-bridge).
// Chosen in the middle of the widest gaps in real use, checked 22 Nov 2026:
//   - no kind within 52 of 8436-8447 (and none within 270 of 19469) on 16 large public relays (out of 33 asked);
//   - not in the NIPs registry, and not in any of the 498 open or 1,403 closed NIP pull requests.
// The provisional 7790-7801 were dropped because another, unregistered app publishes hundreds of events with kinds
// 7790-7796; 3850-3861 was a first move into a crowded neighbourhood.

export const KIND = Object.freeze({
  INVITE: 8436, // issuer's private record of an invite (holds a hash of the code)
  REDEEM: 8437, // invitee asks to redeem an invite (proof of the code, bound to its key)
  VOUCH: 8438, // issuer vouches for a key: one edge of the web of trust
  UNVOUCH: 8439, // issuer withdraws a vouch
  QUESTION: 8440, // a private question: fields, groups, minimum group size
  RECORD: 8441, // one answer to a question (sealed in transport; plain here)
  RELEASE: 8442, // a published round of group results
  OFFER: 8443, // a signed offer (job, sale, service, tender), public or answering a REQUEST
  ACK: 8444, // delivery acknowledgement
  KNOCK: 8445, // typed first contact from someone the recipient may not know
  REQUEST: 8446, // a need published by an agent: what is wanted, never who wants it or their budget
} as const);

export const SCHEMA_BASE = 'https://github.com/sellisrev/synalla/blob/main/schemas/';
