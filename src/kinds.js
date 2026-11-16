// Event kinds used by Synalla.
// PROVISIONAL: these numbers are not registered with the Nostr NIPs repository.
// They sit in the "regular" range (1000-9999) and are kept in this one file so they
// can be changed in one place before anything is published to public relays.

export const KIND = Object.freeze({
  INVITE: 7790, // issuer's private record of an invite (holds a hash of the code)
  REDEEM: 7791, // invitee asks to redeem an invite (proof of the code, bound to its key)
  VOUCH: 7792, // issuer vouches for a key: one edge of the web of trust
  UNVOUCH: 7793, // issuer withdraws a vouch
  QUESTION: 7794, // a private question: fields, groups, minimum group size
  RECORD: 7795, // one answer to a question (sealed in transport; plain here)
  RELEASE: 7796, // a published round of group results
  OFFER: 7797, // a signed offer (job, sale, service, tender), public or answering a REQUEST
  ACK: 7798, // delivery acknowledgement
  KNOCK: 7799, // typed first contact from someone the recipient may not know
  REQUEST: 7800, // a need published by an agent: what is wanted, never who wants it or their budget
});

export const SCHEMA_BASE = 'https://github.com/sellisrev/synalla/blob/main/schemas/';
