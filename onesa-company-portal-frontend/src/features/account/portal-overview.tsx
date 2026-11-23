import type {Tab} from '@/features/admin/workspace-navigation';
import {adminAccountEntry, managedAdminEntry} from '@/lib/account-return';
import styles from './account.module.css';

const features = [
  {
    title: 'Company website',
    description: 'Explore Onesa products. Approved editors can draft and publish updates, such as a new product announcement.',
    publicPath: '/en/products',
    publicAction: 'Explore products',
    section: 'Content',
    staffAction: 'Sign in to edit content',
  },
  {
    title: 'Enquiries',
    description: 'Ask Onesa about a product or partnership. Authorized staff can review new enquiries and track their follow-up.',
    publicPath: '/en/contact',
    publicAction: 'Contact Onesa',
    section: 'Enquiries',
    staffAction: 'Sign in to review enquiries',
  },
  {
    title: 'Careers',
    description: 'Find open roles and apply. Approved recruitment staff can review applications and move candidates through the hiring process.',
    publicPath: '/en/careers',
    publicAction: 'Browse careers',
    section: 'Applications',
    staffAction: 'Sign in to review applications',
  },
] satisfies Array<{
  title: string;
  description: string;
  publicPath: string;
  publicAction: string;
  section: Tab;
  staffAction: string;
}>;

export function PortalOverview({managed}: {managed: boolean}) {
  return <html data-onesa-product="company" lang="en">
    <head><meta name="color-scheme" content="light dark"/></head>
    <body>
      <main className={styles.shell}>
        <div className={styles.workspace}>
          <div className={styles.intro}>
            <h1>Onesa Company Portal</h1>
            <p>Find out what Onesa does, contact the company, or apply for an open role. Staff can sign in to the workspaces they are authorized to use.</p>
            <div className={styles.accountLinks}>
              <a className="button" href="/account">Sign in</a>
              <a className={styles.action} href="/account/register">Create an account</a>
            </div>
          </div>
          <div className={styles.grid}>
            {features.map(({title, description, publicPath, publicAction, section, staffAction}) => {
              const destination = new URL('/admin', 'https://portal.onesa.eu');
              destination.searchParams.set('section', section);
              const staffEntry = managed ? managedAdminEntry(destination) : adminAccountEntry(destination);
              return <article className={styles.product} key={title}>
                <h2>{title}</h2>
                <p>{description}</p>
                <a className={styles.action} href={publicPath}>{publicAction}</a>
                <a className={styles.action} href={staffEntry}>{staffAction}</a>
              </article>;
            })}
          </div>
        </div>
      </main>
    </body>
  </html>;
}
