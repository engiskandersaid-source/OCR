import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/** Password hashing shared by the app and scripts/create-admin.mjs. */
const scryptAsync = /** @type {(password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>} */ (
  promisify(scrypt)
);

const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_N = 2 ** 20;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const derive = (password, salt, n, r, p, length) =>
  scryptAsync(password.normalize("NFKC"), salt, length, { N: n, r, p, maxmem: 256 * n * r });

/** @param {string} password @returns {"password_too_short" | "password_too_long" | null} */
export function passwordProblem(password) {
  if (password.length < MIN_PASSWORD_LENGTH) return "password_too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "password_too_long";
  return null;
}

/** @param {string} password @returns {Promise<string>} */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** @param {string} password @param {string} stored @returns {Promise<boolean>} */
export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  const cost = Number(n);
  if (scheme !== "scrypt" || !salt || !hash || !Number.isInteger(cost) || cost < 2 || cost > MAX_N) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), cost, Number(r), Number(p), expected.length);
  return timingSafeEqual(actual, expected);
}

let dummy;
/** Burns the same time as a real check, so unknown usernames cannot be detected. */
export async function verifyAgainstDummy(password) {
  dummy ??= hashPassword(randomUUID());
  await verifyPassword(password, await dummy);
  return false;
}
