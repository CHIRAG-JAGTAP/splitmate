import { createHash, randomBytes, randomInt } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike chars
export const randomCode = (len = 8) => Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export interface AccessPayload { sub: string; role: 'user' | 'admin'; sid: string }
export const signAccess = (p: AccessPayload) => jwt.sign(p, env.JWT_ACCESS_SECRET, { expiresIn: `${env.ACCESS_TTL_MIN}m` });
export const verifyAccess = (t: string) => jwt.verify(t, env.JWT_ACCESS_SECRET) as AccessPayload & { exp: number };
