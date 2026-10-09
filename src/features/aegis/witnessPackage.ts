import type { StoredBid } from "./protocol";

const PACKAGE_PREFIX = "AEGISBID-WITNESS-1\n";
const PBKDF2_ITERATIONS = 310_000;

export type SettlementWitnessPackage = {
  version: 1;
  tenderId: string;
  amount: string;
  salt: string;
  bidderKey: string;
};

type EncryptedPackage = {
  version: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSettlementWitness(bid: StoredBid, passphrase: string) {
  if (!bid.onChain || !bid.accepted || !bid.salt || !bid.bidderKey || !/^\d+$/.test(bid.amount)) {
    throw new Error("Only accepted live bids with complete witness data can be exported.");
  }
  if (passphrase.trim().length < 12) {
    throw new Error("Use a passphrase with at least 12 characters.");
  }
  const payload: SettlementWitnessPackage = {
    version: 1,
    tenderId: bid.tenderId,
    amount: bid.amount,
    salt: bid.salt,
    bidderKey: bid.bidderKey,
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const envelope: EncryptedPackage = {
    version: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
  return `${PACKAGE_PREFIX}${JSON.stringify(envelope)}`;
}

export async function decryptSettlementWitness(fileText: string, passphrase: string) {
  if (!passphrase) throw new Error("Enter the passphrase used to protect this witness file.");
  if (!fileText.startsWith(PACKAGE_PREFIX)) {
    throw new Error("This is not a supported AegisBid witness file.");
  }
  const envelope = JSON.parse(fileText.slice(PACKAGE_PREFIX.length)) as Partial<EncryptedPackage>;
  if (
    envelope.version !== 1 ||
    envelope.kdf !== "PBKDF2-SHA-256" ||
    envelope.iterations !== PBKDF2_ITERATIONS ||
    typeof envelope.salt !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("This witness file is incomplete or uses an unsupported format.");
  }
  const key = await deriveKey(passphrase, fromBase64(envelope.salt));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    throw new Error("The passphrase is incorrect or the witness file has been altered.");
  }
  const payload = JSON.parse(
    new TextDecoder().decode(plaintext),
  ) as Partial<SettlementWitnessPackage>;
  if (
    payload.version !== 1 ||
    typeof payload.tenderId !== "string" ||
    !/^\d+$/.test(payload.amount ?? "") ||
    typeof payload.salt !== "string" ||
    !payload.salt ||
    typeof payload.bidderKey !== "string" ||
    !payload.bidderKey
  ) {
    throw new Error("The decrypted witness data is invalid.");
  }
  return payload as SettlementWitnessPackage;
}
