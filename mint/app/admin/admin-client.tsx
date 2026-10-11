'use client';
import {useCallback, useEffect, useState} from 'react';
import {createWalletClient, custom, formatEther} from 'viem';
import {readSaleConfig1155, type SaleConfig1155} from '@artblocks/abx-sdk';
import {chain} from '../../lib/chain';
import {CHAIN_ID, CHAIN_NAME, EXPLORER, HAS_TOKEN, MINTER, TOKEN, TOKEN_ID} from '../../lib/config';
import {TITLE} from '../../lib/content';
import {tokenAbi} from '../../lib/abi';
import {publicClient} from '../../lib/meta';
import {getEthereum, switchChain} from '../../lib/wallet';

// Owner controls for the sale. The page itself is public, but the contract
// only accepts setPaused from the owner wallet, so anyone else just sees status.
const ID = BigInt(TOKEN_ID);

type Status = {tone: 'info' | 'ok' | 'error'; text: string; tx?: string} | null;

function short(a: string): string {
  return a.slice(0, 6) + '…' + a.slice(-4);
}

export default function Admin() {
  const [owner, setOwner] = useState('');
  const [paused, setPaused] = useState<boolean | null>(null);
  const [supply, setSupply] = useState(0);
  const [cap, setCap] = useState(0);
  const [sale, setSale] = useState<SaleConfig1155 | null>(null);
  const [account, setAccount] = useState('');
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'confirm' | 'pending'>('');
  const [status, setStatus] = useState<Status>(null);

  const refresh = useCallback(async () => {
    if (!HAS_TOKEN) return;
    const [o, pz, ts, ms, s] = await Promise.all([
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'owner'}),
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'paused'}),
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'totalSupply', args: [ID]}),
      publicClient.readContract({address: TOKEN, abi: tokenAbi, functionName: 'maxSupply', args: [ID]}),
      readSaleConfig1155(publicClient, MINTER, TOKEN, ID).catch(() => null),
    ]);
    setOwner(String(o));
    setPaused(Boolean(pz));
    setSupply(Number(ts));
    setCap(Number(ms));
    setSale(s);
  }, []);

  useEffect(() => {
    if (!HAS_TOKEN) return;
    refresh().catch(() => setStatus({tone: 'error', text: 'Couldn’t read the contract on ' + CHAIN_NAME + '.'}));
    const t = setInterval(() => refresh().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const w = getEthereum();
    if (!w) return;
    const onAccounts = (a: string[]) => setAccount(a[0] || '');
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

  const isOwner = !!account && !!owner && account.toLowerCase() === owner.toLowerCase();
  const wrongChain = !!account && walletChain !== null && walletChain !== CHAIN_ID;

  async function connect() {
    const w = getEthereum();
    if (!w) {
      setStatus({tone: 'info', text: 'No browser wallet found. Open this page with the owner wallet installed.'});
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
      if (e && e.code === 4001) return;
      setStatus({tone: 'error', text: (e && (e.shortMessage || e.message)) || String(e)});
    }
  }

  async function toggle() {
    if (paused === null) return;
    const next = !paused;
    setStatus(null);
    setBusy('confirm');
    try {
      const from = account.toLowerCase() as `0x${string}`;
      const wallet = createWalletClient({account: from, chain, transport: custom(getEthereum())});
      const hash = await wallet.writeContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: 'setPaused',
        args: [next],
        account: from,
        chain,
      });
      setBusy('pending');
      setStatus({tone: 'info', text: next ? 'Turning the mint off…' : 'Turning the mint on…', tx: hash});
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== 'success') throw new Error('The transaction failed on-chain. Nothing changed.');
      setStatus({tone: 'ok', text: next ? 'Mint is off.' : 'Mint is on.', tx: hash});
      await refresh();
    } catch (e: any) {
      const raw = String((e && (e.message || e)) || '');
      if (e && (e.code === 4001 || /User rejected|denied/i.test(raw))) setStatus(null);
      else setStatus({tone: 'error', text: (e && e.shortMessage) || raw});
    } finally {
      setBusy('');
    }
  }

  const saleReady = !!sale && sale.configured;
  const live = paused === false && saleReady;

  let action: {label: string; onClick?: () => void; disabled?: boolean};
  if (!HAS_TOKEN) action = {label: 'No contract set', disabled: true};
  else if (paused === null) action = {label: 'Loading…', disabled: true};
  else if (!account) action = {label: 'Connect owner wallet', onClick: connect};
  else if (wrongChain) action = {label: 'Switch to ' + CHAIN_NAME, onClick: () => switchChain(getEthereum()).catch(() => {})};
  else if (!isOwner) action = {label: 'Not the owner wallet', disabled: true};
  else if (busy === 'confirm') action = {label: 'Confirm in your wallet…', disabled: true};
  else if (busy === 'pending') action = {label: 'Waiting for the transaction…', disabled: true};
  else action = {label: paused ? 'Turn mint ON' : 'Turn mint OFF', onClick: toggle};

  return (
    <main className="page admin">
      <section className="panel">
        <h1>{TITLE} admin</h1>

        <p className={'switch ' + (live ? 'on' : 'off')}>
          {paused === null ? 'Reading…' : live ? 'Mint is ON' : paused ? 'Mint is OFF' : 'Unpaused, but no sale configured'}
        </p>

        <button type="button" className="blade" onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </button>

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

        {account ? <p className="wallet">Connected as {short(account)}{isOwner ? ' (owner)' : ''}</p> : null}

        <dl className="details">
          <div>
            <dt>Minted</dt>
            <dd>
              {supply} of {cap || '—'}
            </dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{saleReady ? formatEther(sale!.price) + ' ETH' : 'Not configured'}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{CHAIN_NAME}</dd>
          </div>
          {HAS_TOKEN ? (
            <div>
              <dt>Contract</dt>
              <dd>
                {EXPLORER ? (
                  <a href={EXPLORER + '/address/' + TOKEN} target="_blank" rel="noreferrer">
                    {short(TOKEN)}
                  </a>
                ) : (
                  short(TOKEN)
                )}
              </dd>
            </div>
          ) : null}
          {owner ? (
            <div>
              <dt>Owner</dt>
              <dd>{short(owner)}</dd>
            </div>
          ) : null}
        </dl>

        <p className="wallet">
          Turning the mint off pauses the contract, so only the owner can mint until it’s turned back on. Each switch is
          one transaction from the owner wallet.
        </p>
      </section>
    </main>
  );
}
