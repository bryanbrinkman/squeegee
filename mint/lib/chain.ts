import {defineChain} from 'viem';
import {CHAIN_ID, CHAIN_NAME, RPC_URL} from './config';

// A minimal viem chain built from config — no dependency on viem/chains matching the id.
export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [RPC_URL]}},
});
