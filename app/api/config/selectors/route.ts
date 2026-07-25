import { loadGlobalSiteConfigs, saveGlobalSiteConfigs, type GlobalSiteConfig } from "@/lib/storage";

function isGlobalSiteConfig(value: unknown): value is GlobalSiteConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 200) return false;

    return entries.every(([hostname, config]) => {
        if (
            !/^[a-z0-9.-]+$/i.test(hostname)
            || !config
            || typeof config !== "object"
            || Array.isArray(config)
        ) {
            return false;
        }
        const record = config as Record<string, unknown>;
        return ["targetSelector", "removeSelector", "waitForSelector"].every((key) => (
            record[key] === undefined
            || (typeof record[key] === "string" && record[key].length <= 1_000)
        ));
    });
}

export async function GET() {
    try {
        const configs = await loadGlobalSiteConfigs();
        return new Response(JSON.stringify(configs), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch {
        return new Response(JSON.stringify({ error: "Failed to load configs" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}

export async function POST(request: Request) {
    try {
        const body: unknown = await request.json();
        if (!isGlobalSiteConfig(body)) {
            throw new Error("Invalid selector configuration");
        }
        await saveGlobalSiteConfigs(body);
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }
}
