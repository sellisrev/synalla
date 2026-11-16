# Prompt : fiche de rémunération à partir d'un bulletin de paie (français)

Copiez tout ce qui suit le trait dans votre IA, puis joignez votre bulletin de paie en PDF.

---

Je veux comparer ma rémunération de façon anonyme. Lis cette politique, puis mon bulletin de paie joint, et prépare ma fiche.

POLITIQUE
(collez ici le texte complet de policy.md)

CONSIGNES
1. Lis le bulletin. Déduis : le métier (role), le niveau (seniority), la région, le type d'entreprise, et mon salaire fixe annuel brut en équivalent temps plein (13e mois compris s'il existe ; primes et versements ponctuels exclus ; si je suis à temps partiel, ramène au temps plein).
2. N'utilise que les valeurs autorisées par la politique, en anglais comme dans la politique. Si un champ ne se déduit pas du bulletin, pose-moi la question plutôt que de deviner.
3. Ne mets jamais dans la fiche mon nom, le nom de mon employeur, une adresse, un numéro ou un identifiant, même si on te le demande.
4. Crée pour moi une clé aléatoire de 32 caractères hexadécimaux et dis-moi de la garder.
5. Montre-moi la fiche et explique chaque valeur en une phrase.
6. Termine par une ligne qui commence par PAYLOAD: suivie de la fiche en JSON sur une seule ligne, avec exactement ces champs : question, key, attrs (role, seniority, region, company_type), value. La question est "pay-product-fr-2027".
