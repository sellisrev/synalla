// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Event kinds used by Synalla. FINAL as of 22 Nov 2026: test/kinds.test.js fails if any number changes.
// Regular kinds (1000-9999, stored by relays) 3850-3861; the bridge's replaceable binding is 13850 and its D2D
// envelope 3861 (synalla-home packages/synalla-bridge). Not in the NIPs registry, and no events of these kinds on
// five large public relays when checked (22 Nov 2026). The earlier provisional 7790-7801 were moved because another,
// unregistered app publishes hundreds of events with kinds 7790-7796.

export const KIND = Object.freeze({
  INVITE: 3850, // issuer's private record of an invite (holds a hash of the code)
  REDEEM: 3851, // invitee asks to redeem an invite (proof of the code, bound to its key)
  VOUCH: 3852, // issuer vouches for a key: one edge of the web of trust
  UNVOUCH: 3853, // issuer withdraws a vouch
  QUESTION: 3854, // a private question: fields, groups, minimum group size
  RECORD: 3855, // one answer to a question (sealed in transport; plain here)
  RELEASE: 3856, // a published round of group results
  OFFER: 3857, // a signed offer (job, sale, service, tender), public or answering a REQUEST
  ACK: 3858, // delivery acknowledgement
  KNOCK: 3859, // typed first contact from someone the recipient may not know
  REQUEST: 3860, // a need published by an agent: what is wanted, never who wants it or their budget
} as const);

export const SCHEMA_BASE = 'https://github.com/sellisrev/synalla/blob/main/schemas/';
