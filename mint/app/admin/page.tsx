import Admin from './admin-client';

export const metadata = {
  title: 'Admin',
  robots: {index: false, follow: false},
};

export default function Page() {
  return <Admin />;
}
