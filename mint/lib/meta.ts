// Reads straight from chain — no backend. The read client is the SDK's
// browser-safe makePublicClient with an explicit RPC list.
import {makePublicClient, gatewayUrlFor, resolveGatewayBase, parseDataUri} from '@artblocks/abx-sdk';
import {RPC_URL, TOKEN, TOKEN_ID} from './config';
import {tokenAbi} from './abi';

export const publicClient = makePublicClient({rpcUrls: RPC_URL.split(',').map((u) => u.trim()).filter(Boolean)});

export function toGateway(u: string): string {
  if (!u) return '';
  if (u.startsWith('ipfs://')) return gatewayUrlFor('ipfs', u.slice(7), resolveGatewayBase('ipfs'));
  if (u.startsWith('ar://')) return gatewayUrlFor('arweave', u.slice(5), resolveGatewayBase('arweave'));
  return u;
}

function decodeData(uri: string): string | null {
  const parsed = parseDataUri(uri);
  if (!parsed) return null;
  if (!parsed.base64) return decodeURIComponent(parsed.body);
  // atob gives a binary string; decode as UTF-8 so non-ASCII survives
  const bin = atob(parsed.body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function fetchJson(uri: string): Promise<any> {
  const inline = decodeData(uri);
  if (inline !== null) return JSON.parse(inline);
  const res = await fetch(toGateway(uri));
  return res.json();
}

/** How the live artwork should be shown: inline HTML (on-chain page) or a URL. */
export type Live = {kind: 'html'; html: string} | {kind: 'url'; url: string};

export interface Artwork {
  image: string;
  live: Live | null;
}

export async function readArtwork(): Promise<Artwork> {
  const uri = (await publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'uri', args: [BigInt(TOKEN_ID)]})) as string;
  const json = await fetchJson(uri.replace('{id}', BigInt(TOKEN_ID).toString(16).padStart(64, '0')));
  const anim: string = json.animation_url || '';
  let live: Live | null = null;
  if (anim) {
    const html = decodeData(anim);
    live = html !== null ? {kind: 'html', html} : {kind: 'url', url: toGateway(anim)};
  }
  return {image: toGateway(json.image || ''), live};
}
