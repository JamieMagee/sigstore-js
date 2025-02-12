/*
Copyright 2023 The Sigstore Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTrustedRoot } from '../../tuf';
import { readTarget } from '../../tuf/target';
import * as sigstore from '../../types/sigstore';

jest.mock('../../tuf/target');

describe('getTrustedRoot', () => {
  // Set-up temp dir for local TUF cache
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuf-cache-test-'));

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true });
  });

  const trustedRoot: sigstore.TrustedRoot = {
    mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    certificateAuthorities: [],
    tlogs: [],
    ctlogs: [],
    timestampAuthorities: [],
  };

  // Mock out the entire TrustedRootFetcher class since we don't want to test
  // the TUF updater here
  jest
    .mocked(readTarget)
    .mockResolvedValueOnce(
      JSON.stringify(sigstore.TrustedRoot.toJSON(trustedRoot))
    );

  it('returns the trust root', async () => {
    const root = await getTrustedRoot({ cachePath: tempDir });
    expect(root).toEqual(trustedRoot);
  });
});
