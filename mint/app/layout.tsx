import './globals.css';
import type {ReactNode} from 'react';
import localFont from 'next/font/local';
import {TITLE, ARTIST, DESCRIPTION} from '../lib/content';

// Archivo (SIL OFL, see app/fonts/OFL.txt), self-hosted so the build never
// reaches out to a font service. Variable in weight and width.
const archivo = localFont({
  src: './fonts/Archivo.woff2',
  weight: '100 900',
  variable: '--font-archivo',
  display: 'swap',
});

export const metadata = {
  title: TITLE + ' by ' + ARTIST,
  description: DESCRIPTION[0],
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#d8d6c8',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
