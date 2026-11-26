import { headers } from "next/headers";
import { applicationOrigin } from "@/lib/domains";

export default async function Intranet() {
  const origin = applicationOrigin((await headers()).get("host"), "");
  const production = origin === "https://portal.onesa.eu";

  return <div className="admin-shell">
    <header className="admin-header">
      <a className="wordmark" href="/en">onesa<span>UG</span></a>
    </header>
    <main className="admin-main">
      <h1>Onesa Intranet</h1>
      <div className="admin-grid">
        <section className="admin-card" aria-labelledby="portal-title">
          <h2 id="portal-title">Company Portal</h2>
          <p>Manage company operations and administration.</p>
          <a className="button" href="/admin">Open Company Portal</a>
        </section>
        <section className="admin-card" aria-labelledby="documents-title">
          <h2 id="documents-title">Internal Documents</h2>
          <p>Find company documents and read their revision history.</p>
          {production
            ? <a className="button" href="https://docs.internal.onesa.eu/">Open Internal Documents</a>
            : <p role="status">Internal Documents is unavailable in this environment.</p>}
        </section>
      </div>
      {production && <a className="text-link" href="https://account.onesa.eu/account#access-intranet">Request or review intranet access</a>}
    </main>
  </div>;
}
