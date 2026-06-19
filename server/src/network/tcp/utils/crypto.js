const crypto = require("crypto");

// Standard Eve Online / MachoNet encryption seems to use AES-256-CBC
// Key is 32 bytes (256 bits)
// IV is typically zero-filled for some handshake packets or derived.
// Based on "wrong final block length", we likely need standard padding (PKCS#7 is default in Node)

function encrypt(data, key, iv) {
  if (!key) {
    throw new Error("Encryption key is missing!");
  }

  if (key.length !== 32) {
    console.warn(`[CRYPTO] Key length is ${key.length}, expected 32!`);
  }

  // Use provided IV or default to zero-filled Buffer
  const ivBuffer = iv || Buffer.alloc(16);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, ivBuffer);

  // Default checks for standard padding (PKCS7)
  cipher.setAutoPadding(true);

  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return encrypted;
}

function decrypt(data, key, iv) {
  const ivBuffer = iv || Buffer.alloc(16);

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);

  decipher.setAutoPadding(true);

  // Let errors throw so callers' try/catch blocks actually fire
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  return decrypted;
}

module.exports = { encrypt, decrypt };
