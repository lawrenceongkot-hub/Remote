import { NextRequest } from 'next/server';
import {
  hashToken,
  findOperatorByApiKeyHash,
  touchApiKeyLastUsed,
  initDb,
} from '@remote-support/shared';

export interface OperatorSession {
  operatorId: string;
  operatorName: string;
}

/**
 * Validates the operator API key from the Authorization header.
 * Only the SHA-256 hash of the key is ever compared/persisted.
 */
export async function authenticateOperator(req: NextRequest): Promise<OperatorSession | null> {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const apiKey = header.slice('Bearer '.length).trim();
  if (!apiKey) return null;

  try {
    await initDb();
    const keyHash = hashToken(apiKey);
    const operator = await findOperatorByApiKeyHash(keyHash);
    if (!operator) return null;
    void touchApiKeyLastUsed(keyHash).catch(() => {});
    return { operatorId: operator.id, operatorName: operator.name };
  } catch {
    return null;
  }
}