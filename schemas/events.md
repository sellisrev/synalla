# Event tags

All objects travel as Nostr NIP-01 events. Kinds are final as of 22 Nov 2026 (`src/kinds.ts`; `test/kinds.test.js` fails if one changes).

| Kind | Name | Signed by | Tags | Content |
|---|---|---|---|---|
| 8436 | INVITE | inviter (kept private) | `h` sha256 of the code, `scope`, `max_uses`, `expiration` | empty |
| 8437 | REDEEM | invitee | `e` invite id, `p` inviter, `proof` sha256(code ":" invitee pubkey) | empty |
| 8438 | VOUCH | voucher | `p` subject, `scope`, optional `invite` id | empty |
| 8439 | UNVOUCH | voucher | `p` subject | reason |
| 8440 | QUESTION | question owner | | `question.json` |
| 8441 | RECORD | record key holder, sealed in transport | | `record.json` |
| 8442 | RELEASE | collector | | `release.json` |
| 8443 | OFFER | company, or whoever derived it | `type`, `source`, optional `t` role, `g` region, `expiration` | `offer.json` |
| 8444 | ACK | recipient | `e` acknowledged event | empty |
| 8445 | KNOCK | sender | `category`, optional `p` recipient | `knock.json`: category, its fields, a note of at most 280 characters with no links, contacts or handles |
| 8446 | REQUEST | asker's agent | `category`, `t` topics, optional `g` region, `expiration` | JSON: `v`, category, topics, region, a note of at most 200 characters with no links, contacts, private terms or budget. Offers answering it carry `e` with its id |
