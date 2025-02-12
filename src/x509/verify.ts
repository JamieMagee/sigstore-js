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
import { VerificationError } from '../error';
import { x509Certificate } from './cert';

interface VerifyCertificateChainOptions {
  trustedCerts: x509Certificate[];
  certs: x509Certificate[];
  validAt?: Date;
}

export function verifyCertificateChain(
  opts: VerifyCertificateChainOptions
): x509Certificate[] {
  const verifier = new CertificateChainVerifier(opts);
  return verifier.verify();
}

class CertificateChainVerifier {
  private certs: x509Certificate[];
  private trustedCerts: x509Certificate[];
  private localCerts: x509Certificate[];
  private validAt: Date;

  constructor(opts: VerifyCertificateChainOptions) {
    this.certs = opts.certs;
    this.trustedCerts = opts.trustedCerts;
    this.localCerts = dedupeCertificates([...opts.trustedCerts, ...opts.certs]);
    this.validAt = opts.validAt || new Date();
  }

  public verify(): x509Certificate[] {
    if (this.certs.length === 0) {
      throw new VerificationError('No certificates provided');
    }

    // Construct certificate path from leaf to root
    const certificatePath = this.sort();

    // Perform validation checks on each certificate in the path
    this.checkPath(certificatePath);

    // Return verified certificate path
    return certificatePath;
  }

  private sort(): x509Certificate[] {
    const leafCert = this.localCerts[this.localCerts.length - 1];

    // Construct all possible paths from the leaf
    let paths = this.buildPaths(leafCert);

    // Filter for paths which contain a trusted certificate
    paths = paths.filter((path) =>
      path.some((cert) => this.trustedCerts.includes(cert))
    );

    if (paths.length === 0) {
      throw new VerificationError('No trusted certificate path found');
    }

    // Find the shortest of possible paths
    const path = paths.reduce((prev, curr) =>
      prev.length < curr.length ? prev : curr
    );

    // Construct chain from shortest path
    return [leafCert, ...path];
  }

  // Recursively build all possible paths from the leaf to the root
  private buildPaths(certificate: x509Certificate): x509Certificate[][] {
    const paths = [];
    const issuers = this.findIssuer(certificate);

    if (issuers.length === 0) {
      throw new VerificationError('No valid certificate path found');
    }

    for (let i = 0; i < issuers.length; i++) {
      const issuer = issuers[i];

      // Base case - issuer is self
      if (issuer.equals(certificate)) {
        paths.push([certificate]);
        continue;
      }

      // Recursively build path for the issuer
      const subPaths = this.buildPaths(issuer);

      // Construct paths by appending the issuer to each subpath
      for (let j = 0; j < subPaths.length; j++) {
        paths.push([issuer, ...subPaths[j]]);
      }
    }

    return paths;
  }

  // Return all possible issuers for the given certificate
  private findIssuer(certificate: x509Certificate): x509Certificate[] {
    let issuers: x509Certificate[] = [];
    let keyIdentifier: Buffer | undefined;

    // Exit early if the certificate is self-signed
    if (certificate.subject.equals(certificate.issuer)) {
      if (certificate.verify()) {
        return [certificate];
      }
    }

    // If the certificate has an authority key identifier, use that
    // to find the issuer
    if (certificate.extAuthorityKeyID) {
      keyIdentifier = certificate.extAuthorityKeyID.keyIdentifier;

      // TODO: Add support for authorityCertIssuer/authorityCertSerialNumber
      // though Fulcio doesn't appear to use these
    }

    // Find possible issuers by comparing the authorityKeyID/subjectKeyID
    // or issuer/subject. Potential issuers are added to the result array.
    this.localCerts.forEach((possibleIssuer) => {
      if (keyIdentifier) {
        if (possibleIssuer.extSubjectKeyID) {
          if (
            possibleIssuer.extSubjectKeyID.keyIdentifier.equals(keyIdentifier)
          ) {
            issuers.push(possibleIssuer);
          }
          return;
        }
      }

      // Fallback to comparing certificate issuer and subject if
      // subjectKey/authorityKey extensions are not present
      if (possibleIssuer.subject.equals(certificate.issuer)) {
        issuers.push(possibleIssuer);
      }
    });

    // Remove any issuers which fail to verify the certificate
    issuers = issuers.filter((issuer) => {
      try {
        return certificate.verify(issuer);
      } catch (ex) {
        return false;
      }
    });

    return issuers;
  }

  private checkPath(path: x509Certificate[]): void {
    if (path.length < 2) {
      throw new VerificationError(
        'Certificate chain must contain at least two certificates'
      );
    }

    // Check that all certificates are valid at the check date
    const validForDate = path.every((cert) => cert.validForDate(this.validAt));
    if (!validForDate) {
      throw new VerificationError(
        'Certificate is not valid or expired at the specified date'
      );
    }

    // Ensure that all certificates beyond the leaf are CAs
    const validCAs = path.slice(1).every((cert) => cert.isCA);
    if (!validCAs) {
      throw new VerificationError('Intermediate certificate is not a CA');
    }

    // Certificate's issuer must match the subject of the next certificate
    // in the chain
    for (let i = path.length - 2; i >= 0; i--) {
      if (!path[i].issuer.equals(path[i + 1].subject)) {
        throw new VerificationError('Incorrect certificate name chaining');
      }
    }
  }
}

// Remove duplicate certificates from the array
function dedupeCertificates(certs: x509Certificate[]): x509Certificate[] {
  for (let i = 0; i < certs.length; i++) {
    for (let j = i + 1; j < certs.length; j++) {
      if (certs[i].equals(certs[j])) {
        certs.splice(j, 1);
        j--;
      }
    }
  }
  return certs;
}
