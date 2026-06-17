import CryptoJS from 'crypto-js';

export function computeFileHash(content: string | Buffer): string {
  const str = typeof content === 'string' ? content : content.toString('utf-8');
  return CryptoJS.SHA256(str).toString(CryptoJS.enc.Hex);
}

export function generateId(prefix = ''): string {
  const rand = CryptoJS.lib.WordArray.random(8).toString(CryptoJS.enc.Hex);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export function uuid(): string {
  return CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex).replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5',
  );
}
