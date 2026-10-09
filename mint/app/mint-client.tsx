'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createWalletClient, custom, formatEther} from 'viem';
import {readSaleConfig1155, type SaleConfig1155} from '@artblocks/abx-sdk';
import {chain} from '../lib/chain';
import {CHAIN_ID, CHAIN_NAME, EXPLORER, HAS_TOKEN, MINTER, TOKEN, TOKEN_ID} from '../lib/config';
import {ARTIST, ARTIST_URL, DESCRIPTION, DETAILS, EDITION_SIZE, TITLE} from '../lib/content';
import {minterAbi, tokenAbi} from '../lib/abi';
import {publicClient, readArtwork, type Live} from '../lib/meta';
import {getEthereum, isMobile, switchChain, walletLinks} from '../lib/wallet';
import Artwork from './artwork';

const ZERO = '0x0000000000000000000000000000000000000000';
const PAINT = ['#f2668b', '#23c7d9', '#48d9a4', '#f2bf27', '#26262b', '#8a8f98'];
const ID = BigInt(TOKEN_ID);

type Status = {tone: 'info' | 'ok' | 'error'; text: string; tx?: string} | null;

function eth(v: bigint): string {
  return formatEther(v) + ' ETH';
}

function copies(n: number): string {
  return n === 1 ? '1 copy' : n + ' copies';
}

// One mark per copy in the edition, filled in paint colours as copies are minted.
function Ticks({minted, total}: {minted: number; total: number}) {
  const marks = [];
  for (let i = 0; i < total; i++) {
    marks.push(<span key={i} style={i < minted ? {background: PAINT[(i * 7) % PAINT.length]} : undefined} />);
  }
  return (
    <div className="ticks" role="img" aria-label={minted + ' of ' + total + ' minted'}>
      {marks}
    </div>
  );
}

export default function Mint() {
  const [live, setLive] = useState<Live | null>(null);
  // 'wait' while we look for the token's on-chain page, so the bundled
  // preview doesn't start and then get swapped out a moment later
  const [artMode, setArtMode] = useState<'wait' | 'live' | 'preview'>(HAS_TOKEN ? 'wait' : 'preview');
  const [sale, setSale] = useState<SaleConfig1155 | null>(null);
  const [supply, setSupply] = useState(0);
  const [cap, setCap] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState('');
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [owned, setOwned] = useState<bigint>(0n);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState<'' | 'confirm' | 'pending'>('');
  const [status, setStatus] = useState<Status>(null);
  const [hasWallet, setHasWallet] = useState(true);
  const [mobile, setMobile] = useState(false);
  const accountRef = useRef('');
  accountRef.current = account;

  const refresh = useCallback(async () => {
    if (!HAS_TOKEN) return;
    const [s, ts, ms, pz] = await Promise.all([
      readSaleConfig1155(publicClient, MINTER, TOKEN, ID),
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'totalSupply', args: [ID]}),
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'maxSupply', args: [ID]}),
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'paused'}),
    ]);
    setSale(s);
    setSupply(Number(ts));
    setCap(Number(ms));
    setPaused(Boolean(pz));
    setLoaded(true);
    const who = accountRef.current;
    if (who) {
      const bal = await publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [who.toLowerCase() as `0x${string}`, ID]});
      setOwned(bal as bigint);
    }
  }, []);

  // Sale state now, then every 20 s so the count stays live in the room.
  useEffect(() => {
    if (!HAS_TOKEN) return;
    refresh().catch(() => setStatus({tone: 'error', text: 'Couldn’t read the sale from ' + CHAIN_NAME + '. Reload the page to try again.'}));
    const t = setInterval(() => refresh().catch(() => {}), 20000);
    return () => clearInterval(t);
  }, [refresh]);

  // The token's own on-chain page, once there is one to read; the bundled
  // preview before the first mint or if it can't be read.
  useEffect(() => {
    if (artMode !== 'wait' || !loaded) return;
    if (supply === 0) {
      setArtMode('preview');
      return;
    }
    let done = false;
    const giveUp = setTimeout(() => {
      if (!done) setArtMode('preview');
    }, 10000);
    readArtwork()
      .then((a) => {
        if (done) return;
        if (a.live) {
          setLive(a.live);
          setArtMode('live');
        } else setArtMode('preview');
      })
      .catch(() => setArtMode('preview'))
      .finally(() => {
        done = true;
        clearTimeout(giveUp);
      });
    return () => clearTimeout(giveUp);
  }, [artMode, loaded, supply]);

  // If the sale can't be read at all, still show the piece.
  useEffect(() => {
    if (!HAS_TOKEN) return;
    const t = setTimeout(() => setArtMode((m) => (m === 'wait' ? 'preview' : m)), 12000);
    return () => clearTimeout(t);
  }, []);

  // Wallet: pick up an existing connection and follow account/network changes.
  useEffect(() => {
    setMobile(isMobile());
    const w = getEthereum();
    if (!w) {
      setHasWallet(false);
      return;
    }
    const onAccounts = (a: string[]) => {
      setAccount(a[0] || '');
      setOwned(0n);
    };
    const onChain = (c: string) => setWalletChain(parseInt(c, 16));
    w.request({method: 'eth_accounts'}).then(onAccounts).catch(() => {});
    w.request({method: 'eth_chainId'}).then(onChain).catch(() => {});
    w.on?.('accountsChanged', onAccounts);
    w.on?.('chainChanged', onChain);
    return () => {
      w.removeListener?.('accountsChanged', onAccounts);
      w.removeListener?.('chainChanged', onChain);
    };
  }, []);

  useEffect(() => {
    if (account) refresh().catch(() => {});
  }, [account, refresh]);

  const total = cap > 0 ? cap : EDITION_SIZE;
  const left = useMemo(() => {
    if (!sale) return 0;
    const bySale = Number(sale.allocation - sale.sold);
    const byCap = cap > 0 ? cap - supply : Infinity;
    return Math.max(0, Math.min(bySale, byCap));
  }, [sale, cap, supply]);
  const isEth = !sale || sale.paymentToken === ZERO;
  const onSale = HAS_TOKEN && !!sale && sale.configured && isEth;
  const soldOut = onSale && left <= 0;
  const wrongChain = !!account && walletChain !== null && walletChain !== CHAIN_ID;
  const q = Math.max(1, Math.min(qty, Math.max(1, left)));
  const totalPrice = sale ? sale.price * BigInt(q) : 0n;

  async function connect() {
    const w = getEthereum();
    if (!w) {
      setStatus({tone: 'info', text: mobile ? 'Open this page in your wallet app to mint.' : 'No browser wallet found. Install MetaMask or another Ethereum wallet, then reload.'});
      return;
    }
    setStatus(null);
    try {
      const accts = (await w.request({method: 'eth_requestAccounts'})) as string[];
      setAccount(accts[0] || '');
      const c = (await w.request({method: 'eth_chainId'})) as string;
      setWalletChain(parseInt(c, 16));
      if (parseInt(c, 16) !== CHAIN_ID) await switchChain(w);
    } catch (e: any) {
      if (e && e.code === 4001) return; // closed the wallet prompt
      setStatus({tone: 'error', text: (e && (e.shortMessage || e.message)) || String(e)});
    }
  }

  async function changeChain() {
    try {
      await switchChain(getEthereum());
    } catch (e: any) {
      if (e && e.code === 4001) return;
      setStatus({tone: 'error', text: 'Switch your wallet to ' + CHAIN_NAME + ' to mint.'});
    }
  }

  async function mint() {
    if (!sale) return;
    const w = getEthereum();
    setStatus(null);
    setBusy('confirm');
    try {
      // lower-case: valid for viem whatever checksum casing the wallet used
      const from = account.toLowerCase() as `0x${string}`;
      const wallet = createWalletClient({account: from, chain, transport: custom(w)});
      // Commits to the price on screen: if the sale is re-priced mid-click the
      // minter reverts SaleTermsChanged and nothing is charged.
      const hash = await wallet.writeContract({
        address: MINTER,
        abi: minterAbi,
        functionName: 'purchase',
        args: [TOKEN, ID, BigInt(q), sale.paymentToken, totalPrice],
        value: totalPrice,
        account: from,
        chain,
      });
      setBusy('pending');
      setStatus({tone: 'info', text: 'Minting ' + copies(q) + '…', tx: hash});
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== 'success') throw new Error('The transaction failed on-chain. Nothing was minted.');
      setStatus({tone: 'ok', text: 'Minted ' + copies(q) + '.', tx: hash});
      setQty(1);
      await refresh();
    } catch (e: any) {
      const raw = String((e && (e.message || e)) || '');
      if (e && (e.code === 4001 || /User rejected|denied/i.test(raw))) {
        setStatus(null);
      } else if (/SaleTermsChanged|WrongPayment/.test(raw)) {
        await refresh().catch(() => {});
        setStatus({tone: 'error', text: 'The price changed before your mint went through. Nothing was charged. Check the new price and mint again.'});
      } else if (/insufficient funds/i.test(raw)) {
        setStatus({tone: 'error', text: 'Not enough ETH on ' + CHAIN_NAME + ' to cover ' + eth(totalPrice) + ' plus gas.'});
      } else {
        setStatus({tone: 'error', text: (e && e.shortMessage) || raw});
      }
    } finally {
      setBusy('');
    }
  }

  // One button, labelled with exactly what it will do next.
  let action: {label: string; onClick?: () => void; disabled?: boolean};
  if (!HAS_TOKEN) action = {label: 'Not on sale yet', disabled: true};
  else if (!loaded) action = {label: 'Loading sale…', disabled: true};
  else if (!sale || !sale.configured) action = {label: 'Not on sale yet', disabled: true};
  else if (!isEth) action = {label: 'Unsupported payment token', disabled: true};
  else if (soldOut) action = {label: 'Sold out', disabled: true};
  else if (paused) action = {label: 'Sale paused', disabled: true};
  else if (!account) action = {label: 'Connect wallet', onClick: connect};
  else if (wrongChain) action = {label: 'Switch to ' + CHAIN_NAME, onClick: changeChain};
  else if (busy === 'confirm') action = {label: 'Confirm in your wallet…', disabled: true};
  else if (busy === 'pending') action = {label: 'Minting…', disabled: true};
  else action = {label: 'Mint ' + copies(q) + ' for ' + eth(totalPrice), onClick: mint};

  const showOpenIn = !hasWallet && mobile && onSale && !soldOut && !paused;
  const showQty = onSale && !soldOut && !paused && !showOpenIn;

  return (
    <main className="page">
      <section className="stage">
        <Artwork mode={artMode} live={live} />
        <p className="hint">Tap for a new painting. Double-tap to use the squeegee.</p>
      </section>

      <section className="panel">
        <h1>{TITLE}</h1>
        <p className="artist">
          <a href={ARTIST_URL}>{ARTIST}</a>
        </p>

        <div className="about">
          {DESCRIPTION.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <div className="edition">
          <Ticks minted={supply} total={total} />
          <p className="count">
            <span>
              <strong>{supply}</strong> of {total} minted
            </span>
            {onSale && !soldOut ? <span className="left">{left} available</span> : null}
          </p>
        </div>

        <div className="buy">
          {onSale ? (
            <p className="price">
              {eth(sale!.price)} <span>each</span>
            </p>
          ) : null}

          {showQty ? (
            <div className="qty" role="group" aria-label="Number of copies">
              <button type="button" onClick={() => setQty(Math.max(1, q - 1))} disabled={q <= 1 || !!busy} aria-label="One fewer">
                −
              </button>
              <output aria-live="polite">{q}</output>
              <button type="button" onClick={() => setQty(Math.min(left, q + 1))} disabled={q >= left || !!busy} aria-label="One more">
                +
              </button>
            </div>
          ) : null}

          {showOpenIn ? (
            <div className="openin">
              {walletLinks().map((l) => (
                <a key={l.href} className="blade ghost" href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
          ) : (
            <button type="button" className="blade" onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </button>
          )}

          {status ? (
            <p className={'status ' + status.tone} role="status">
              {status.text}
              {status.tx && EXPLORER ? (
                <>
                  {' '}
                  <a href={EXPLORER + '/tx/' + status.tx} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          {account ? (
            <p className="wallet">
              Connected as {account.slice(0, 6) + '…' + account.slice(-4)}
              {owned > 0n ? ', you own ' + copies(Number(owned)) : ''}
            </p>
          ) : onSale && !soldOut ? (
            <p className="wallet">Minting needs a wallet with ETH on {CHAIN_NAME}.</p>
          ) : null}
        </div>

        <dl className="details">
          {DETAILS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Network</dt>
            <dd>{CHAIN_NAME}</dd>
          </div>
          {HAS_TOKEN ? (
            <div>
              <dt>Contract</dt>
              <dd>
                {EXPLORER ? (
                  <a href={EXPLORER + '/token/' + TOKEN} target="_blank" rel="noreferrer">
                    {TOKEN.slice(0, 6) + '…' + TOKEN.slice(-4)}
                  </a>
                ) : (
                  TOKEN.slice(0, 6) + '…' + TOKEN.slice(-4)
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    </main>
  );
}
