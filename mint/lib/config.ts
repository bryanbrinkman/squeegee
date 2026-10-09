// Chain + contract config from NEXT_PUBLIC_* env (see .env.example). Set the
// same values in Vercel → Settings → Environment Variables, or in .env.local
// before `npm run build` for a static upload.
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '1');
export const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME || 'Ethereum';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-rpc.publicnode.com';
// Leave empty until the edition is deployed: the page then shows the live
// preview and "Not on sale yet".
export const TOKEN = (process.env.NEXT_PUBLIC_TOKEN || '') as `0x${string}`;
// ABX's shared ERC-1155 fixed-price minter (same address on every chain).
export const MINTER = (process.env.NEXT_PUBLIC_MINTER || '0x2af9f0c477c34a23cBeC646a3b6BC0cA4Df5d37f') as `0x${string}`;
export const TOKEN_ID = Number(process.env.NEXT_PUBLIC_TOKEN_ID || '0');
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

const EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
};
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER || EXPLORERS[CHAIN_ID] || '';
export const HAS_TOKEN = /^0x[0-9a-fA-F]{40}$/.test(TOKEN);
