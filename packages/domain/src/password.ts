import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_PARAMS = {
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
};

export async function hashPassword(password: string): Promise<string> {
  assertUsablePassword(password);

  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);

  return [
    'scrypt',
    SCRYPT_PARAMS.cost,
    SCRYPT_PARAMS.blockSize,
    SCRYPT_PARAMS.parallelization,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, costText, blockSizeText, parallelizationText, saltText, hashText] = parts;
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);

  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false;
  }

  const salt = Buffer.from(saltText ?? '', 'base64url');
  const expected = Buffer.from(hashText ?? '', 'base64url');
  const actual = await scryptAsync(password, salt, expected.length, { cost, blockSize, parallelization });

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function assertUsablePassword(password: string): void {
  if (password.length < 8) {
    throw new RangeError('password must be at least 8 characters');
  }
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { cost: number; blockSize: number; parallelization: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}
