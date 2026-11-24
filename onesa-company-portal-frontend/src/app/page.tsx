import {headers} from 'next/headers';
import CompanyLayout, {generateMetadata as publicationMetadata} from './[locale]/layout';
import CompanyHome from './[locale]/page';
import {PortalOverview} from '@/features/account/portal-overview';
import {applicationOrigin} from '@/lib/domains';
import {homepageMetadata} from '@/lib/metadata';

async function isPortalHome() {
  const portal = process.env.PORTAL_URL;
  return Boolean(portal && applicationOrigin((await headers()).get('host'), portal) === portal);
}

export async function generateMetadata() {
  if (await isPortalHome()) return {title: 'Company Portal', robots: {index: false, follow: false}};
  return {...homepageMetadata(), ...await publicationMetadata()};
}
export default async function Home() {
  if (await isPortalHome()) return <PortalOverview managed={process.env.ONESA_IDENTITY_PORTAL_LOGIN === 'managed'}/>;
  const params = Promise.resolve({locale: 'en' as const});
  return <CompanyLayout params={params}><CompanyHome params={params}/></CompanyLayout>;
}
