# Event tags

All objects travel as Nostr NIP-01 events. Kinds are provisional (see `src/kinds.js`).

| Kind | Name | Signed by | Tags | Content |
|---|---|---|---|---|
| 7790 | INVITE | inviter (kept private) | `h` sha256 of the code, `scope`, `max_uses`, `expiration` | empty |
| 7791 | REDEEM | invitee | `e` invite id, `p` inviter, `proof` sha256(code ":" invitee pubkey) | empty |
| 7792 | VOUCH | voucher | `p` subject, `scope`, optional `invite` id | empty |
| 7793 | UNVOUCH | voucher | `p` subject | reason |
| 7794 | QUESTION | question owner | | `question.json` |
| 7795 | RECORD | record key holder, sealed in transport | | `record.json` |
| 7796 | RELEASE | collector | | `release.json` |
| 7797 | OFFER | company, or whoever derived it | `type`, `source`, optional `t` role, `g` region, `expiration` | `offer.json` |
| 7798 | ACK | recipient | `e` acknowledged event | empty |
