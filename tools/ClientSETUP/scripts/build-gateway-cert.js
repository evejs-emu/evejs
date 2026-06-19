const fs = require("fs");
const path = require("path");
let forge;
try {
  forge = require("node-forge");
} catch {
  forge = require(path.join(
    __dirname,
    "..",
    "..",
    "..",
    "server",
    "node_modules",
    "node-forge",
  ));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function ensureFileExists(filePath, label) {
  if (!filePath) {
    throw new Error(`Missing required argument: ${label}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function randomSerialNumber() {
  const hex = forge.util.bytesToHex(forge.random.getBytesSync(16));
  return hex.replace(/^0+/, "") || "01";
}

function buildGatewayCertificate(options) {
  const caCert = forge.pki.certificateFromPem(fs.readFileSync(options.caCert, "utf8"));
  const caPem = fs.readFileSync(options.caCert, "utf8").trim();
  const caKey = forge.pki.privateKeyFromPem(fs.readFileSync(options.caKey, "utf8"));
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
      altNames: [
        { type: 2, value: "dev-public-gateway.evetech.net" },
        { type: 2, value: "public-gateway.evetech.net" },
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
      ],
    },
    {
      name: "subjectKeyIdentifier",
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  ensureParentDirectory(options.outCert);
  ensureParentDirectory(options.outKey);
  fs.writeFileSync(
    options.outCert,
    `${forge.pki.certificateToPem(cert).trim()}\n${caPem}\n`,
    "utf8",
  );
  fs.writeFileSync(options.outKey, forge.pki.privateKeyToPem(keyPair.privateKey), "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureFileExists(args["ca-cert"], "--ca-cert");
  ensureFileExists(args["ca-key"], "--ca-key");

  if (!args["out-cert"]) {
    throw new Error("Missing required argument: --out-cert");
  }
  if (!args["out-key"]) {
    throw new Error("Missing required argument: --out-key");
  }

  buildGatewayCertificate({
    caCert: args["ca-cert"],
    caKey: args["ca-key"],
    outCert: args["out-cert"],
    outKey: args["out-key"],
  });
}

main();
