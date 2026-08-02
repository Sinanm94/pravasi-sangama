import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar';
import MotionProvider from '@/components/ui/MotionProvider';
import Toaster from '@/components/ui/Toaster';
import './globals.css';

/**
 * Montserrat via next/font rather than an @import in globals.css.
 *
 * next/font downloads the files at build time and serves them from our own
 * origin. A Google Fonts @import would be a runtime request to fonts.gstatic
 * .com — which the gate PWA cannot make offline, and which the service worker
 * is forbidden from caching (it only handles same-origin). The pass would fall
 * back to system sans on exactly the shift where it matters.
 *
 * Weights are explicit: the ticket leans on 800/900 for the event lockup and
 * 500/600 for labels.
 */
const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800', '900'],
});

export const metadata: Metadata = {
  title: 'PRAVASI SANGAMA 2026',
  description:
    'E-ticketing and gate management for Pravasi Sangama 2026, Karnataka Cultural Foundation.',
  manifest: '/manifest.json',
  applicationName: 'PS26 Gate',
  appleWebApp: {
    capable: true,
    title: 'PS26 Gate',
    // Lets the camera view run edge-to-edge when installed on iOS.
    statusBarStyle: 'black-translucent',
  },
  /* No `icons` block. app/favicon.ico, app/icon.png and app/apple-icon.png
   * are App Router file conventions — Next emits the <link> tags from them
   * and they take precedence over metadata.icons, so declaring both only
   * duplicates the tags.
   *
   * favicon.ico specifically matters: browsers request /favicon.ico by
   * convention regardless of any <link>, and while that 404'd they kept
   * showing the previously cached icon. */
  formatDetection: {
    // Stops iOS turning ticket and mobile numbers into tap-to-call links.
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#5E17EB',
  width: 'device-width',
  initialScale: 1,
  // Agents hold phones at arm's length in bright sun; pinch-zoom stays on.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className="min-h-dvh bg-gray-50 font-sans antialiased">
        <MotionProvider>{children}</MotionProvider>
        <Toaster />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
