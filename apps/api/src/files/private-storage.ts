import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import OSS from 'ali-oss';

export class PrivateStorage {
  private readonly root: string;
  private readonly prefix: string;
  private readonly client?: OSS;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.root = resolve(env.PRIVATE_FILE_DIR ?? 'var/private-files');
    this.prefix = env.OSS_PREFIX ?? '';
    if (env.FILE_STORAGE && !['local', 'oss'].includes(env.FILE_STORAGE)) throw new Error('Invalid FILE_STORAGE');
    if (env.FILE_STORAGE !== 'oss') return;
    if (!env.OSS_BUCKET || !env.OSS_REGION || !env.OSS_ENDPOINT || !env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET
      || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(this.prefix)) throw new Error('Incomplete OSS configuration');
    const endpoint = new URL(env.OSS_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('OSS endpoint must be an HTTPS origin');
    this.client = new OSS({ bucket: env.OSS_BUCKET, region: env.OSS_REGION, endpoint: endpoint.origin,
      accessKeyId: env.OSS_ACCESS_KEY_ID, accessKeySecret: env.OSS_ACCESS_KEY_SECRET, secure: true,
      timeout: 30_000, cname: env.OSS_CNAME === 'true' });
  }

  newKey() { return this.client ? `oss:${this.prefix}${randomUUID()}` : randomUUID(); }

  canAccess(key: string) {
    if (!key.startsWith('oss:')) return /^[a-f0-9-]{36}$/.test(key);
    return !!this.client && key.startsWith(`oss:${this.prefix}`)
      && /^[a-f0-9-]{36}$/.test(key.slice(4 + this.prefix.length));
  }

  private objectName(key: string) {
    if (!this.client || !key.startsWith(`oss:${this.prefix}`) || !/^[a-f0-9-]{36}$/.test(key.slice(4 + this.prefix.length))) throw new Error('Invalid OSS object key or storage configuration');
    return key.slice(4);
  }

  private localPath(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid local object key');
    return join(this.root, key);
  }

  async put(key: string, bytes: Buffer, mimeType: string) {
    if (key.startsWith('oss:')) {
      const name = this.objectName(key);
      await this.client!.put(name, bytes, { mime: mimeType, headers: { 'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true', 'Cache-Control': 'no-store' } });
      return;
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await writeFile(this.localPath(key), bytes, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    if (!key.startsWith('oss:')) return readFile(this.localPath(key));
    const name = this.objectName(key);
    const result = await this.client!.get(name);
    return Buffer.from(result.content);
  }

  async remove(key: string) {
    try {
      if (key.startsWith('oss:')) {
        const name = this.objectName(key);
        await this.client!.delete(name);
      }
      else await unlink(this.localPath(key));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT' && code !== 'NoSuchKey') throw error;
    }
  }
}
