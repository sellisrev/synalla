# Licensing

Synalla is dual-licensed. You may use it under either of these licences:

1. **GNU Affero General Public License, version 3 only** ([LICENSE](LICENSE)). You may use, change and share the code. If you share a changed version, or let people use it over a network, you must offer them its full source under the same licence.
2. **A commercial licence** from the copyright holder ([LICENSES/LicenseRef-Synalla-Commercial.txt](LICENSES/LicenseRef-Synalla-Commercial.txt)). This is for organisations that want to build Synalla into a product or service without publishing their own source. Its terms are set in a separate written agreement.

Each Synalla file carries this line:

```
SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
```

Files without a header are covered by [REUSE.toml](REUSE.toml).

## Commercial licence

To ask for one, open an issue titled "Commercial licence" on the GitHub repository, or write to the maintainer through the contact listed on the GitHub profile. A commercial licence covers only the files under `AGPL-3.0-only OR LicenseRef-Synalla-Commercial`. Third-party code keeps its own licence, as described below.

## Third-party code

Synalla reuses code from projects under permissive licences. That code is never relicensed:

- **Files copied or forked from another project keep their original licence and copyright lines.** Their SPDX header names the original licence, for example `SPDX-License-Identifier: MIT`. Our changes to those files are released under that same original licence, so each file has exactly one licence.
- **Whole forked components live under `third_party/<name>/`**, together with their original `LICENSE` file and any `NOTICE` file.
- **Apache-2.0 code:** we keep its `NOTICE` file and mark changed files with a line such as `Modified by Synalla contributors, 2026`.
- **Accepted licences:** MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, 0BSD, Zlib and the Unlicense. Code under GPL, LGPL, MPL, AGPL or any non-commercial licence is not accepted, because it couldn't be offered under the commercial licence.
- **Dependencies** must use one of the accepted licences. They are pinned to exact versions and checked before they are added.

Current third-party material:

| Path | Origin | Licence |
|---|---|---|
| `test/vectors/nip44.vectors.json` | NIP-44 test vectors, github.com/paulmillr/nip44 (`javascript/test/`) | Unlicense |
| `@noble/curves`, `@noble/hashes` (npm dependencies, not vendored) | Paul Miller | MIT |

## Contributions

Contributions are welcome under the [Contributor Licence Agreement](CLA.md). Without it, contributed code couldn't be offered under the commercial licence. You keep the copyright in your contribution, and the project promises to keep it available under the AGPL as well.

## Name

"Synalla" is the project's name. Forks are welcome under the AGPL, but they must use a different name.
