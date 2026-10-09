// Injected-wallet helpers (MetaMask, Coinbase Wallet, Rainbow…). No API keys.
import {CHAIN_ID, CHAIN_NAME, RPC_URL, EXPLORER} from './config';

export function getEthereum(): any {
  return typeof window !== 'undefined' ? (window as any).ethereum : undefined;
}

export function isMobile(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Phones without an injected wallet: open this page inside a wallet's browser.
export function walletLinks(): {label: string; href: string}[] {
  if (typeof window === 'undefined') return [];
  const here = window.location.href;
  const bare = here.replace(/^https?:\/\//, '');
  return [
    {label: 'Open in MetaMask', href: 'https://metamask.app.link/dapp/' + bare},
    {label: 'Open in Coinbase Wallet', href: 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(here)},
  ];
}

export const CHAIN_HEX = '0x' + CHAIN_ID.toString(16);

export async function switchChain(eth: any): Promise<void> {
  try {
    await eth.request({method: 'wallet_switchEthereumChain', params: [{chainId: CHAIN_HEX}]});
  } catch (e: any) {
    // 4902: the wallet doesn't know this chain yet (e.g. Base), so add it
    if (e && (e.code === 4902 || e?.data?.originalError?.code === 4902)) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_HEX,
          chainName: CHAIN_NAME,
          nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
          rpcUrls: [RPC_URL.split(',')[0].trim()],
          blockExplorerUrls: EXPLORER ? [EXPLORER] : [],
        }],
      });
    } else {
      throw e;
    }
  }
}
