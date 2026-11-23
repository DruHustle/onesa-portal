import { RegistrationReturn } from "@/features/account/registration-handoff";
import styles from "@/features/account/account.module.css";

export const metadata = { title: "Return to Company Portal", robots: { index: false, follow: false } };

export default async function Registered({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const { audience } = await searchParams;
  const admin = audience === "admin";
  return <main className={styles.shell}><section className={styles.card} aria-labelledby="return-title">
    <RegistrationReturn audience={admin ? "admin" : "user"}/>
    <h1 id="return-title">Company Portal</h1>
    {admin ? <>
      <p>Company Portal administrator access requires approval. Once approved, sign in to open the staff workspace.</p>
      <a href={process.env.ONESA_IDENTITY_PORTAL_LOGIN === "managed"
        ? "/api/v1/auth/managed/start?next=%2Fadmin"
        : "/admin#workspace"}>Sign in to the staff workspace</a>
    </> : <>
      <p>Company Portal access requires approval. If you requested access, your Onesa administrator will review it.</p>
      <p><a href="/account">Manage your Onesa account</a></p>
    </>}
    <p><a href="/en">Visit the Onesa company website</a></p>
  </section></main>;
}
