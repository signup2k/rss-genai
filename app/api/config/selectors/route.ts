import { loadGlobalSiteConfigs, saveGlobalSiteConfigs, type GlobalSiteConfig } from "@/lib/storage";

function checkAuth(request: Request) {
    const authHeader = request.headers.get("x-admin-password");
    const adminPassword = process.env.ADMIN_PASSWORD || "rss-genai-2k";

    if (authHeader !== adminPassword) {
        return false;
    }
    return true;
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
    if (!checkAuth(request)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        const body = await request.json() as GlobalSiteConfig;
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
