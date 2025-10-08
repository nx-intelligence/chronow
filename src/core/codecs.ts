import { createHash } from 'crypto';

/**
 * Encode JSON value to Buffer with size guard
 */
export function encodeJson(value: any, maxBytes: number = 256 * 1024): Buffer {
  const json = JSON.stringify(value);
  const buf = Buffer.from(json, 'utf-8');
  if (buf.length > maxBytes) {
    throw new Error(`Value exceeds max size: ${buf.length} > ${maxBytes} bytes`);
  }
  return buf;
}

/**
 * Decode Buffer to JSON value
 */
export function decodeJson<T = any>(buf: Buffer | string): T {
  const str = typeof buf === 'string' ? buf : buf.toString('utf-8');
  return JSON.parse(str);
}

/**
 * Compute SHA-256 hash of a value
 */
export function hashValue(value: any): string {
  const json = JSON.stringify(value);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Convert object to flat key-value array for Redis XADD/HSET
 */
export function toFlatArray(obj: Record<string, any>): string[] {
  const arr: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    arr.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return arr;
}

/**
 * Parse flat array from Redis into object
 */
export function fromFlatArray(arr: string[]): Record<string, any> {
  const obj: Record<string, any> = {};
  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const val = arr[i + 1];
    // Try to parse as JSON, fallback to string
    try {
      obj[key] = JSON.parse(val);
    } catch {
      obj[key] = val;
    }
  }
  return obj;
}

