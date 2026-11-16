# Pay question: what is kept

This page is what a person's AI reads before it fills in a pay record. It is short on purpose.

**The question.** Where does your fixed pay stand among people doing similar work? Groups are defined by role, seniority, region and company type.

**What is kept.** One record per person, with exactly these fields:

| Field | Allowed values |
|---|---|
| `role` | Product designer, Product manager, QA engineer |
| `seniority` | Junior, Mid, Senior, Lead |
| `region` | Paris, Lyon, Other France |
| `company_type` | Startup, Scale-up, Large company |
| `value` | Fixed yearly gross pay in euros, full-time equivalent, rounded to the nearest 1,000. 13th month included; bonuses, overtime and one-off payments excluded |
| `key` | A random code your AI creates. It lets you update or delete your record. Keep it |

**What is refused.** Your name, your employer's name, addresses, social security number, IBAN, email, phone, employee number, or any other identifier. A record that contains any of these is rejected. If a form asks for them, it is not this one.

**What is published.** Results come out in rounds, only for groups of at least 15 people, as the 25th percentile, median and 75th percentile. A group refreshes only when enough has changed that no comparison of results can single out fewer than 15 people. Until a group unlocks, only its progress is shown ("11 of 15"). Nobody can tell from a result or a progress card who took part.

**What you get.** Your position (bottom quarter to top quarter) in the narrowest group that has unlocked, and the progress of the narrower groups you belong to.

**Deleting.** Send your key with the word `delete`. Your record leaves the next round. Results already published that included it stay as they were, marked with their round.

**Your payslip.** It stays with you and the AI you chose. Only the record above is sent. If you use a cloud AI, that provider reads the payslip; only a local model keeps it on your own hardware.

**Status.** Pseudonymous records can still be personal data under the GDPR. This policy has not yet had a legal review, and no collector is running yet: this kit is for testing with synthetic payslips only.
