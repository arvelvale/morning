/**
 * 会话凭据安全存储。
 *
 * AssetStoreKit 由系统负责加密和访问隔离；这里只保存 token JSON，不在日志中输出明文。
 */
import { asset } from '@kit.AssetStoreKit';

const TOKEN_ALIAS = 'morning.session.tokens';

function toBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function fromBytes(bytes: Uint8Array): string {
  let value = '';
  for (let index = 0; index < bytes.length; index++) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function aliasQuery(): asset.AssetMap {
  const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
  query.set(asset.Tag.ALIAS, toBytes(TOKEN_ALIAS));
  return query;
}

export async function readSecureTokens(): Promise<string | null> {
  try {
    const query = aliasQuery();
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    const results = await asset.query(query);
    if (results.length === 0) {
      return null;
    }
    const secret = results[0].get(asset.Tag.SECRET);
    if (secret instanceof Uint8Array) {
      return fromBytes(secret);
    }
  } catch {
    // 未登录过时 AssetStore 会返回“未找到”，按空会话处理。
  }
  return null;
}

export async function writeSecureTokens(raw: string): Promise<void> {
  const attributes: asset.AssetMap = aliasQuery();
  attributes.set(asset.Tag.SECRET, toBytes(raw));
  attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
  try {
    await asset.add(attributes);
  } catch {
    throw new Error('会话凭据安全存储失败');
  }
}

export async function removeSecureTokens(): Promise<void> {
  try {
    await asset.remove(aliasQuery());
  } catch {
    // 清理动作需要幂等：从未登录或已经退出时不向上抛错。
  }
}
