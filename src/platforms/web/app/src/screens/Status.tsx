import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';

interface Entry { when: string; entry: string; detail: string; delta: number; balance: number }

const LEDGER: Entry[] = [
  { when: 'today 14:02', entry: 'spend', detail: 'make · flux-schnell', delta: -43, balance: 214 },
  { when: 'today 11:20', entry: 'spend', detail: 'animate · ltx-video', delta: -120, balance: 257 },
  { when: 'yesterday', entry: 'deposit', detail: 'eth → credits', delta: 300, balance: 377 },
  { when: '2d ago', entry: 'reward', detail: 'referral', delta: 25, balance: 77 },
  { when: '3d ago', entry: 'spend', detail: 'make · flux-schnell', delta: -88, balance: 52 },
  { when: '4d ago', entry: 'spend', detail: 'describe · joycaption', delta: -60, balance: 140 },
  { when: '5d ago', entry: 'deposit', detail: 'eth → credits', delta: 200, balance: 200 },
];

const QUOTES = [
  { flow: 'make · flux-schnell', when: 'just now', cost: '≈ $0.043' },
  { flow: 'animate · ltx-video', when: '2h ago', cost: '≈ $0.12' },
  { flow: 'make · hunyuan3d', when: 'yesterday', cost: '≈ $0.08' },
];

export function Status() {
  const { ident } = useIdentity();

  return (
    <AppShell crumb="account">
      <div className="page"><div className="pw">
        <div className="pagehead"><div><h1>Account</h1><div className="sub">{ident.name} · {ident.role}</div></div></div>

        <div className="stats">
          <div className="stat"><div className="l">Balance</div><div className="n">214</div><div className="d">credits · ≈ $0.92</div></div>
          <div className="stat"><div className="l">Spent this month</div><div className="n">$14.20</div><div className="d">47 runs</div></div>
          <div className="stat"><div className="l">Runs</div><div className="n">312</div><div className="d">all time</div></div>
        </div>

        <div className="sectionhead">Ledger</div>
        <table className="tbl">
          <thead>
            <tr><th>When</th><th>Entry</th><th>Detail</th><th>Δ</th><th>Balance</th></tr>
          </thead>
          <tbody>
            {LEDGER.map((e, i) => (
              <tr key={i}>
                <td>{e.when}</td>
                <td>{e.entry}</td>
                <td>{e.detail}</td>
                <td className={`v ${e.delta >= 0 ? 'pos' : 'neg'}`}>{e.delta >= 0 ? '+' : ''}{e.delta}</td>
                <td className="v">{e.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sectionhead">Recent quotes</div>
        <div className="list">
          {QUOTES.map((q, i) => (
            <div className="lrow" key={i}>
              <div className="li-main"><div className="t">{q.flow}</div><div className="s">{q.when}</div></div>
              <div className="li-right">{q.cost}</div>
            </div>
          ))}
        </div>
      </div></div>
    </AppShell>
  );
}
