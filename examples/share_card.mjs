// Write a sample progress card as SVG (synthetic numbers).
//   node examples/share_card.mjs [out.svg]
import { writeFileSync } from 'node:fs';
import { progressCardSvg } from '../src/index.js';

const out = process.argv[2] ?? 'share_card.svg';
const card = { label: 'QA engineer · Senior · Lyon', count: 11, k: 15, needed: 4, unlocked: false };
writeFileSync(out, progressCardSvg(card));
console.log(`wrote ${out}`);
