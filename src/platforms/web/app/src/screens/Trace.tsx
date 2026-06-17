import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';

const SIMILAR_THUMBS = [
  'linear-gradient(150deg,#1a1340,#0c1a1c 70%)',
  'linear-gradient(150deg,#2a1030,#0c1a1c 70%)',
  'linear-gradient(150deg,#101a30,#0c1a1c 70%)',
];

const TAGS = ['dragon', 'neon', 'dusk', 'lowpoly'];

export function Trace() {
  const { ident } = useIdentity();

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Similar in your space</div>
        <div style={{ display: 'flex', gap: 'var(--s2)' }}>
          {SIMILAR_THUMBS.map((bg, i) => (
            <span
              key={i}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                border: '1px solid var(--hair)',
                flex: '0 0 auto',
                background: bg,
                display: 'block',
              }}
            />
          ))}
        </div>
        <div style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)' }}>
          by image embedding
        </div>
      </div>
      <div className="csec">
        <div className="ctitle">Account</div>
        <div className="meta-line">
          <span>balance</span>
          <span className="v mono">{ident.bal ?? '214 credits'}</span>
        </div>
      </div>
    </>
  );

  return (
    <AppShell crumb={<>space <span className="sep">/</span> trace</>} context={context}>
      <div className="page">
        <div className="pw">

          <div className="pagehead">
            <div>
              <h1>a low-poly n64-style dragon perched on a neon temple, dusk</h1>
              <div className="sub mono">Creation · made 2d ago</div>
            </div>
          </div>

          {/* main image block */}
          <div style={{
            width: '100%',
            height: 360,
            border: '1px solid var(--hair)',
            borderRadius: 'var(--radius)',
            background: 'linear-gradient(150deg,#1a1340,#0c1a1c 70%)',
          }} />

          <div className="sectionhead">Lineage</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <span className="pill">make</span>
            <span style={{ color: 'var(--faint)', fontSize: 12 }}>→</span>
            <span className="pill">flux-schnell</span>
            <span style={{ color: 'var(--faint)', fontSize: 12 }}>→</span>
            <span className="pill mono">seed 428193044</span>
          </div>

          <div className="sectionhead">Details</div>
          <div style={{
            border: '1px solid var(--hair)',
            borderRadius: 'var(--radius)',
            background: 'var(--panel)',
            padding: '4px 15px',
          }}>
            <div className="meta-line"><span>model</span><span className="v mono">flux-schnell</span></div>
            <div className="meta-line"><span>seed</span><span className="v mono">428193044</span></div>
            <div className="meta-line"><span>dimensions</span><span className="v mono">1024×1024</span></div>
            <div className="meta-line"><span>runtime</span><span className="v mono">comfy</span></div>
            <div className="meta-line"><span>cost</span><span className="v mono">$0.043</span></div>
          </div>

          <div className="sectionhead">Reactions</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
            <span className="pill"><Ic name="heart" /> 12</span>
            <span className="pill"><Ic name="smile" /> 4</span>
            <span className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s1)' }}>
              your rating
              <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 'var(--s1)' }}>
                <Ic name="star" />
                <Ic name="star" />
                <Ic name="star" />
                <Ic name="star" />
                <span style={{ color: 'var(--faint)', display: 'inline-flex' }}><Ic name="star" /></span>
              </span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            {TAGS.map((tag) => (
              <span key={tag} className="badge">{tag}</span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s6)', flexWrap: 'wrap' }}>
            <button className="btn">Make a variation</button>
            <button className="btn-ghost"><Ic name="sparkles" /> Add to dataset</button>
            <button className="btn-ghost"><Ic name="workflow" /> Open in Canvas</button>
          </div>

        </div>
      </div>
    </AppShell>
  );
}
