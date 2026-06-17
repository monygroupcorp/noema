import { useRef, useState, type ReactNode } from 'react';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { Ic } from '../lib/icons';

interface Msg { who: 'concierge' | 'you'; body: ReactNode }

const SEED: Msg[] = [
  { who: 'concierge', body: (
    <>What are we making? Describe it however you like — I’ll pick the tools and walk you through.
      Try <span className="verb">make</span> a scene, <span className="verb">chat</span> through an idea, or just say what you’re after.</>
  ) },
  { who: 'you', body: 'a low-poly n64-style dragon perched on a neon temple, dusk' },
  { who: 'concierge', body: (
    <>Running <span className="verb">make</span> on <span className="mono">flux-schnell</span>. Quote was <span className="mono">$0.043</span> — here it comes.
      <div className="gen">
        <div className="ph"><span className="dots"><span /><span /><span /></span></div>
        <div className="cap"><span>generating</span><span className="mono">· stage 2/3 · 6s</span></div>
      </div>
    </>
  ) },
];

export function Chat() {
  const { ident } = useIdentity();
  const [msgs, setMsgs] = useState<Msg[]>(SEED);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function send() {
    const v = taRef.current?.value.trim();
    if (!v) return;
    setMsgs((m) => [
      ...m,
      { who: 'you', body: v },
      { who: 'concierge', body: <>Reading that as <span className="verb">make</span> — quoting… <span className="dots"><span /><span /><span /></span></> },
    ]);
    if (taRef.current) { taRef.current.value = ''; taRef.current.style.height = 'auto'; }
  }

  return (
    <AppShell crumb="chat" concierge={false}>
      <div className="thread"><div className="wrap">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who === 'you' ? 'user' : 'bot'}`}>
            <div className="av" />
            <div><div className="who">{m.who}</div><div className="body">{m.body}</div></div>
          </div>
        ))}
      </div></div>
      <div className="composer">
        <div className="box">
          <textarea
            ref={taRef} rows={1} placeholder="Describe what you want to make…"
            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="send" onClick={send}><Ic name="arrow-up" /></button>
        </div>
        <div className="hint">
          <span className="dest" dangerouslySetInnerHTML={{ __html: `<span class="ttdot"></span>${ident.dest}` }} />
          <span className="keys">
            <span><span className="mono">⏎</span> send</span>
            <span><span className="mono">⇧⏎</span> newline</span>
          </span>
        </div>
      </div>
    </AppShell>
  );
}
