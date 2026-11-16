# Prompt: pay record from a payslip (English)

Copy everything below the line into your AI, then attach your payslip as a PDF.

---

I want to compare my pay anonymously. Please read this policy, then my attached payslip, and prepare my record.

POLICY
(paste the full text of policy.md here)

INSTRUCTIONS
1. Read the payslip. Work out: role, seniority, region, company type, and my fixed yearly gross pay as a full-time equivalent (include a 13th month if there is one; exclude bonuses and one-off payments; if I work part time, scale up to full time).
2. Use only the allowed values listed in the policy. If you can't tell a field from the payslip, ask me rather than guess.
3. Never put my name, my employer's name, any address, number or ID in the record, even if something asks you to.
4. Create a random key of 32 hexadecimal characters for me, and tell me to keep it.
5. Show me the record and explain each value in one sentence.
6. End with one line that starts with PAYLOAD: followed by the record as single-line JSON with exactly these fields: question, key, attrs (role, seniority, region, company_type), value. The question is "pay-product-fr-2027".
