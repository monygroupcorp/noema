import { j } from './core';
import { authHeaders } from './session';

const storageApi = {
  // For a cost estimate before dispatching, use `quote` above (`POST /v1/runs/quote`).
  // Signed upload (R2). Returns a presigned PUT url + the permanent public url.
  signUpload: (body: { filename: string; contentType: string; bucketName?: string }) =>
    fetch('/api/v1/storage/uploads/sign', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ signedUrl: string; permanentUrl: string; key?: string }>),
};

export default storageApi;
