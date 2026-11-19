import * as argon2 from 'argon2';

export function hashPassword(password: string): Promise<string> {
  const timeCost = process.env.NODE_ENV === 'production' ? 3 : 2;
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost,
    parallelism: 1,
  });
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}
