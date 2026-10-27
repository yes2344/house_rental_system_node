import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(pbkdf2);
const djangoPbkdf2Iterations = 1_000_000;
const dummyPasswordHash = hashPassword('unusable-account-password');

export async function hashPassword(password) {
  const salt = randomBytes(12).toString('base64url');
  const hash = await deriveKey(password, salt, djangoPbkdf2Iterations, 32, 'sha256');
  return `pbkdf2_sha256$${djangoPbkdf2Iterations}$${salt}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, iterationsText, salt, encodedHash, ...extra] = String(encoded || '').split('$');
  const iterations = Number(iterationsText);
  if (
    algorithm !== 'pbkdf2_sha256'
    || !Number.isSafeInteger(iterations)
    || iterations < 1
    || iterations > 10_000_000
    || !salt
    || !encodedHash
    || extra.length
  ) {
    return false;
  }

  let expected;
  try {
    expected = Buffer.from(encodedHash, 'base64');
  } catch {
    return false;
  }
  if (expected.length !== 32 || expected.toString('base64') !== encodedHash) return false;

  const actual = await deriveKey(password, salt, iterations, expected.length, 'sha256');
  return timingSafeEqual(actual, expected);
}

export async function verifyUnknownPassword(password) {
  return verifyPassword(password, await dummyPasswordHash);
}
