import { listRules } from "@/lib/rule-registry";

export default function Home() {
  const rules = listRules();

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-16">
      <header className="mb-14">
        <p className="mb-3 font-mono text-sm uppercase tracking-[0.22em] text-emerald-600">
          Deterministic feeds
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">RSS Rules</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Only reviewed rules are executed. No model calls, runtime guessing, or arbitrary URL fetching.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold">Published rules</h2>
          <span className="font-mono text-sm text-zinc-500">{rules.length} total</span>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
            <p className="font-medium">No rules have been published yet.</p>
            <p className="mt-2 text-sm text-zinc-500">
              Add a harness-tested RuleV1 object to <code>rules/index.ts</code> and deploy.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rules.map((rule) => (
              <article key={rule.id} className="grid gap-3 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <h3 className="font-semibold">{rule.name}</h3>
                  <p className="mt-1 truncate text-sm text-zinc-500">{rule.source.url}</p>
                </div>
                <div className="flex gap-2 font-mono text-sm">
                  <a className="rounded-lg bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700" href={`/api/rss?id=${rule.id}`}>RSS</a>
                  <a className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" href={`/api/rss?id=${rule.id}&format=atom`}>Atom</a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-zinc-100 p-6 dark:bg-zinc-900">
          <h2 className="font-semibold">Single feed</h2>
          <code className="mt-3 block break-all text-sm text-zinc-600 dark:text-zinc-400">/api/rss?id=rule-id</code>
        </div>
        <div className="rounded-2xl bg-zinc-100 p-6 dark:bg-zinc-900">
          <h2 className="font-semibold">Merged feed</h2>
          <code className="mt-3 block break-all text-sm text-zinc-600 dark:text-zinc-400">/api/rss/merge?id=one&amp;id=two</code>
        </div>
      </section>
    </main>
  );
}
