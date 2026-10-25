// Words on the page. Edit freely.
export const TITLE = 'Squeegee';
export const ARTIST = 'Bryan Brinkman';
export const ARTIST_URL = 'https://bryanbrinkman.com';
export const EDITION_SIZE = 100; // shown until the contract's own cap loads

// Code collectors enter before the mint button appears. Page-only: it ships in
// the site's JavaScript and the contract doesn't check it. Empty = no code.
export const MINT_CODE: string = '';
// Copies one wallet may mint through this page. Page-only, like the code: the
// contract doesn't check it. 0 = no limit.
export const MAX_PER_WALLET = 1;

export const DESCRIPTION = [
  'Squeegee by Bryan Brinkman. Created with ABX for Marfa 2026. Dots and piped lines of paint are randomly drawn, then a squeegee drags through them and smears everything it meets. Leave it running and it keeps making new ones, or double click/tap to open the customize menu and draw and spread your own work.',
];

// Credits under the purchase panel.
export const DETAILS: [string, string][] = [
  ['Edition', 'ERC-1155, on-chain'],
  ['Code', 'p5.js'],
];
