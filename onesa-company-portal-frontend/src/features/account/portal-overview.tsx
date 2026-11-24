import type {Tab} from '@/features/admin/workspace-navigation';
import {adminAccountEntry, managedAdminEntry} from '@/lib/account-return';
import styles from './account.module.css';

const features = [
  {
    title: 'Company website',
    description: 'Explore Onesa products. Approved editors can draft updates and send them for publication review.',
    example: 'A product announcement awaiting review',
    publicPath: '/en/products',
    publicAction: 'Explore products',
    section: 'Content',
    staffAction: 'Sign in to edit content',
  },
  {
    title: 'Enquiries',
    description: 'Ask Onesa about a product or partnership. Authorized staff can review new enquiries and track their follow-up.',
    example: 'A partnership enquiry assigned for follow-up',
    publicPath: '/en/contact',
    publicAction: 'Contact Onesa',
    section: 'Enquiries',
    staffAction: 'Sign in to review enquiries',
  },
  {
    title: 'Careers',
    description: 'Find open roles and apply. Approved recruitment staff can review applications and move candidates through the hiring process.',
    example: 'An application ready for an initial review',
    publicPath: '/en/careers',
    publicAction: 'Browse careers',
    section: 'Applications',
    staffAction: 'Sign in to review applications',
  },
  {
    title: 'Staff and access',
    description: 'Portal administrators manage staff access and review access changes.',
    example: 'A staff access request awaiting approval',
    section: 'Users',
    staffAction: 'Sign in to manage staff access',
  },
] satisfies Array<{
  title: string;
  description: string;
  example: string;
  section: Tab;
  staffAction: string;
} & ({publicPath: string; publicAction: string} | {publicPath?: never; publicAction?: never})>;

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
          <div className={`${styles.grid} ${styles.overviewGrid}`}>
            {features.map(({title, description, example, publicPath, publicAction, section, staffAction}) => {
              const destination = new URL('/admin', process.env.PORTAL_URL);
              destination.searchParams.set('section', section);
              const staffEntry = managed ? managedAdminEntry(destination) : adminAccountEntry(destination);
              return <article className={styles.product} key={title}>
                <h2>{title}</h2>
                <p>{description}</p>
                <dl className={styles.example}><dt>Example</dt><dd>{example}</dd></dl>
                {publicPath && <a className={styles.action} href={publicPath}>{publicAction}</a>}
                <a className={styles.action} href={staffEntry}>{staffAction}</a>
              </article>;
            })}
          </div>
        </div>
      </main>
    </body>
  </html>;
}
