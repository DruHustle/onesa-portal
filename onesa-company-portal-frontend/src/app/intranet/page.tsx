import { internalDocumentsOrigin } from "@/config/internal-documents";
import { identityAdministrationUrl } from "@/lib/identity-administration";

export default function Intranet() {
  const identityAdmin = identityAdministrationUrl();
  const accessUrl = identityAdmin ? new URL("/account#access-intranet", identityAdmin).href : null;

  return <div className="admin-shell">
    <header className="admin-header">
      <a className="wordmark" href="/en">onesa<span>UG</span></a>
    </header>
    <main className="admin-main">
      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}>Onesa Intranet</h1>
      <div className="admin-grid">
        <section className="admin-card" aria-labelledby="portal-title">
          <h2 id="portal-title">Company Portal</h2>
          <p>Manage company operations and administration.</p>
          <a className="button" href="/admin">Open Company Portal</a>
        </section>
        <section className="admin-card" aria-labelledby="documents-title">
          <h2 id="documents-title">Internal Documents</h2>
          <p>Find company documents and read their revision history.</p>
          {internalDocumentsOrigin
            ? <a className="button" href={internalDocumentsOrigin + "/"}>Open Internal Documents</a>
            : <p role="status">Internal Documents is currently unavailable.</p>}
        </section>
      </div>
      {accessUrl && <a className="text-link" href={accessUrl}>Request or review intranet access</a>}
    </main>
  </div>;
}
