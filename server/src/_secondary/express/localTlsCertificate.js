"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const forge = require("node-forge");

const ROOT_DIR = path.resolve(__dirname, "../../../..");
const CA_CERT_PATH = path.join(ROOT_DIR, "server", "certs", "xmpp-ca-cert.pem");
const CA_KEY_PATH = path.join(ROOT_DIR, "server", "certs", "xmpp-ca-key.pem");

const LOCAL_TLS_DNS_ALT_NAMES = Object.freeze([
  "dev-public-gateway.evetech.net",
  "public-gateway.evetech.net",
  "localhost",
]);
const LOCAL_TLS_IP_ALT_NAMES = Object.freeze(["127.0.0.1"]);

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function randomSerialNumber() {
  const hex = forge.util.bytesToHex(forge.random.getBytesSync(16));
  return hex.replace(/^0+/, "") || "01";
}

function buildSubjectAltNames() {
  return [
    ...LOCAL_TLS_DNS_ALT_NAMES.map((value) => ({ type: 2, value })),
    ...LOCAL_TLS_IP_ALT_NAMES.map((ip) => ({ type: 7, ip })),
  ];
}

function buildLocalLeafCertificate(options) {
  const caCert = forge.pki.certificateFromPem(
    fs.readFileSync(options.caCertPath, "utf8"),
  );
  const caPem = fs.readFileSync(options.caCertPath, "utf8").trim();
  const caKey = forge.pki.privateKeyFromPem(
    fs.readFileSync(options.caKeyPath, "utf8"),
  );
  const keyPair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime());
  notAfter.setFullYear(notAfter.getFullYear() + 10);

  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  cert.setSubject([
    {
      name: "commonName",
      value: "dev-public-gateway.evetech.net",
    },
  ]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: false,
      critical: true,
    },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      critical: true,
    },
    {
      name: "subjectAltName",
      altNames: buildSubjectAltNames(),
    },
    {
      name: "subjectKeyIdentifier",
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  ensureParentDirectory(options.outCertPath);
  ensureParentDirectory(options.outKeyPath);
  fs.writeFileSync(
    options.outCertPath,
    `${forge.pki.certificateToPem(cert).trim()}\n${caPem}\n`,
    "utf8",
  );
  fs.writeFileSync(
    options.outKeyPath,
    forge.pki.privateKeyToPem(keyPair.privateKey),
    "utf8",
  );
}

function parseSubjectAltNames(certPem) {
  try {
    const x509 = new crypto.X509Certificate(certPem);
    const dnsNames = new Set();
    const ipAddresses = new Set();

    for (const entry of String(x509.subjectAltName || "").split(",")) {
      const normalized = entry.trim();
      if (normalized.startsWith("DNS:")) {
        dnsNames.add(normalized.slice(4).trim().toLowerCase());
      } else if (normalized.startsWith("IP Address:")) {
        ipAddresses.add(normalized.slice("IP Address:".length).trim());
      }
    }

    return { dnsNames, ipAddresses };
  } catch {
    return {
      dnsNames: new Set(),
      ipAddresses: new Set(),
    };
  }
}

function hasRequiredAltNames(certPem) {
  const { dnsNames, ipAddresses } = parseSubjectAltNames(certPem);
  return (
    dnsNames.size === LOCAL_TLS_DNS_ALT_NAMES.length &&
    ipAddresses.size === LOCAL_TLS_IP_ALT_NAMES.length &&
    LOCAL_TLS_DNS_ALT_NAMES.every((name) =>
      dnsNames.has(String(name).toLowerCase()),
    ) &&
    LOCAL_TLS_IP_ALT_NAMES.every((ip) => ipAddresses.has(ip))
  );
}

function ensureLocalLeafCertificate(options = {}) {
  const certDir = options.certDir || path.join(__dirname, "certs");
  const outCertPath =
    options.outCertPath || path.join(certDir, "gateway-dev-cert.pem");
  const outKeyPath =
    options.outKeyPath || path.join(certDir, "gateway-dev-key.pem");
  const caCertPath = options.caCertPath || CA_CERT_PATH;
  const caKeyPath = options.caKeyPath || CA_KEY_PATH;

  if (
    fs.existsSync(outCertPath) &&
    fs.existsSync(outKeyPath) &&
    hasRequiredAltNames(fs.readFileSync(outCertPath, "utf8"))
  ) {
    return {
      outCertPath,
      outKeyPath,
      rebuilt: false,
    };
  }

  buildLocalLeafCertificate({
    caCertPath,
    caKeyPath,
    outCertPath,
    outKeyPath,
  });

  return {
    outCertPath,
    outKeyPath,
    rebuilt: true,
  };
}

module.exports = {
  CA_CERT_PATH,
  CA_KEY_PATH,
  LOCAL_TLS_DNS_ALT_NAMES,
  LOCAL_TLS_IP_ALT_NAMES,
  buildLocalLeafCertificate,
  ensureLocalLeafCertificate,
  hasRequiredAltNames,
};
