// Background thread for asphalt generation (see asphalt-core.js).
import { generatePixels } from './asphalt-core.js';

self.onmessage = (e) => {
  const { id, o, size } = e.data;
  const r = generatePixels(o, size);
  self.postMessage({ id, ...r }, [r.albedo.buffer, r.normal.buffer, r.rough.buffer]);
};
