'use client';
import {useMemo} from 'react';
import type {Live} from '../lib/meta';
import {BASE_PATH} from '../lib/config';
import {TITLE} from '../lib/content';

// The live piece. Uses the token's own on-chain page when it can be read;
// before that, the bundled preview (same script, same p5 version).
// sandbox="allow-scripts" keeps the artwork's code away from this page and
// the visitor's wallet.
export default function Artwork({mode, live}: {mode: 'wait' | 'live' | 'preview'; live: Live | null}) {
  const props = useMemo(() => {
    if (mode === 'live' && live && live.kind === 'html') return {srcDoc: live.html};
    if (mode === 'live' && live && live.kind === 'url') return {src: live.url};
    return {src: BASE_PATH + '/preview/'};
  }, [mode, live]);
  if (mode === 'wait') return <div className="art" aria-busy="true" />;
  return (
    <div className="art">
      <iframe
        key={mode}
        {...props}
        title={TITLE + ', live artwork'}
        sandbox="allow-scripts"
        allow="fullscreen; accelerometer; gyroscope"
        loading="eager"
      />
    </div>
  );
}
