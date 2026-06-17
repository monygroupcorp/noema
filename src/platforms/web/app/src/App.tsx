import { Routes, Route } from 'react-router-dom';
import { Chat } from './screens/Chat';
import { Card } from './screens/Card';
import { Catalog } from './screens/Catalog';
import { Status } from './screens/Status';
import { Keyring } from './screens/Keyring';
import { Profile } from './screens/Profile';
import { Vault } from './screens/Vault';
import { Trace } from './screens/Trace';
import { Run } from './screens/Run';
import { Studio } from './screens/Studio';
import { Tee } from './screens/Tee';
import { Map } from './screens/Map';
import { Onboard } from './screens/Onboard';
import { Landing } from './screens/Landing';
import { Stub } from './screens/Stub';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Chat />} />
      <Route path="/card" element={<Card />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/run" element={<Run />} />
      <Route path="/canvas" element={<Stub crumb="canvas" title="Canvas" sub="Wire runs into a spell." />} />
      <Route path="/space" element={<Stub crumb="space" title="Space" sub="Your creations as a vector space." />} />
      <Route path="/trace" element={<Trace />} />
      <Route path="/keyring" element={<Keyring />} />
      <Route path="/vault" element={<Vault />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/status" element={<Status />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="/tee" element={<Tee />} />
      <Route path="/map" element={<Map />} />
      <Route path="/onboard" element={<Onboard />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="*" element={<Stub crumb="404" title="Not found" />} />
    </Routes>
  );
}
