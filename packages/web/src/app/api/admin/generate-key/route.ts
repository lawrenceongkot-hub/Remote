import { NextRequest, NextResponse } from 'next/server';
import {
  generateApiKey,
  generateOperatorId,
  hashToken,
  storeApiKey,
  createOperator,
  initDb,
} from '@remote-support/shared';
import { isAdminAuthenticated } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  try {
    if (!isAdminAuthenticated()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDb();

    const operatorId = generateOperatorId();
    await createOperator(operatorId, 'Support Operator');

    const apiKey = generateApiKey();
    const keyHash = hashToken(apiKey);
    const keyId = `key_${operatorId.replace('op_', '')}`;

    await storeApiKey(keyId, keyHash, operatorId);

    // The raw key is returned ONLY to the authenticated admin in this response.
    // Only the SHA-256 hash is persisted.
    return NextResponse.json({
      apiKey,
      operatorId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}