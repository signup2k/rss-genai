// lib/storage.ts
// Storage abstraction for the article date registry.
//
// On Vercel (production):  Uses Upstash Redis for persistence across cold starts.
// On local dev:            Falls back to file-system storage (.rss-cache/).
//
// This fixes the critical bug where the date registry was stored on the
// ephemeral Vercel Serverless Function filesystem and lost on every cold start,
// causing "phantom new articles" in RSS readers.

import { createHash } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

// --- Types ---

export interface ArticleRecord {
    guid: string;
    pubDate: string;       // RFC 822 date string
    firstSeenISO: string;  // ISO 8601 timestamp when we first saw this article
    title?: string;
}

export interface UrlRegistry {
    [guid: string]: ArticleRecord;
}

// --- Helpers ---

function registryKey(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
    return `rss-registry:${hash}`;
}

// --- Upstash Redis backend ---

let redisClient: import("@upstash/redis").Redis | null = null;
let redisChecked = false;

async function getRedis(): Promise<import("@upstash/redis").Redis | null> {
    if (redisChecked) return redisClient;
    redisChecked = true;

    // Upstash Redis needs these env vars (auto-injected by Vercel integration)
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        console.log("[Storage] No Redis credentials found, using file-system fallback");
        return null;
    }

    try {
        const { Redis } = await import("@upstash/redis");
        redisClient = new Redis({ url, token });
        console.log("[Storage] Using Upstash Redis for registry persistence");
        return redisClient;
    } catch (e) {
        console.warn("[Storage] Failed to initialize Redis, falling back to file system:", e);
        return null;
    }
}

// --- File-system backend (local dev fallback) ---

const REGISTRY_DIR = join(process.cwd(), ".rss-cache");

function fsPath(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
    return join(REGISTRY_DIR, `${hash}.json`);
}

async function fsLoad(url: string): Promise<UrlRegistry> {
    try {
        const data = await readFile(fsPath(url), "utf-8");
        return JSON.parse(data) as UrlRegistry;
    } catch {
        return {};
    }
}

async function fsSave(url: string, registry: UrlRegistry): Promise<void> {
    await mkdir(REGISTRY_DIR, { recursive: true });
    await writeFile(fsPath(url), JSON.stringify(registry, null, 2), "utf-8");
}

// --- Public API ---

export async function loadRegistry(url: string): Promise<UrlRegistry> {
    const redis = await getRedis();
    if (redis) {
        try {
            const data = await redis.get<UrlRegistry>(registryKey(url));
            return data ?? {};
        } catch (e) {
            console.warn("[Storage] Redis read failed, falling back to FS:", e);
            return fsLoad(url);
        }
    }
    return fsLoad(url);
}

export async function saveRegistry(url: string, registry: UrlRegistry): Promise<void> {
    const redis = await getRedis();
    if (redis) {
        try {
            // Store indefinitely (no TTL) — article history should persist forever
            await redis.set(registryKey(url), registry);
            return;
        } catch (e) {
            console.warn("[Storage] Redis write failed, falling back to FS:", e);
        }
    }
    return fsSave(url, registry);
}
