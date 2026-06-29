"use client";

import { useState, useEffect } from "react";
import type { GlobalSiteConfig } from "@/lib/storage";

export default function Home() {
  const [password, setPassword] = useState("");
  const [configs, setConfigs] = useState<GlobalSiteConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Generator State
  const [genUrl, setGenUrl] = useState("");
  const [genTarget, setGenTarget] = useState("");
  const [genRemove, setGenRemove] = useState("");
  const [genWait, setGenWait] = useState("");
  const [genFulltext, setGenFulltext] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");

  // Config Manager State
  const [newDomain, setNewDomain] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newRemove, setNewRemove] = useState("");
  const [newWait, setNewWait] = useState("");

  useEffect(() => {
    fetch("/api/config/selectors")
      .then((res) => res.json())
      .then((data) => {
        setConfigs(data || {});
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load configs");
        setLoading(false);
      });
  }, []);

  const handleGenerate = () => {
    if (!genUrl) return;
    try {
      const urlObj = new URL(window.location.href);
      const apiUrl = new URL("/api/rss", urlObj.origin);
      apiUrl.searchParams.set("url", genUrl);
      if (genTarget) apiUrl.searchParams.set("target", genTarget);
      if (genRemove) apiUrl.searchParams.set("remove", genRemove);
      if (genWait) apiUrl.searchParams.set("waitfor", genWait);
      if (genFulltext) apiUrl.searchParams.set("fulltext", "true");
      setGeneratedLink(apiUrl.toString());
    } catch {
      setError("Invalid base URL context");
    }
  };

  const handleSaveConfigs = async (newConfigs: GlobalSiteConfig) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/config/selectors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify(newConfigs),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setConfigs(newConfigs);
      setNewDomain("");
      setNewTarget("");
      setNewRemove("");
      setNewWait("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save configs (Check password)");
    }
    setSaving(false);
  };

  const handleAddConfig = () => {
    if (!newDomain) return;
    const domain = newDomain.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    
    const newConfigs = {
      ...configs,
      [domain]: {
        targetSelector: newTarget || undefined,
        removeSelector: newRemove || undefined,
        waitForSelector: newWait || undefined,
      },
    };
    handleSaveConfigs(newConfigs);
  };

  const handleDeleteConfig = (domain: string) => {
    if (!confirm(`Delete config for ${domain}?`)) return;
    const newConfigs = { ...configs };
    delete newConfigs[domain];
    handleSaveConfigs(newConfigs);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">RSS GenAI Dashboard</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            Generate RSS links and manage Jina.ai CSS selector configurations.
          </p>
        </header>

        {error && (
          <div className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        <section className="bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-semibold mb-6">🔗 Link Generator</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Target URL</label>
              <input
                type="url"
                value={genUrl}
                onChange={(e) => setGenUrl(e.target.value)}
                placeholder="https://example.com/blog"
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Target Selector (Optional)</label>
              <input
                type="text"
                value={genTarget}
                onChange={(e) => setGenTarget(e.target.value)}
                placeholder="article.content"
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Remove Selector (Optional)</label>
              <input
                type="text"
                value={genRemove}
                onChange={(e) => setGenRemove(e.target.value)}
                placeholder="nav, .ads"
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Wait For Selector (Optional)</label>
              <input
                type="text"
                value={genWait}
                onChange={(e) => setGenWait(e.target.value)}
                placeholder=".loaded-content"
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="flex items-center mt-6">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={genFulltext}
                  onChange={(e) => setGenFulltext(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 w-5 h-5"
                />
                <span className="text-sm font-medium">Include Fulltext Content</span>
              </label>
            </div>
          </div>
          <div className="mt-6">
            <button
              onClick={handleGenerate}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Generate URL
            </button>
          </div>
          {generatedLink && (
            <div className="mt-6">
              <label className="block text-sm font-medium mb-1 text-green-600 dark:text-green-400">Generated RSS Link (Copy this to your RSS Reader)</label>
              <textarea
                readOnly
                value={generatedLink}
                rows={3}
                className="w-full px-4 py-3 rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100 outline-none resize-none font-mono text-sm"
                onClick={(e) => e.currentTarget.select()}
              />
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">⚙️ Global Site Configs</h2>
            <div className="flex items-center space-x-3">
              <label className="text-sm font-medium text-zinc-500">Admin Password:</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Required for saving"
                className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm w-40"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-3 px-4 font-semibold text-sm">Domain</th>
                  <th className="py-3 px-4 font-semibold text-sm">Target</th>
                  <th className="py-3 px-4 font-semibold text-sm">Remove</th>
                  <th className="py-3 px-4 font-semibold text-sm">Wait For</th>
                  <th className="py-3 px-4 font-semibold text-sm text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-500">Loading configs...</td>
                  </tr>
                ) : Object.keys(configs).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-500">No custom configurations yet.</td>
                  </tr>
                ) : (
                  Object.entries(configs).map(([domain, config]) => (
                    <tr key={domain} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="py-3 px-4 font-medium">{domain}</td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 font-mono text-xs">{config.targetSelector || "-"}</td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 font-mono text-xs truncate max-w-xs" title={config.removeSelector}>{config.removeSelector || "-"}</td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 font-mono text-xs">{config.waitForSelector || "-"}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleDeleteConfig(domain)}
                          disabled={saving}
                          className="text-red-500 hover:text-red-700 disabled:opacity-50 font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-8 border-t border-zinc-200 dark:border-zinc-800 pt-6">
            <h3 className="text-lg font-medium mb-4">Add New Config</h3>
            <div className="grid gap-4 md:grid-cols-5 items-end">
              <div className="md:col-span-1">
                <label className="block text-xs font-medium mb-1 text-zinc-500">Domain Name</label>
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent outline-none text-sm"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-medium mb-1 text-zinc-500">Target Selector</label>
                <input
                  type="text"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent outline-none text-sm font-mono"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-medium mb-1 text-zinc-500">Remove Selector</label>
                <input
                  type="text"
                  value={newRemove}
                  onChange={(e) => setNewRemove(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent outline-none text-sm font-mono"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-medium mb-1 text-zinc-500">Wait For Selector</label>
                <input
                  type="text"
                  value={newWait}
                  onChange={(e) => setNewWait(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent outline-none text-sm font-mono"
                />
              </div>
              <div className="md:col-span-1">
                <button
                  onClick={handleAddConfig}
                  disabled={saving || !newDomain}
                  className="w-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 text-sm"
                >
                  {saving ? "Saving..." : "Save Config"}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
