# Known limits

This code is a reference for the rules, tested on synthetic data. It is not ready for real pay or real identities.

## Group answers (`src/pool.js`)
| Limit | What it means |
|---|---|
| The differencing check covers counts and sums | Quartiles and medians aren't linear. The check is a strong proxy for them, not a proof |
| Progress counts are public and exact | They reveal how many people joined a group, never who. In a small group, taking part can itself be sensitive |
| "Waiting" groups are listed | A group with k or more people that can't be published this round shows that a small remainder exists |
| Record keys aren't authenticated here | Anyone who can submit records can submit many. One-per-person keys (proofs, vouches) must be enforced before a record reaches the pool |
| Published results stay published | A person who deletes their record is removed from future rounds, but earlier releases that included them remain, marked with their round |
| Cost grows with history | Every past release is part of the check. Fine for thousands of records and dozens of rounds; long-lived questions need compaction |
| The collector sees values | Until two independent aggregators are used, whoever runs the collector sees banded values without names |
| Ordering is broad first | Groups are tried from broad to narrow, so a broad result can block a narrower one in the same round |

## Trust (`src/vouch.js`, `src/trust.js`)
| Limit | What it means |
|---|---|
| Proofs are taken as given | `admissionTier` trusts the `proofs` it is passed. Verifying zk-email, passport or deposit proofs is outside this module |
| Removal is a local decision | Each home decides whose removals to apply. There is no global registry in this code |
| Vouches are public edges | Sharing vouch events reveals who invited whom |
| No rate-limiting nullifiers yet | Spam bounds that rely on RLN memberships are design only |

## Offers (`src/offers.js`)
| Limit | What it means |
|---|---|
| Pay periods are converted with fixed factors | Hourly pay uses a 1,607-hour year (France, 35-hour week) |
| Derived offers are only as true as their source | The signer vouches for the conversion, not for the employer |

## Event kinds
The kinds in `src/kinds.js` are provisional and not registered with the Nostr NIPs. Nothing in this repository publishes to public relays.
