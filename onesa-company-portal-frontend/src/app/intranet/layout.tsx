import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Onesa Intranet",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html data-onesa-product="company" lang="en"><body>{children}</body></html>;
}
