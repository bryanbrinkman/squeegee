// Minter + token ABIs for an EDITION target (ERC-1155 copies) — see the non-edition lib/abi.ts's
// twin for the "why sourced from the SDK, never hand-typed" note.
import {abxFixedPriceMinter1155Abi, oneOfOneEditionAbi} from '@artblocks/abx-sdk/abi';

export const minterAbi = abxFixedPriceMinter1155Abi;
export const tokenAbi = oneOfOneEditionAbi;
