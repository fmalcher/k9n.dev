/**
 * AT Protocol (standard.site) sync script.
 *
 * Creates/updates site.standard.publication and site.standard.document records
 * on the user's PDS (Personal Data Server) for Bluesky/ATProto integration.
 *
 * Usage:
 *   npm run atproto:sync
 *
 * Environment variables (via .env.local):
 *   ATPROTO_HANDLE   - Bluesky handle (e.g., k9n.dev)
 *   ATPROTO_PASSWORD - App password (create at https://bsky.app/settings/app-passwords)
 *   ATPROTO_PDS      - PDS URL (default: https://bsky.social)
 *   DRY_RUN          - Set to "true" to only preview actions without writing (default: false)
 *
 * This script:
 * 1. Authenticates with the PDS
 * 2. Creates/updates the publication record (site.standard.publication)
 * 3. Creates/updates document records for each blog post (site.standard.document)
 * 4. Writes rkeys back into blog post frontmatter automatically
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AUTHOR } from '../src/data/author';
import { BLOG_POSTS } from '../src/app/content/blog-posts.generated';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const BLOG_CONTENT_DIR = join(ROOT_DIR, 'src', 'content', 'blog');

const PDS_URL = process.env['ATPROTO_PDS'] || 'https://bsky.social';
const HANDLE = process.env['ATPROTO_HANDLE'];
const PASSWORD = process.env['ATPROTO_PASSWORD'];
const DRY_RUN = process.env['DRY_RUN'] === 'true';
const RECREATE = process.argv.includes('--recreate');

interface SessionResponse {
  did: string;
  accessJwt: string;
  refreshJwt: string;
}

interface RecordResponse {
  uri: string;
  cid: string;
}

interface ListRecordsResponse {
  records: {
    uri: string;
    cid: string;
    value: Record<string, unknown>;
  }[];
  cursor?: string;
}

/** A blob reference as embedded in a record after uploadBlob. */
interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

async function createSession(): Promise<SessionResponse> {
  const res = await fetch(`${PDS_URL}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Authentication failed: ${res.status} ${error}`);
  }

  return res.json() as Promise<SessionResponse>;
}

async function putRecord(
  session: SessionResponse,
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
): Promise<RecordResponse> {
  const res = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.putRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection,
      rkey,
      record,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`putRecord failed for ${collection}/${rkey}: ${res.status} ${error}`);
  }

  return res.json() as Promise<RecordResponse>;
}

async function deleteRecord(
  session: SessionResponse,
  collection: string,
  rkey: string,
): Promise<void> {
  const res = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.deleteRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection,
      rkey,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`deleteRecord failed for ${collection}/${rkey}: ${res.status} ${error}`);
  }
}

async function listRecords(
  session: SessionResponse,
  collection: string,
): Promise<ListRecordsResponse['records']> {
  const allRecords: ListRecordsResponse['records'] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: session.did,
      collection,
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.listRecords?${params}`, {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`listRecords failed: ${res.status} ${error}`);
    }

    const data = (await res.json()) as ListRecordsResponse;
    allRecords.push(...data.records);
    cursor = data.cursor;
  } while (cursor);

  return allRecords;
}

/** Upload a binary blob to the repo; returns the blob ref to embed in a record. */
async function uploadBlob(
  session: SessionResponse,
  bytes: Uint8Array,
  mimeType: string,
): Promise<BlobRef> {
  const res = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: bytes as unknown as BodyInit,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`uploadBlob failed: ${res.status} ${error}`);
  }

  const data = (await res.json()) as { blob: BlobRef };
  return data.blob;
}

// ─── Image helpers ───────────────────────────────────────────────────────────

/**
 * standard.site recommends the document coverImage blob stays below 1 MB.
 * Skip oversized images rather than let the PDS reject them.
 */
const MAX_COVER_BYTES = 1_000_000;

/** Guess an image MIME type from a URL or file path extension. */
function imageMimeType(source: string): string | null {
  const ext = source.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return null;
  }
}

/** Load image bytes from an http(s) URL or a local file path. */
async function loadImageBytes(source: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Cannot fetch image ${source}: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  return new Uint8Array(await readFile(source));
}

/**
 * Resolve the thumbnail header path to an absolute file path or URL.
 * - Full URLs (http/https) are returned as-is.
 * - Relative paths (e.g. "images/blog/<slug>/file.jpg") are resolved
 *   against the built output directory.
 */
function resolveImageSource(headerPath: string): string {
  if (/^https?:\/\//i.test(headerPath)) {
    return headerPath;
  }
  // Relative paths are served from the build output (dist)
  const distBrowserDir = join(ROOT_DIR, 'dist', 'k9n-dev', 'browser', 'de');
  return join(distBrowserDir, headerPath);
}

/**
 * Upload a blog post's thumbnail header image as a coverImage blob.
 * Returns the blob ref, or undefined when there is no usable image.
 * Non-fatal: a missing/oversized/broken image is logged and skipped.
 */
async function loadCoverBlob(
  session: SessionResponse,
  thumbnailHeader: string,
): Promise<BlobRef | undefined> {
  const mimeType = imageMimeType(thumbnailHeader);
  if (!mimeType) {
    return undefined;
  }

  const source = resolveImageSource(thumbnailHeader);

  try {
    const bytes = await loadImageBytes(source);
    if (bytes.byteLength > MAX_COVER_BYTES) {
      console.warn(`  ⚠ Skipping oversized cover image (${(bytes.byteLength / 1024).toFixed(0)} KB): ${thumbnailHeader}`);
      return undefined;
    }
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upload cover image (${(bytes.byteLength / 1024).toFixed(0)} KB): ${thumbnailHeader}`);
      return undefined;
    }
    return await uploadBlob(session, bytes, mimeType);
  } catch (error) {
    console.warn(
      `  ⚠ Skipping cover for ${thumbnailHeader}:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

/**
 * Generates a TID (Timestamp Identifier) for use as an rkey.
 * TIDs are 13-character base32-sortable encoded 64-bit integers.
 * Format: 53 bits microsecond timestamp + 10 bits random clock ID.
 * Alphabet: 234567abcdefghijklmnopqrstuvwxyz
 */
function generateTid(): string {
  const B32_CHARSET = '234567abcdefghijklmnopqrstuvwxyz';

  const timestampMicros = BigInt(Date.now()) * 1000n;
  const clockId = BigInt(Math.floor(Math.random() * 1024)); // 10 bits
  const tid64 = (timestampMicros << 10n) | clockId;

  // Encode as 13-character base32-sortable string
  let encoded = '';
  let value = tid64;
  for (let i = 0; i < 13; i++) {
    encoded = B32_CHARSET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }

  return encoded;
}

async function syncPublication(session: SessionResponse): Promise<void> {
  const rkey = AUTHOR.atproto.publicationRkey;

  // --recreate: delete any existing publication records with wrong rkeys
  if (RECREATE) {
    const existingPubs = await listRecords(session, 'site.standard.publication');
    for (const record of existingPubs) {
      const existingRkey = record.uri.split('/').pop()!;
      if (existingRkey !== rkey) {
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would delete old publication record: ${existingRkey}`);
        } else {
          await deleteRecord(session, 'site.standard.publication', existingRkey);
          console.log(`  ✗ Deleted old publication record: ${existingRkey}`);
        }
      }
    }
  }

  const record: Record<string, unknown> = {
    $type: 'site.standard.publication',
    url: AUTHOR.url,
    name: AUTHOR.siteName,
    description: AUTHOR.tagline.en,
    preferences: {
      showInDiscover: true,
    },
    basicTheme: {
      $type: 'site.standard.theme.basic',
      background: { $type: 'site.standard.theme.color#rgb', r: 255, g: 255, b: 255 },
      foreground: { $type: 'site.standard.theme.color#rgb', r: 26, g: 26, b: 46 },
      accent: { $type: 'site.standard.theme.color#rgb', r: 60, g: 53, b: 153 },
      accentForeground: { $type: 'site.standard.theme.color#rgb', r: 255, g: 255, b: 255 },
    },
  };

  // Upload the author profile image as the publication icon
  if (AUTHOR.image?.url) {
    const iconSource = resolveImageSource(AUTHOR.image.url);
    const iconMime = imageMimeType(iconSource);
    if (iconMime) {
      try {
        const bytes = await loadImageBytes(iconSource);
        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would upload publication icon (${(bytes.byteLength / 1024).toFixed(0)} KB): ${AUTHOR.image.url}`);
        } else {
          record['icon'] = await uploadBlob(session, bytes, iconMime);
        }
      } catch (error) {
        console.warn(
          `  ⚠ Skipping publication icon (${AUTHOR.image.url}):`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would create/update publication record:');
    console.log(`  rkey: ${rkey}`);
    console.log(`  record:`, JSON.stringify(record, null, 2));
    return;
  }

  const result = await putRecord(session, 'site.standard.publication', rkey, record);
  console.log(`✓ Publication record created/updated: ${result.uri}`);
}

async function syncDocuments(session: SessionResponse): Promise<number> {
  // Get existing document records
  const existingRecords = await listRecords(session, 'site.standard.document');
  const existingByPath = new Map<string, string>();

  for (const record of existingRecords) {
    const path = (record.value as Record<string, unknown>)['path'] as string | undefined;
    if (path) {
      const rkey = record.uri.split('/').pop()!;
      existingByPath.set(path, rkey);
    }
  }

  // --recreate: delete all existing document records first
  if (RECREATE && existingRecords.length > 0) {
    console.log(`Deleting ${existingRecords.length} existing document record(s)...`);
    for (const record of existingRecords) {
      const rkey = record.uri.split('/').pop()!;
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete record: ${rkey}`);
      } else {
        await deleteRecord(session, 'site.standard.document', rkey);
        console.log(`  ✗ Deleted: ${rkey}`);
      }
    }
    // Clear the map so all posts get new records
    existingByPath.clear();
  }

  const publicationUri = `at://${session.did}/site.standard.publication/${AUTHOR.atproto.publicationRkey}`;
  const frontmatterUpdates: { slug: string; rkey: string }[] = [];

  for (const post of BLOG_POSTS) {
    // Skip posts published externally (they have their own canonical URLs)
    if (post.publishedAt?.linkExternal) {
      continue;
    }

    const docPath = `/blog/${post.slug}`;
    let rkey: string;
    let isNew = false;

    if (!RECREATE && post.atprotoRkey) {
      // Post already has an rkey assigned — just update the record
      rkey = post.atprotoRkey;
    } else if (!RECREATE && existingByPath.has(docPath)) {
      // Record already exists on PDS but frontmatter is missing the rkey
      rkey = existingByPath.get(docPath)!;
      frontmatterUpdates.push({ slug: post.slug, rkey });
    } else {
      // New record needed (or --recreate forces fresh TIDs)
      rkey = generateTid();
      isNew = true;
      frontmatterUpdates.push({ slug: post.slug, rkey });
    }

    const record: Record<string, unknown> = {
      $type: 'site.standard.document',
      site: publicationUri,
      path: docPath,
      title: post.title,
      description: post.description,
      publishedAt: new Date(post.created).toISOString(),
      tags: post.keywords.slice(0, 10),
    };

    if (post.updated) {
      record['updatedAt'] = new Date(post.updated).toISOString();
    }

    // Upload cover image blob if the post has a thumbnail header
    if (post.thumbnail?.header) {
      const coverBlob = await loadCoverBlob(session, post.thumbnail.header);
      if (coverBlob) {
        record['coverImage'] = coverBlob;
      }
    }

    if (DRY_RUN) {
      console.log(`\n[DRY RUN] ${isNew ? 'CREATE' : 'UPDATE'} document: ${post.slug}`);
      console.log(`  rkey: ${rkey}`);
      console.log(`  path: ${docPath}`);
    } else {
      await putRecord(session, 'site.standard.document', rkey, record);
      console.log(`✓ Document ${isNew ? 'created' : 'updated'}: ${post.slug} (rkey: ${rkey})`);
    }
  }

  // Write rkeys back into frontmatter files
  if (frontmatterUpdates.length > 0) {
    console.log(`\nWriting atprotoRkey to ${frontmatterUpdates.length} blog post(s)...`);
    for (const { slug, rkey } of frontmatterUpdates) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would write atprotoRkey: "${rkey}" → ${slug}`);
      } else {
        writeRkeyToFrontmatter(slug, rkey);
      }
    }
  } else {
    console.log('\nAll blog posts already have atprotoRkey in frontmatter.');
  }

  return frontmatterUpdates.length;
}

// ─── Frontmatter update helpers ──────────────────────────────────────────────

/**
 * Finds the markdown file for a blog post slug and inserts/updates
 * `atprotoRkey` in its YAML frontmatter.
 */
function writeRkeyToFrontmatter(slug: string, rkey: string): void {
  const filePath = resolveMarkdownPath(slug);
  if (!filePath) {
    console.warn(`  ⚠ Could not find markdown file for slug: ${slug}`);
    return;
  }

  const content = readFileSync(filePath, 'utf-8');

  // Check if atprotoRkey already exists in frontmatter
  if (/^atprotoRkey:/m.test(content)) {
    // Replace existing value
    const updated = content.replace(
      /^atprotoRkey:.*$/m,
      `atprotoRkey: "${rkey}"`,
    );
    writeFileSync(filePath, updated, 'utf-8');
  } else {
    // Insert before the closing `---` of frontmatter
    const closingIndex = content.indexOf('\n---', 4); // skip opening ---
    if (closingIndex === -1) {
      console.warn(`  ⚠ Could not parse frontmatter in: ${filePath}`);
      return;
    }
    const updated =
      content.slice(0, closingIndex) +
      `\natprotoRkey: "${rkey}"` +
      content.slice(closingIndex);
    writeFileSync(filePath, updated, 'utf-8');
  }

  console.log(`  ✓ Wrote atprotoRkey → ${slug}`);
}

/**
 * Resolves the markdown file path for a given blog post slug.
 * Supports folder-based (slug/README.md) and flat (slug.md) structures.
 */
function resolveMarkdownPath(slug: string): string | null {
  // Folder-based: src/content/blog/<slug>/README.md
  const folderPath = join(BLOG_CONTENT_DIR, slug, 'README.md');
  if (existsSync(folderPath)) {
    return folderPath;
  }

  // Flat: src/content/blog/<slug>.md
  const flatPath = join(BLOG_CONTENT_DIR, `${slug}.md`);
  if (existsSync(flatPath)) {
    return flatPath;
  }

  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!HANDLE || !PASSWORD) {
    console.error('Error: ATPROTO_HANDLE and ATPROTO_PASSWORD environment variables are required.');
    console.error('');
    console.error('Set them in .env.local:');
    console.error('  ATPROTO_HANDLE=k9n.dev');
    console.error('  ATPROTO_PASSWORD=<app-password>');
    console.error('');
    console.error('Create an app password at: https://bsky.app/settings/app-passwords');
    process.exit(1);
  }

  console.log(`Syncing standard.site records to ${PDS_URL}...`);
  console.log(`Handle: ${HANDLE}`);
  if (DRY_RUN) console.log('Mode: DRY RUN (no changes will be made)');
  if (RECREATE) console.log('Mode: RECREATE (deleting all existing document records first)');
  console.log();

  const session = await createSession();
  console.log(`Authenticated as ${session.did}\n`);

  await syncPublication(session);
  const updatedCount = await syncDocuments(session);

  console.log('\n✓ Sync complete!');
  if (updatedCount > 0 && !DRY_RUN) {
    console.log('  Run `npm run build:content` to regenerate the content manifests.');
  }
}

main().catch((error: unknown) => {
  console.error('AT Protocol sync failed:', error);
  process.exit(1);
});
