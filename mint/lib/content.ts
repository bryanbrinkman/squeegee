// Words on the page. Edit freely.
export const TITLE = 'Squeegee';
export const ARTIST = 'Bryan Brinkman';
export const ARTIST_URL = 'https://bryanbrinkman.com';
export const EDITION_SIZE = 100; // shown until the contract's own cap loads

// Code collectors enter before the mint button appears. Page-only: it ships in
// the site's JavaScript and the contract doesn't check it. Empty = no code.
export const MINT_CODE = '79843';

export const DESCRIPTION = [
  'Dots and piped lines of paint land on paper, then a squeegee drags through them and smears everything it meets.',
  'Every copy holds the same painting, set by the seed drawn at the first mint. Leave it running and it keeps making new ones.',
];

// Credits under the purchase panel.
export const DETAILS: [string, string][] = [
  ['Edition', 'ERC-1155, on-chain'],
  ['Code', 'p5.js'],
];
