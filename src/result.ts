// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// The return shape of the modules that never throw on bad input (wants, decisions, askaround).

export interface Failure { ok: false; errors: string[] }
export type Result<T extends object> = ({ ok: true } & T) | Failure;
