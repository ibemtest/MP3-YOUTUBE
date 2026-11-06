import type {Metadata} from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css'; // Global styles

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MP3 Downloader — YouTube to MP3 Audio Converter',
  description: 'Download and convert authorized YouTube audio and media files to high-quality MP3 using FFmpeg.',
  openGraph: {
    title: 'MP3 Downloader — YouTube to MP3 Audio Converter',
    description: 'Download and convert authorized YouTube audio and media files to high-quality MP3 using FFmpeg.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MP3 Downloader — YouTube to MP3 Audio Converter',
    description: 'Download and convert authorized YouTube audio and media files to high-quality MP3 using FFmpeg.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={plusJakartaSans.className}>
      <body suppressHydrationWarning className="bg-white text-neutral-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
